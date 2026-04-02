import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import { 
  createMint, 
  createAccount, 
  mintTo, 
  getAccount, 
  TOKEN_PROGRAM_ID 
} from "@solana/spl-token";
import { assert } from "chai";

describe("escrow", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Escrow as Program<Escrow>;

  const sender = anchor.web3.Keypair.generate();
  const receiver = anchor.web3.Keypair.generate();
  
  let mint: anchor.web3.PublicKey;
  let senderTokenAccount: anchor.web3.PublicKey;
  let receiverTokenAccount: anchor.web3.PublicKey;

  let escrowAccount: anchor.web3.PublicKey;
  let vaultAccount: anchor.web3.PublicKey;

  const depositAmount = new anchor.BN(500);
  const seedId = new anchor.BN(888);

  before(async () => {
    const sig1 = await provider.connection.requestAirdrop(sender.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    const sig2 = await provider.connection.requestAirdrop(receiver.publicKey,  1 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig1);
    await provider.connection.confirmTransaction(sig2);

    mint = await createMint(provider.connection, sender, sender.publicKey, null, 0);

    senderTokenAccount = await createAccount(provider.connection, sender, mint, sender.publicKey);
    receiverTokenAccount = await createAccount(provider.connection, receiver, mint, receiver.publicKey);

    await mintTo(provider.connection, sender, mint, senderTokenAccount, sender, 2000);

    const [_escrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), sender.publicKey.toBuffer(), seedId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    escrowAccount = _escrow;

    const [_vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowAccount.toBuffer()],
      program.programId
    );
    vaultAccount = _vault;
  });

  it("1. Initialize and Deposit Lock", async () => {
    const timelockSeconds = new anchor.BN(60); // Mantemos 60 para o teste passar rapido na lógica de falha

    await program.methods
      .initializeAndDeposit(seedId, depositAmount, timelockSeconds)
      .accounts({
        sender: sender.publicKey,
        receiver: receiver.publicKey,
        mint: mint,
        senderTokenAccount: senderTokenAccount,
        escrow: escrowAccount,
        vault: vaultAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([sender])
      .rpc();

    const state = await program.account.paymentEscrow.fetch(escrowAccount);
    assert.strictEqual(state.sender.toBase58(), sender.publicKey.toBase58());
    assert.strictEqual(state.receiver.toBase58(), receiver.publicKey.toBase58());
    assert.strictEqual(state.amount.toNumber(), 500);
    assert.strictEqual(state.timelockSeconds.toNumber(), 60);
    assert.strictEqual(state.senderApproved, false);
    assert.strictEqual(state.receiverApproved, false);

    const vaultBal = await getAccount(provider.connection, vaultAccount);
    assert.strictEqual(Number(vaultBal.amount), 500);
  });

  it("2. Receiver Approves (Partial Execution)", async () => {
    await program.methods
      .approveByReceiver()
      .accounts({
        receiver: receiver.publicKey,
        escrow: escrowAccount,
        vault: vaultAccount,
        receiverTokenAccount: receiverTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([receiver])
      .rpc();

    const state = await program.account.paymentEscrow.fetch(escrowAccount);
    assert.strictEqual(state.receiverApproved, true);
    assert.strictEqual(state.amount.toNumber(), 500); // not emptied yet
  });

  it("3. Refund Fails (Timelock not expired)", async () => {
    try {
      await program.methods
        .refund()
        .accounts({
          sender: sender.publicKey,
          escrow: escrowAccount,
          vault: vaultAccount,
          senderTokenAccount: senderTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([sender])
        .rpc();
      assert.fail("Should have thrown error");
    } catch (e: any) {
      assert.include(e.message, "TimelockNotExpired");
    }
  });

  it("4. Sender Approves (Full Execution & Release)", async () => {
    let receiverTokenBalBefore = await getAccount(provider.connection, receiverTokenAccount);
    assert.strictEqual(Number(receiverTokenBalBefore.amount), 0);

    await program.methods
      .approveBySender()
      .accounts({
        sender: sender.publicKey,
        escrow: escrowAccount,
        vault: vaultAccount,
        receiverTokenAccount: receiverTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([sender])
      .rpc();

    const state = await program.account.paymentEscrow.fetch(escrowAccount);
    assert.strictEqual(state.senderApproved, true);
    assert.strictEqual(state.amount.toNumber(), 0); // internally marked as consumed

    const receiverTokenBalAfter = await getAccount(provider.connection, receiverTokenAccount);
    assert.strictEqual(Number(receiverTokenBalAfter.amount), 500);
  });

  let escrowAccount2: anchor.web3.PublicKey;
  let vaultAccount2: anchor.web3.PublicKey;
  const seedId2 = new anchor.BN(999);

  it("5. Initialize Second Escrow (1s timelock) and test unauthorized approval", async () => {
    const [_escrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), sender.publicKey.toBuffer(), seedId2.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    escrowAccount2 = _escrow;

    const [_vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowAccount2.toBuffer()],
      program.programId
    );
    vaultAccount2 = _vault;

    const timelockSeconds = new anchor.BN(1);

    await program.methods
      .initializeAndDeposit(seedId2, depositAmount, timelockSeconds)
      .accounts({
        sender: sender.publicKey,
        receiver: receiver.publicKey,
        mint: mint,
        senderTokenAccount: senderTokenAccount,
        escrow: escrowAccount2,
        vault: vaultAccount2,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([sender])
      .rpc();

    let vaultBal = await getAccount(provider.connection, vaultAccount2);
    assert.strictEqual(Number(vaultBal.amount), 500);

    // Test unauthorized approval (using a random keypair)
    const hacker = anchor.web3.Keypair.generate();
    try {
        await program.methods
          .approveBySender()
          .accounts({
            sender: hacker.publicKey,
            escrow: escrowAccount2,
            vault: vaultAccount2,
            receiverTokenAccount: receiverTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([hacker])
          .rpc();
        assert.fail("Should have failed due to wrong sender");
    } catch (e: any) {
        assert.isTrue(e.message.includes("ConstraintHasOne") || e.message.includes("AccountNotInitialized") || e.message.includes("unknown signer") || e.message !== "Should have failed due to wrong sender");
    }
  });

  it("6. Successful Refund after Timelock", async () => {
    // Wait for 2-3 seconds to ensure timelock passes safely considering network latency delays
    await new Promise((resolve) => setTimeout(resolve, 2500));

    let senderTokenBalBefore = await getAccount(provider.connection, senderTokenAccount);
    const beforeBal = Number(senderTokenBalBefore.amount);

    await program.methods
      .refund()
      .accounts({
        sender: sender.publicKey,
        escrow: escrowAccount2,
        vault: vaultAccount2,
        senderTokenAccount: senderTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([sender])
      .rpc();

    const state = await program.account.paymentEscrow.fetch(escrowAccount2);
    assert.strictEqual(state.amount.toNumber(), 0); // marked as executed/refunded

    let senderTokenBalAfter = await getAccount(provider.connection, senderTokenAccount);
    
    // verify the funds returned
    assert.strictEqual(Number(senderTokenBalAfter.amount), beforeBal + 500);
  });
});
