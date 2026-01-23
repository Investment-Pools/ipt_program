// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use crate::events::*;
use crate::states::*;
use crate::utils::{CalculationUtils, ValidationUtils};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

#[derive(Accounts)]
pub struct UserWithdrawalRequest<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// Pool state account (read-only for validation)
    #[account(
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

    /// User's IPT token account (read-only for validation)
    #[account(
        token::mint = pool.ipt_mint,
        token::authority = user
    )]
    pub user_ipt_account: Account<'info, TokenAccount>,

    /// IPT mint (read-only for validation)
    #[account(
        address = pool.ipt_mint
    )]
    pub ipt_mint: Account<'info, Mint>,
}

pub fn handler(
    ctx: Context<UserWithdrawalRequest>,
    net_ipt_amount: u64,
    min_usdc_amount: u64,
) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let clock = Clock::get()?;

    // Validate pool state
    ValidationUtils::validate_pool_state_for_operation(&pool.pool_state, false)?;

    // Validate net IPT amount is greater than 0
    require!(net_ipt_amount > 0, PoolError::InvalidAmount);

    // Check user has sufficient IPT balance
    require!(
        ctx.accounts.user_ipt_account.amount >= net_ipt_amount,
        PoolError::InsufficientAccountBalance
    );

    // Check if user has approved pool authority to burn their IPT tokens
    require!(
        ctx.accounts.user_ipt_account.delegated_amount >= net_ipt_amount,
        PoolError::InsufficientApproval
    );

    // Verify that the delegate is the pool authority (PDA)
    require!(
        ctx.accounts.user_ipt_account.delegate.is_some()
            && ctx.accounts.user_ipt_account.delegate.unwrap() == ctx.accounts.pool_authority.key(),
        PoolError::InvalidDelegate
    );

    // Calculate expected net USDC amount and withdrawal fee from net IPT amount
    let (expected_net_usdc_amount, withdrawal_fee) =
        CalculationUtils::calculate_usdc_from_net_ipt_withdrawal(
            net_ipt_amount,
            pool.current_exchange_rate,
            pool.config.withdrawal_fee_bps,
        )?;

    // Check slippage protection
    require!(
        expected_net_usdc_amount >= min_usdc_amount,
        PoolError::SlippageExceeded
    );

    // Emit withdrawal request event for backend to capture
    emit!(UserWithdrawalRequested {
        user: ctx.accounts.user.key(),
        pool: pool.key(),
        ipt_amount: net_ipt_amount,
        expected_usdc_amount: expected_net_usdc_amount,
        expected_withdrawal_fee: withdrawal_fee,
        min_usdc_amount,
        exchange_rate: pool.current_exchange_rate,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "User {} requested withdrawal of {} IPT (expected {} USDC, min {} USDC, fee: {})",
        ctx.accounts.user.key(),
        net_ipt_amount,
        expected_net_usdc_amount,
        min_usdc_amount,
        withdrawal_fee
    );

    Ok(())
}
