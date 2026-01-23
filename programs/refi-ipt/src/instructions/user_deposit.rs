// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use crate::events::*;
use crate::states::*;
use crate::utils::{CalculationUtils, ValidationUtils};
use anchor_lang::prelude::*;
use anchor_spl::token::{mint_to, transfer, Mint, MintTo, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct UserDeposit<'info> {
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
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<UserDeposit>, net_usdc_amount: u64, min_ipt_amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool; 
    let clock = Clock::get()?;

    // Validate pool state
    ValidationUtils::validate_pool_state_for_operation(&pool.pool_state, true)?;

    // Validate deposit amount is greater than 0
    require!(net_usdc_amount > 0, PoolError::InvalidAmount);

    // Calculate IPT amount, deposit fee, and gross USDC amount from net amount
    let (ipt_amount, deposit_fee, gross_usdc_amount) =
        CalculationUtils::calculate_ipt_from_net_usdc_deposit(
            net_usdc_amount,
            pool.current_exchange_rate,
            pool.config.deposit_fee_bps,
        )?;

    // Check user has sufficient USDC balance for gross amount
    require!(
        ctx.accounts.user_usdc_account.amount >= gross_usdc_amount,
        PoolError::InsufficientAccountBalance
    );

    // Check slippage protection
    require!(ipt_amount >= min_ipt_amount, PoolError::SlippageExceeded);

    // Check max total supply limit (if set)
    if pool.max_total_supply > 0 {
        let new_total_supply = pool
            .total_ipt_supply
            .checked_add(ipt_amount)
            .ok_or(PoolError::MathematicalOverflow)?;

        require!(
            new_total_supply <= pool.max_total_supply,
            PoolError::MaxTotalSupplyExceeded
        );
    }

    // Transfer gross USDC amount (including fees) from user to pool reserve
    transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_usdc_account.to_account_info(),
                to: ctx.accounts.pool_usdc_reserve.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        gross_usdc_amount,
    )?;

    // Mint IPT to user
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.ipt_mint.to_account_info(),
                to: ctx.accounts.user_ipt_account.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[&pool.authority_seeds()],
        ),
        ipt_amount,
    )?;

    // Update pool state
    pool.total_ipt_supply = pool
        .total_ipt_supply
        .checked_add(ipt_amount)
        .ok_or(PoolError::MathematicalOverflow)?;

    pool.total_usdc_reserves = pool
        .total_usdc_reserves
        .checked_add(gross_usdc_amount)
        .ok_or(PoolError::MathematicalOverflow)?;

    pool.total_accumulated_fees = pool
        .total_accumulated_fees
        .checked_add(deposit_fee)
        .ok_or(PoolError::MathematicalOverflow)?;

    // Emit event
    emit!(UserDepositExecuted {
        user: ctx.accounts.user.key(),
        pool: pool.key(),
        usdc_amount: gross_usdc_amount,
        ipt_amount,
        deposit_fee,
        exchange_rate: pool.current_exchange_rate,
        new_ipt_supply: pool.total_ipt_supply,
        new_reserves: pool.total_usdc_reserves,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "User deposited {} USDC (fee: {}), received {} IPT. Pool reserves: {}",
        gross_usdc_amount,
        deposit_fee,
        ipt_amount,
        pool.total_usdc_reserves
    );

    Ok(())
}
