// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use crate::events::*;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct AdminDepositUsdc<'info> {
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

pub fn handler(ctx: Context<AdminDepositUsdc>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Validate amount
    require!(amount > 0, PoolError::ZeroAmountNotAllowed);

    // Validate admin has sufficient USDC balance
    require!(
        ctx.accounts.admin_usdc_account.amount >= amount,
        PoolError::InsufficientAccountBalance
    );
    
    // Transfer USDC from admin to pool reserve
    transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.admin_usdc_account.to_account_info(),
                to: ctx.accounts.pool_usdc_reserve.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update pool reserves
    pool.total_usdc_reserves = pool.total_usdc_reserves
        .checked_add(amount)
        .ok_or(PoolError::MathematicalOverflow)?;

    // Emit event
    emit!(AdminDepositExecuted {
        admin: ctx.accounts.admin.key(),
        pool: pool.key(),
        amount,
        new_reserves: pool.total_usdc_reserves,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Admin deposited {} USDC. New reserves: {}",
        amount,
        pool.total_usdc_reserves
    );

    Ok(())
}
