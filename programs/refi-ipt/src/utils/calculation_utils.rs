// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use anchor_lang::prelude::*;

pub struct CalculationUtils;

impl CalculationUtils {
    /// Calculate fee amount in basis points
    pub fn calculate_fee(amount: u64, fee_bps: u16) -> Result<u64> {
        if fee_bps == 0 {
            return Ok(0);
        }

        amount
            .checked_mul(fee_bps as u64)
            .ok_or(PoolError::MathematicalOverflow)?
            .checked_div(10_000)
            .ok_or(PoolError::DivisionByZero.into())
    }

    /// Calculate IPT amount from net USDC deposit
    pub fn calculate_ipt_from_net_usdc_deposit(
        net_usdc_amount: u64,
        exchange_rate: u64,
        deposit_fee_bps: u16,
    ) -> Result<(u64, u64, u64)> {
        let deposit_fee = Self::calculate_fee(net_usdc_amount, deposit_fee_bps)?;

        let gross_usdc_amount = net_usdc_amount
            .checked_add(deposit_fee)
            .ok_or(PoolError::MathematicalOverflow)?;

        let ipt_amount = net_usdc_amount
            .checked_mul(1_000_000)
            .ok_or(PoolError::MathematicalOverflow)?
            .checked_div(exchange_rate)
            .ok_or(PoolError::DivisionByZero)?;

        Ok((ipt_amount, deposit_fee, gross_usdc_amount))
    }

    /// Calculate USDC amount from net IPT withdrawal
    pub fn calculate_usdc_from_net_ipt_withdrawal(
        net_ipt_amount: u64,
        exchange_rate: u64,
        withdrawal_fee_bps: u16,
    ) -> Result<(u64, u64)> {
        let gross_usdc_amount = net_ipt_amount
            .checked_mul(exchange_rate)
            .ok_or(PoolError::MathematicalOverflow)?
            .checked_div(1_000_000)
            .ok_or(PoolError::DivisionByZero)?;

        let withdrawal_fee = Self::calculate_fee(gross_usdc_amount, withdrawal_fee_bps)?;

        let net_usdc_amount = gross_usdc_amount
            .checked_sub(withdrawal_fee)
            .ok_or(PoolError::MathematicalUnderflow)?;

        Ok((net_usdc_amount, withdrawal_fee))
    }
}
