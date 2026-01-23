// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use crate::states::*;
use anchor_lang::prelude::*;

pub struct ValidationUtils;

impl ValidationUtils {
    /// Validate pool configuration
    pub fn validate_pool_config(config: &PoolConfig) -> Result<()> {
        // Validate fee rates are within valid range (0-10000 basis points = 0-100%)
        require!(
            config.deposit_fee_bps <= 10_000,
            PoolError::InvalidFeeRate
        );
        require!(
            config.withdrawal_fee_bps <= 10_000,
            PoolError::InvalidFeeRate
        );
        require!(
            config.management_fee_bps <= 10_000,
            PoolError::InvalidFeeRate
        );

        // Validate exchange rate
        require!(
            config.initial_exchange_rate > 0,
            PoolError::InvalidExchangeRate
        );

        // Validate authorities are not default pubkey
        require!(
            config.admin_authority != Pubkey::default(),
            PoolError::InvalidAuthority
        );
        require!(
            config.oracle_authority != Pubkey::default(),
            PoolError::InvalidAuthority
        );
        require!(
            config.fee_collector != Pubkey::default(),
            PoolError::InvalidAuthority
        );

        // Validate max_queue_size doesn't exceed account allocation
        require!(
            config.max_queue_size as usize <= Pool::MAX_QUEUE_SIZE,
            PoolError::InvalidConfigParameter
        );

        Ok(())
    }

    /// Validate exchange rate
    pub fn validate_exchange_rate(rate: u64) -> Result<()> {
        require!(rate > 0, PoolError::InvalidExchangeRate);
        Ok(())
    }

    /// Validate pool state for operation
    pub fn validate_pool_state_for_operation(
        pool_state: &PoolState,
        is_deposit: bool,
    ) -> Result<()> {
        match pool_state {
            PoolState::Active => Ok(()),
            PoolState::Paused => Err(PoolError::PoolPaused.into()),
            PoolState::Frozen => Err(PoolError::PoolFrozen.into()),
            PoolState::DepositOnly => {
                if is_deposit {
                    Ok(())
                } else {
                    Err(PoolError::WithdrawalsDisabled.into())
                }
            }
            PoolState::WithdrawOnly => {
                if is_deposit {
                    Err(PoolError::DepositsDisabled.into())
                } else {
                    Ok(())
                }
            }
        }
    }
}
