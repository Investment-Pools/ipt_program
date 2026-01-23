// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use crate::events::*;
use crate::states::*;
use crate::utils::{CalculationUtils, ValidationUtils};
use anchor_lang::prelude::*;
use anchor_spl::token::{burn, transfer, approve, Approve, Burn, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct UserWithdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// Pool state account
    #[account(
        mut,
        seeds = [
            Pool::SEED_PREFIX,
            pool.usdc_mint.as_ref()
        ],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: Pool authority (PDA)
    #[account(
        seeds = [
            Pool::SEED_PREFIX,
            pool.usdc_mint.as_ref()
        ],
        bump = pool.bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// User's USDC token account
    #[account(
        mut,
        token::mint = pool.usdc_mint,
        token::authority = user
    )]
    pub user_usdc_account: Account<'info, TokenAccount>,

    /// User's IPT token account
    #[account(
        mut,
        token::mint = pool.ipt_mint,
        token::authority = user
    )]
    pub user_ipt_account: Account<'info, TokenAccount>,

    /// Pool's USDC reserve
    #[account(
        mut,
        address = pool.usdc_reserve
    )]
    pub pool_usdc_reserve: Account<'info, TokenAccount>,

    /// IPT mint
    #[account(
        mut,
        address = pool.ipt_mint
    )]
    pub ipt_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

// #[access_control(not_locked(&ctx.accounts))]
pub fn handler(
    ctx: Context<UserWithdraw>,
    net_ipt_amount: u64,
    min_usdc_amount: u64,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;
    let user = ctx.accounts.user.key();
    ValidationUtils::validate_pool_state_for_operation(&pool.pool_state, false)?;

    require!(net_ipt_amount > 0, PoolError::InvalidAmount);

    // Sync state with actual balance BEFORE processing
    let actual_reserve_balance = ctx.accounts.pool_usdc_reserve.amount;
    if pool.total_usdc_reserves != actual_reserve_balance {
        msg!(
            "SYNC: pool.total_usdc_reserves {} -> {} (actual balance)",
            pool.total_usdc_reserves,
            actual_reserve_balance
        );
        pool.total_usdc_reserves = actual_reserve_balance;
    }

    // Check user has sufficient IPT balance
    require!(
        ctx.accounts.user_ipt_account.amount >= net_ipt_amount,
        PoolError::InsufficientAccountBalance
    );
    // Calculate net USDC amount and withdrawal fee from net IPT amount
    let (net_usdc_amount, withdrawal_fee) =
        CalculationUtils::calculate_usdc_from_net_ipt_withdrawal(
            net_ipt_amount,
            pool.current_exchange_rate,
            pool.config.withdrawal_fee_bps,
        )?;

    // Check slippage protection (user expects at least min_usdc_amount USDC)
    require!(
        net_usdc_amount >= min_usdc_amount,
        PoolError::SlippageExceeded
    );

    let gross_usdc_amount = net_usdc_amount
        .checked_add(withdrawal_fee)
        .ok_or(PoolError::MathematicalOverflow)?;
    if ctx.accounts.pool_usdc_reserve.amount >= gross_usdc_amount {
        // Burn net IPT amount from user
        burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.ipt_mint.to_account_info(),
                    from: ctx.accounts.user_ipt_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            net_ipt_amount,
        )?;
    
        // Transfer net USDC amount (after fees) from pool reserve to user
        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_usdc_reserve.to_account_info(),
                    to: ctx.accounts.user_usdc_account.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                &[&pool.authority_seeds()],
            ),
            net_usdc_amount,
        )?;
    
        // Update pool state
        pool.total_ipt_supply = pool
            .total_ipt_supply
            .checked_sub(net_ipt_amount)
            .ok_or(PoolError::MathematicalOverflow)?;

        pool.total_usdc_reserves = pool
            .total_usdc_reserves
            .checked_sub(gross_usdc_amount)
            .ok_or(PoolError::MathematicalUnderflow)?;

        pool.total_accumulated_fees = pool
            .total_accumulated_fees
            .checked_add(withdrawal_fee)
            .ok_or(PoolError::MathematicalOverflow)?;

        // Emit event
        emit!(UserWithdrawalExecuted {
            user: ctx.accounts.user.key(),
            pool: pool.key(),
            ipt_amount: net_ipt_amount,
            usdc_amount: net_usdc_amount,
            withdrawal_fee,
            exchange_rate: pool.current_exchange_rate,
            new_ipt_supply: pool.total_ipt_supply,
            new_reserves: pool.total_usdc_reserves,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "User burned {} IPT, received {} USDC (fee: {}). Pool reserves: {}",
            net_ipt_amount,
            net_usdc_amount,
            withdrawal_fee,
            pool.total_usdc_reserves
        );
    
        Ok(())
    } else {
        approve(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Approve {
                    to: ctx.accounts.user_ipt_account.to_account_info(),
                    delegate: ctx.accounts.pool_authority.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            net_ipt_amount,  // Only approve exactly this amount
        )?;
        // Check queue size limit
        require!(
            pool.pending_queue.len() < pool.config.max_queue_size as usize,
            PoolError::QueueFull
        );

        // Check user is not already in queue
        require!(
            !pool.pending_queue.iter().any(|w| w.user == user),
            PoolError::AlreadyInQueue
        );

        let position = pool.pending_queue.len() as u32;
        pool.pending_queue.push(PendingWithdraw {
            user,
            amount: net_ipt_amount,
            min_usdc_amount,
        });
        emit!(AddedToQueue {
            user,
            amount: net_ipt_amount,
            position,
        });

        Ok(())
    }
}

// fn not_locked(vault: &Account<VaultState>) -> Result<()> {
//     require!(!vault.is_locked, ErrorCode::Locked);
//     Ok(())
// }