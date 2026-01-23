// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use crate::events::*;
use crate::states::*;
use crate::utils::ValidationUtils;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct AdminUpdateConfig<'info> {
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
}

pub fn handler(ctx: Context<AdminUpdateConfig>, new_config: PoolConfig) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Validate new configuration
    ValidationUtils::validate_pool_config(&new_config)?;

    // Track changes for events
    let old_config = pool.config.clone();

    // Critical checks for sensitive changes
    if new_config.admin_authority != old_config.admin_authority {
        emit!(PoolConfigUpdated {
            admin: ctx.accounts.admin.key(),
            pool: pool.key(),
            config_field: "admin_authority".to_string(),
            old_value: old_config.admin_authority.to_string(),
            new_value: new_config.admin_authority.to_string(),
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "CRITICAL: Admin authority changed from {} to {}",
            old_config.admin_authority,
            new_config.admin_authority
        );
    }

    if new_config.oracle_authority != old_config.oracle_authority {
        emit!(PoolConfigUpdated {
            admin: ctx.accounts.admin.key(),
            pool: pool.key(),
            config_field: "oracle_authority".to_string(),
            old_value: old_config.oracle_authority.to_string(),
            new_value: new_config.oracle_authority.to_string(),
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Oracle authority changed from {} to {}",
            old_config.oracle_authority,
            new_config.oracle_authority
        );
    }

    if new_config.fee_collector != old_config.fee_collector {
        emit!(PoolConfigUpdated {
            admin: ctx.accounts.admin.key(),
            pool: pool.key(),
            config_field: "fee_collector".to_string(),
            old_value: old_config.fee_collector.to_string(),
            new_value: new_config.fee_collector.to_string(),
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Fee collector changed from {} to {}",
            old_config.fee_collector,
            new_config.fee_collector
        );
    }

    // Fee rate changes
    if new_config.deposit_fee_bps != old_config.deposit_fee_bps {
        emit!(PoolConfigUpdated {
            admin: ctx.accounts.admin.key(),
            pool: pool.key(),
            config_field: "deposit_fee_bps".to_string(),
            old_value: old_config.deposit_fee_bps.to_string(),
            new_value: new_config.deposit_fee_bps.to_string(),
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Deposit fee changed from {}bps to {}bps",
            old_config.deposit_fee_bps,
            new_config.deposit_fee_bps
        );
    }

    if new_config.withdrawal_fee_bps != old_config.withdrawal_fee_bps {
        emit!(PoolConfigUpdated {
            admin: ctx.accounts.admin.key(),
            pool: pool.key(),
            config_field: "withdrawal_fee_bps".to_string(),
            old_value: old_config.withdrawal_fee_bps.to_string(),
            new_value: new_config.withdrawal_fee_bps.to_string(),
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Withdrawal fee changed from {}bps to {}bps",
            old_config.withdrawal_fee_bps,
            new_config.withdrawal_fee_bps
        );
    }

    if new_config.management_fee_bps != old_config.management_fee_bps {
        emit!(PoolConfigUpdated {
            admin: ctx.accounts.admin.key(),
            pool: pool.key(),
            config_field: "management_fee_bps".to_string(),
            old_value: old_config.management_fee_bps.to_string(),
            new_value: new_config.management_fee_bps.to_string(),
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Management fee changed from {}bps to {}bps",
            old_config.management_fee_bps,
            new_config.management_fee_bps
        );
    }

    // Update the configuration
    pool.config = new_config;

    msg!("Pool configuration updated successfully");

    Ok(())
}
