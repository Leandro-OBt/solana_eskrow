use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, CloseAccount};

declare_id!("5AQuMCykC6W5fH5JWoajGtQ6VT2MUYVsDHQdmut2NPZv");

#[program]
pub mod escrow {
    use super::*;

    pub fn initialize_and_deposit(
        ctx: Context<InitializeAndDeposit>,
        seed_id: u64,
        amount: u64,
        timelock_seconds: i64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.sender = ctx.accounts.sender.key();
        escrow.receiver = ctx.accounts.receiver.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.sender_approved = false;
        escrow.receiver_approved = false;
        
        let clock = Clock::get()?;
        escrow.created_at = clock.unix_timestamp;
        escrow.seed_id = seed_id;
        escrow.timelock_seconds = timelock_seconds;
        escrow.bump = ctx.bumps.escrow;

        // Move tokens from sender to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.sender_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.sender.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn approve_by_sender(ctx: Context<ApproveSender>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(escrow.amount > 0, ErrorCode::AlreadyExecuted);
        
        escrow.sender_approved = true;

        if escrow.receiver_approved {
            escrow.amount = 0; // mark as executed
            execute_release(
                &escrow,
                &ctx.accounts.vault,
                &ctx.accounts.receiver_token_account,
                &ctx.accounts.sender,
                &ctx.accounts.token_program,
            )?;
        }
        Ok(())
    }

    pub fn approve_by_receiver(ctx: Context<ApproveReceiver>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(escrow.amount > 0, ErrorCode::AlreadyExecuted);

        escrow.receiver_approved = true;

        if escrow.sender_approved {
            escrow.amount = 0; // mark as executed
            execute_release(
                &escrow,
                &ctx.accounts.vault,
                &ctx.accounts.receiver_token_account,
                &ctx.accounts.receiver,
                &ctx.accounts.token_program,
            )?;
        }
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(escrow.amount > 0, ErrorCode::AlreadyExecuted);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= escrow.created_at + escrow.timelock_seconds, ErrorCode::TimelockNotExpired);

        escrow.amount = 0; // mark as refunded

        execute_release(
            &escrow,
            &ctx.accounts.vault,
            &ctx.accounts.sender_token_account,
            &ctx.accounts.sender,
            &ctx.accounts.token_program,
        )?;

        Ok(())
    }
}

// ----------------------------------------------------
// Função auxiliar de liberação de tokens e fechamento
// ----------------------------------------------------
fn execute_release<'info>(
    escrow: &Account<'info, PaymentEscrow>,
    vault: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    rent_collector: &Signer<'info>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    
    let escrow_key = escrow.sender.key();
    let seed_id_bytes = escrow.seed_id.to_le_bytes();
    let bump_bytes = escrow.bump.to_le_bytes();
    
    let authority_seeds = &[
        b"escrow".as_ref(),
        escrow_key.as_ref(),
        seed_id_bytes.as_ref(),
        bump_bytes.as_ref(),
    ];
    let signer = &[&authority_seeds[..]];

    // 1. Vault -> Destination
    let cpi_accounts = Transfer {
        from: vault.to_account_info(),
        to: destination.to_account_info(),
        authority: escrow.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(), 
        cpi_accounts, 
        signer
    );
    // Transfere o que restou no vault
    token::transfer(cpi_ctx, vault.amount)?;

    // 2. Fechar Vault token account para devolver aluguel
    let cpi_close = CloseAccount {
        account: vault.to_account_info(),
        destination: rent_collector.to_account_info(),
        authority: escrow.to_account_info(),
    };
    let cpi_ctx_close = CpiContext::new_with_signer(token_program.to_account_info(), cpi_close, signer);
    token::close_account(cpi_ctx_close)?;

    Ok(())
}

// ----------------------------------------------------
// Estruturas de Dados
// ----------------------------------------------------

#[account]
pub struct PaymentEscrow {
    pub sender: Pubkey,
    pub receiver: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub sender_approved: bool,
    pub receiver_approved: bool,
    pub created_at: i64,
    pub seed_id: u64,
    pub timelock_seconds: i64,
    pub bump: u8,
}

impl PaymentEscrow {
    pub const SPACE: usize = 32 + 32 + 32 + 8 + 1 + 1 + 8 + 8 + 8 + 1;
}

// ----------------------------------------------------
// Contextos
// ----------------------------------------------------

#[derive(Accounts)]
#[instruction(seed_id: u64, amount: u64, timelock_seconds: i64)]
pub struct InitializeAndDeposit<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    
    /// CHECK: Public key do recebedor
    pub receiver: AccountInfo<'info>,
    
    pub mint: Account<'info, Mint>,

    #[account(mut, token::mint = mint)]
    pub sender_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = sender,
        space = 8 + PaymentEscrow::SPACE,
        seeds = [b"escrow", sender.key().as_ref(), seed_id.to_le_bytes().as_ref()],
        bump
    )]
    pub escrow: Account<'info, PaymentEscrow>,

    #[account(
        init,
        payer = sender,
        token::mint = mint,
        token::authority = escrow,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ApproveSender<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    // Apenas o Sender do contrato específico assina este approve
    #[account(mut, has_one = sender)]
    pub escrow: Account<'info, PaymentEscrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    // Nós vamos forçar que o receiver receba do mesmo mint.
    #[account(mut, token::mint = escrow.mint)]
    pub receiver_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ApproveReceiver<'info> {
    #[account(mut)]
    pub receiver: Signer<'info>,

    // Apenas o Receiver assina
    #[account(mut, has_one = receiver)]
    pub escrow: Account<'info, PaymentEscrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = escrow.mint)]
    pub receiver_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(mut, has_one = sender)]
    pub escrow: Account<'info, PaymentEscrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = escrow.mint)]
    pub sender_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Este depósito já foi executado ou cancelado.")]
    AlreadyExecuted,
    #[msg("Você deve aguardar o tempo limite definido da trava expirar antes do refund.")]
    TimelockNotExpired,
}
