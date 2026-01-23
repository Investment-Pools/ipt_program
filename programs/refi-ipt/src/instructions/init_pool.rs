// SPDX-License-Identifier: Apache-2.0

use crate::events::*;
use crate::states::*;
use crate::utils::ValidationUtils;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// USDC mint
    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,

    /// Pool state account
    #[account(
        init,
        payer = payer,
        space = Pool::LEN,
        seeds = [
            Pool::SEED_PREFIX,
            usdc_mint.key().as_ref()
        ],
        bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializePool>, config: PoolConfig) -> Result<()> {
    ValidationUtils::validate_pool_config(&config)?;

    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;
    
    // Pool authority is the same as pool PDA (derived from same seeds)
    let pool_authority = pool.key();

    // Initialize pool state
    pool.pool_authority = pool_authority;
    pool.usdc_mint = ctx.accounts.usdc_mint.key();
    pool.ipt_mint = Pubkey::default();
    pool.usdc_reserve = Pubkey::default(); 

    // Set initial exchange rate
    pool.current_exchange_rate = config.initial_exchange_rate;

    // Initialize counters
    pool.total_ipt_supply = 0;
    pool.max_total_supply = config.max_total_supply;
    pool.total_usdc_reserves = 0;
    pool.total_accumulated_fees = 0;

    // Set configuration
    pool.config = config.clone();

    // Set initial state
    pool.pool_state = PoolState::Active;

    // Set timestamps
    pool.last_rate_update = clock.unix_timestamp;
    pool.created_at = clock.unix_timestamp;

    // Set bump
    pool.bump = ctx.bumps.pool;
    pool.pending_queue = Vec::new();

    // Emit event
    emit!(PoolInitialized {
        pool: pool.key(),
        admin_authority: config.admin_authority,
        oracle_authority: config.oracle_authority,
        fee_collector: config.fee_collector,
        usdc_mint: ctx.accounts.usdc_mint.key(),
        ipt_mint: Pubkey::default(),
        initial_exchange_rate: config.initial_exchange_rate,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Pool initialized with exchange rate: {}",
        config.initial_exchange_rate
    );

    Ok(())
}