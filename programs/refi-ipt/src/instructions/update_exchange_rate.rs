// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use crate::events::*;
use crate::states::*;
use crate::utils::ValidationUtils;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateExchangeRate<'info> {
    #[account(mut)]
    pub oracle: Signer<'info>,

    /// Pool state account
    #[account(
        mut,
        seeds = [
            Pool::SEED_PREFIX,
            pool.usdc_mint.as_ref()
        ],
        bump = pool.bump,
        constraint = oracle.key() == pool.config.oracle_authority @ PoolError::UnauthorizedOracle
    )]
    pub pool: Account<'info, Pool>,
}

pub fn handler(ctx: Context<UpdateExchangeRate>, new_rate: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Validate the new exchange rate
    ValidationUtils::validate_exchange_rate(new_rate)?;

    let old_rate = pool.current_exchange_rate;

    // Don't allow no-op updates
    require!(new_rate != old_rate, PoolError::InvalidExchangeRate);

    // Update the exchange rate
    pool.current_exchange_rate = new_rate;
    pool.last_rate_update = clock.unix_timestamp;

    // Emit event
    emit!(ExchangeRateUpdated {
        oracle: ctx.accounts.oracle.key(),
        pool: pool.key(),
        old_rate,
        new_rate,
        timestamp: clock.unix_timestamp,
    });

    msg!("Exchange rate updated from {} to {}", old_rate, new_rate);

    Ok(())
}
