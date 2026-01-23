// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use crate::events::*;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct FeeCollectorWithdraw<'info> {
    #[account(mut)]
    pub fee_collector: Signer<'info>,

    /// Pool state account
    #[account(
        mut,
        seeds = [
            Pool::SEED_PREFIX,
            pool.usdc_mint.as_ref()
        ],
        bump = pool.bump,
        constraint = fee_collector.key() == pool.config.fee_collector @ PoolError::UnauthorizedFeeCollector
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

    /// Fee collector's USDC token account
    #[account(
        mut,
        token::mint = pool.usdc_mint,
        token::authority = fee_collector
    )]
    pub fee_collector_usdc_account: Account<'info, TokenAccount>,

    /// Pool's USDC reserve
    #[account(
        mut,
        address = pool.usdc_reserve
    )]
    pub pool_usdc_reserve: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<FeeCollectorWithdraw>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Validate amount
    require!(amount > 0, PoolError::ZeroAmountNotAllowed);

    // Check if there are enough accumulated fees
    require!(
        pool.total_accumulated_fees >= amount,
        PoolError::InsufficientAccumulatedFees
    );

    // Check if pool has enough reserves
    require!(
        ctx.accounts.pool_usdc_reserve.amount >= amount,
        PoolError::InsufficientReserves
    );

    // Transfer USDC from pool to fee collector
    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.pool_usdc_reserve.to_account_info(),
                to: ctx.accounts.fee_collector_usdc_account.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[&pool.authority_seeds()],
        ),
        amount,
    )?;

    // Update pool state
    pool.total_accumulated_fees = pool
        .total_accumulated_fees
        .checked_sub(amount)
        .ok_or(PoolError::MathematicalUnderflow)?;

    pool.total_usdc_reserves = pool
        .total_usdc_reserves
        .checked_sub(amount)
        .ok_or(PoolError::MathematicalUnderflow)?;

    // Emit event
    emit!(FeeCollectorWithdrawExecuted {
        fee_collector: ctx.accounts.fee_collector.key(),
        pool: pool.key(),
        amount,
        remaining_accumulated_fees: pool.total_accumulated_fees,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Fee collector withdrew {} USDC. Remaining accumulated fees: {}",
        amount,
        pool.total_accumulated_fees
    );

    Ok(())
}
