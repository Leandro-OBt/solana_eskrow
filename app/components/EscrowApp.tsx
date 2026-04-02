"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useState, useEffect } from "react";
import { PublicKey } from "@solana/web3.js";
import { useProgram } from "../lib/useProgram";
import styles from "./EscrowApp.module.css";
import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export default function EscrowApp() {
  const { connected, publicKey } = useWallet();
  const { program, connection } = useProgram();

  // Estados Form - Initialize
  const [receiverKey, setReceiverKey] = useState("");
  const [amount, setAmount] = useState("10");
  const [timelockInput, setTimelockInput] = useState("0-00:01"); // ex: 1 minuto

  const tokenMint = WSOL_MINT;
  
  // Status Local
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [escrows, setEscrows] = useState<any[]>([]);
  const [solBal, setSolBal] = useState<number | null>(null);
  const [wSolBal, setWSolBal] = useState<number | null>(null);

  const fetchBalance = async () => {
      if(!connection || !publicKey) return;
      try {
          const bal = await connection.getBalance(publicKey);
          setSolBal(bal / 1e9);
          
          try {
              const mint = WSOL_MINT;
              const ata = getAssociatedTokenAddressSync(mint, publicKey, true);
              const tokenBal = await connection.getTokenAccountBalance(ata);
              setWSolBal(tokenBal.value.uiAmount);
          } catch(err) {
              setWSolBal(0); // Token mint inválido ou sem conta
          }
      } catch (e) {
          setSolBal(0);
      }
  };

  const fetchEscrows = async () => {
    if (!program || !publicKey) return;
    try {
        const allEscrows = await program.account.paymentEscrow.all();
        const myEscrows = allEscrows
            .filter((e): e is typeof e => {
                try {
                    // Verifica se os campos novos existem (schema atual)
                    if (e.account.timelockSeconds === undefined) return false;
                    return (
                        e.account.sender.equals(publicKey) || 
                        e.account.receiver.equals(publicKey)
                    ) && e.account.amount.toNumber() > 0;
                } catch {
                    return false; // Ignora contas com schema antigo/corrompido
                }
            });
        setEscrows(myEscrows);
    } catch (e) {
        console.error("Failed to fetch escrows", e);
    }
  };

  useEffect(() => {
    if (connected && program) {
        fetchEscrows();
        fetchBalance();

        const subId = connection.onProgramAccountChange(program.programId, () => {
            fetchEscrows();
            fetchBalance();
        });

        return () => {
            connection.removeProgramAccountChangeListener(subId);
        };
    }
  }, [connected, program, tokenMint]);

  if (!connected || !publicKey) {
    return (
      <div className={styles.centerContainer}>
        <div className={styles.glassCard}>
          <h1 className={styles.title}>Solana Escrow Payment</h1>
          <p className={styles.subtitle}>Conecte sua carteira para fazer pagamentos com garantia.</p>
          <div className={styles.btnWrapper}>
            <WalletMultiButton />
          </div>
        </div>
      </div>
    );
  }

  const handleDeposit = async () => {
    if (!program || !publicKey) return;
    setLoading(true);
    setMsg("Criando transação de Escrow...");
    try {
        const receiverPubkey = new PublicKey(receiverKey);
        const mint = new PublicKey(tokenMint);
        const senderTokenAccount = getAssociatedTokenAddressSync(mint, publicKey, true);

        // Fetch decimals para enviar a quantidade certa
        const mintInfo = await connection.getParsedAccountInfo(mint);
        const decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals || 9;
        
        const seedId = new anchor.BN(Math.floor(Math.random() * 1000000));

        const [escrowAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("escrow"), publicKey.toBuffer(), seedId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        const [vault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), escrowAccount.toBuffer()],
            program.programId
        );

        const parseTimelockToSeconds = (input: string) => {
            try {
                const parts = input.split('-');
                let days = "0";
                let timePart = input;
                if (parts.length === 2) {
                    days = parts[0];
                    timePart = parts[1];
                }
                const timeParts = timePart.split(':');
                if (timeParts.length !== 2) return 60;
                const d = parseInt(days) || 0;
                const h = parseInt(timeParts[0]) || 0;
                const m = parseInt(timeParts[1]) || 0;
                return d * 86400 + h * 3600 + m * 60;
            } catch {
                return 60;
            }
        };

        const amountScaled = new anchor.BN(Number(amount) * (10 ** decimals));
        const timelockSecs = new anchor.BN(parseTimelockToSeconds(timelockInput));

        const initAtaIx = createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            senderTokenAccount,
            publicKey,
            mint
        );

        const tx = await program.methods
            .initializeAndDeposit(seedId, amountScaled, timelockSecs)
            .accounts({
                sender: publicKey,
                receiver: receiverPubkey,
                mint: mint, 
                senderTokenAccount: senderTokenAccount,
                escrow: escrowAccount,
                vault: vault,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .preInstructions([initAtaIx])
            .rpc();
        
        setMsg(`Sucesso! Depósito criado.`);
        fetchEscrows();
        fetchBalance();
    } catch (e: any) {
        console.error(e);
        setMsg(`Erro na transação: ${e.message}`);
    } finally {
        setLoading(false);
    }
  };

  const handleApprove = async (escrow: any) => {
    if (!program || !publicKey) return;
    try {
      const isSender = escrow.account.sender.equals(publicKey);
      const vault = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), escrow.publicKey.toBuffer()],
        program.programId
      )[0];
      const receiverTokenAccount = getAssociatedTokenAddressSync(escrow.account.mint, escrow.account.receiver, true);

      // Preparamos a instrucao que cria a carteira ATA de destino caso o cara nao tenha wSOL ativado
      const initAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          publicKey, // Pagador da taxa
          receiverTokenAccount,
          escrow.account.receiver, // Dono do ATA
          escrow.account.mint // Token wSOL
      );

      if (isSender) {
        await program.methods.approveBySender()
          .accounts({
            sender: publicKey,
            escrow: escrow.publicKey,
            vault: vault,
            receiverTokenAccount: receiverTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .preInstructions([initAtaIx])
          .rpc();
      } else {
        await program.methods.approveByReceiver()
          .accounts({
            receiver: publicKey,
            escrow: escrow.publicKey,
            vault: vault,
            receiverTokenAccount: receiverTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .preInstructions([initAtaIx])
          .rpc();
      }
      setMsg("Aprovado com sucesso!");
      fetchEscrows();
      fetchBalance();
    } catch (e: any) {
      setMsg("Falha ao aprovar: " + e.message);
    }
  };

  const handleRefund = async (escrow: any) => {
    if (!program || !publicKey) return;
    try {
      const vault = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), escrow.publicKey.toBuffer()],
        program.programId
      )[0];
      const senderTokenAccount = getAssociatedTokenAddressSync(escrow.account.mint, escrow.account.sender, true);
      
      const initAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          senderTokenAccount,
          escrow.account.sender,
          escrow.account.mint
      );

      await program.methods.refund()
          .accounts({
            sender: publicKey,
            escrow: escrow.publicKey,
            vault: vault,
            senderTokenAccount: senderTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .preInstructions([initAtaIx])
          .rpc();
      
      setMsg("Refund concluído!");
      fetchEscrows();
      fetchBalance();
    } catch(e: any) {
      if (e.message.includes("TimelockNotExpired") || e.message.includes("6001")) {
          const tSecs = escrow.account.timelockSeconds?.toNumber() ?? 60;
          const tDays = Math.floor(tSecs / 86400);
          const tHrs = Math.floor((tSecs % 86400) / 3600);
          const tMins = Math.floor((tSecs % 3600) / 60);
          const parts = [];
          if (tDays > 0) parts.push(`${tDays}d`);
          if (tHrs > 0) parts.push(`${tHrs}h`);
          if (tMins > 0) parts.push(`${tMins}min`);
          const timelockLabel = parts.length > 0 ? parts.join(' ') : `${tSecs}s`;
          setMsg(`⏳ Proteção Ativa: O timelock deste depósito é de ${timelockLabel}. Aguarde o prazo expirar antes de solicitar o reembolso.`);
      } else {
          setMsg("Falha no Refund: " + e.message);
      }
    }
  };

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div className={styles.logo}>✦ DeferPay Escrow</div>
        <div style={{display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.9rem'}}>
            {solBal !== null && <div style={{color: '#fff', fontWeight: 'bold'}}>SOL: {solBal.toFixed(2)}</div>}
            {wSolBal !== null && <div style={{color: '#92FE9D', fontWeight: 'bold'}}>wSOL: {wSolBal.toFixed(2)}</div>}
            <WalletMultiButton />
        </div>
      </header>

      {msg && (
        <div className={styles.alertBox}>
          <span>{msg}</span>
          <button 
            onClick={() => setMsg("")}
            style={{background:'none', border:'none', color:'inherit', cursor:'pointer', marginLeft:'1rem', fontWeight:'bold', fontSize:'1rem', opacity: 0.6}}
            title="Fechar"
          >✕</button>
        </div>
      )}

      <main className={styles.mainGrid}>
        
        {/* Lado Esquerdo */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
             <h2>Criar Pagamento Protegido</h2>
             <p className={styles.desc}>Envie fundos que só serão liberados mediante confirmação dupla.</p>
          </div>
          <div className={styles.formGroup}>
            <label>Endereço de Destino (Receiver)</label>
            <input 
              className={styles.input} 
              value={receiverKey} 
              onChange={(e) => setReceiverKey(e.target.value)} 
              placeholder="Ex: FJKTbA..."
            />
          </div>
          <div className={styles.formGroup}>
            <label>Quantidade de Tokens a Depositar</label>
            <input 
              className={styles.input} 
              type="number" 
              value={amount} 
              onChange={(e) => setAmount(e.target.value)} 
            />
          </div>
          <div className={styles.formGroup}>
            <label>Timelock de Recuperação (D-HH:MM)</label>
            <input 
              className={styles.input} 
              value={timelockInput} 
              onChange={(e) => setTimelockInput(e.target.value)} 
              placeholder="Ex: 0-24:00"
            />
          </div>
          
          <button className={styles.primaryButton} onClick={handleDeposit} disabled={loading}>
            {loading ? "Processando..." : "Realizar Depósito"}
          </button>
        </div>

        {/* Lado Direito */}
        <div className={styles.card}>
            <div className={styles.cardHeader}>
             <h2>Painel de Transações</h2>
             <p className={styles.desc}>Seus recebimentos aguardando aprovação e depósitos pendentes.</p>
            </div>
            
            <div className={styles.list}>
                {escrows.length === 0 ? (
                    <div className={styles.emptyState}>
                        Nenhuma transação ativa encontrada.
                    </div>
                ) : (
                    escrows.map((e, idx) => {
                        const amSender = e.account.sender.equals(publicKey);
                        const iApproved = amSender ? e.account.senderApproved : e.account.receiverApproved;
                        const role = amSender ? "Enviado" : "Recebido";
                        const senderStatus = e.account.senderApproved ? "✅" : "⏳";
                        const receiverStatus = e.account.receiverApproved ? "✅" : "⏳";

                        const createdDate = new Date(e.account.createdAt.toNumber() * 1000).toLocaleString('pt-BR');
                        const tSecs = e.account.timelockSeconds.toNumber();
                        const tDays = Math.floor(tSecs / 86400);
                        const tHrs = Math.floor((tSecs % 86400) / 3600);
                        const tMins = Math.floor((tSecs % 3600) / 60);
                        const timelockStr = `${tDays}-${tHrs.toString().padStart(2,'0')}:${tMins.toString().padStart(2,'0')}`;
                        
                        return (
                            <div key={idx} className={styles.listItem}>
                                <div className={styles.itemInfo}>
                                    <div><strong>{role}:</strong> {e.account.amount.toNumber() / 1e9} Tokens</div>
                                    <div className={styles.smallDate}>Contra-parte: {amSender ? e.account.receiver.toBase58().slice(0, 6) : e.account.sender.toBase58().slice(0, 6)}...</div>
                                    <div className={styles.smallDate}>Criado: {createdDate} (Trava: {timelockStr})</div>
                                    <div className={styles.status}>
                                        <span style={{color: '#fff'}}>Aprovações:</span>
                                        <div style={{marginTop: '4px', fontSize: '0.85rem'}}>
                                            Remetente: {senderStatus} <br/>
                                            Destinatário: {receiverStatus}
                                        </div>
                                    </div>
                                </div>
                                <div className={styles.actionBlock}>
                                    {!iApproved && (
                                        <button className={styles.smButton} onClick={() => handleApprove(e)}>Aprovar</button>
                                    )}
                                    {amSender && (
                                        <button className={`${styles.smButton} ${styles.danger}`} onClick={() => handleRefund(e)}>Recuperar (Refund)</button>
                                    )}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
      </main>
    </div>
  );
}
