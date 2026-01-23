// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use crate::events::*;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct AdminWithdrawUsdc<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Pool state account
    #[account(
        mut,
        seeds = [
            Pool::SEED_PREFIX,
            pool.usdc_mint.as_ref()
        ],
        bump = pool.bump,
        constraint = admin.key() == pool.config.admin_authority @ PoolError::UnauthorizedAdmin
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

    /// Admin's USDC token account
    #[account(
        mut,
        token::mint = pool.usdc_mint,
        token::authority = admin
    )]
    pub admin_usdc_account: Account<'info, TokenAccount>,

    /// Pool's USDC reserve
    #[account(
        mut,
        address = pool.usdc_reserve
    )]
    pub pool_usdc_reserve: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<AdminWithdrawUsdc>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Validate amount
    require!(amount > 0, PoolError::ZeroAmountNotAllowed);

    // Check if pool has enough reserves
    require!(
        ctx.accounts.pool_usdc_reserve.amount >= amount,
        PoolError::InsufficientReserves
    );
    // Transfer USDC from pool to admin
    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.pool_usdc_reserve.to_account_info(),
                to: ctx.accounts.admin_usdc_account.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[&pool.authority_seeds()],
        ),
        amount,
    )?;

    // Update pool reserves
    pool.total_usdc_reserves = pool.total_usdc_reserves
        .checked_sub(amount)
        .ok_or(PoolError::MathematicalUnderflow)?;

    // Emit event
    emit!(AdminWithdrawExecuted {
        admin: ctx.accounts.admin.key(),
        pool: pool.key(),
        amount,
        remaining_reserves: pool.total_usdc_reserves,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Admin withdrew {} USDC. Remaining reserves: {}",
        amount,
        pool.total_usdc_reserves
    );

    Ok(())
}
