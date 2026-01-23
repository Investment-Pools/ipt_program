// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;

#[event]
pub struct PoolInitialized {
    pub pool: Pubkey,
    pub admin_authority: Pubkey,
    pub oracle_authority: Pubkey,
    pub fee_collector: Pubkey,
    pub usdc_mint: Pubkey,
    pub ipt_mint: Pubkey,
    pub initial_exchange_rate: u64,
    pub timestamp: i64,
}

#[event]
pub struct UserDepositExecuted {
    pub user: Pubkey,
    pub pool: Pubkey,
    pub usdc_amount: u64,
    pub ipt_amount: u64,
    pub deposit_fee: u64,
    pub exchange_rate: u64,
    pub new_ipt_supply: u64,
    pub new_reserves: u64,
    pub timestamp: i64,
}

#[event]
pub struct UserWithdrawalExecuted {
    pub user: Pubkey,
    pub pool: Pubkey,
    pub ipt_amount: u64,
    pub usdc_amount: u64,
    pub withdrawal_fee: u64,
    pub exchange_rate: u64,
    pub new_ipt_supply: u64,
    pub new_reserves: u64,
    pub timestamp: i64,
}

#[event]
pub struct AdminDepositExecuted {
    pub admin: Pubkey,
    pub pool: Pubkey,
    pub amount: u64,
    pub new_reserves: u64,
    pub timestamp: i64,
}

#[event]
pub struct AdminWithdrawExecuted {
    pub admin: Pubkey,
    pub pool: Pubkey,
    pub amount: u64,
    pub remaining_reserves: u64,
    pub timestamp: i64,
}

#[event]
pub struct FeeCollectorWithdrawExecuted {
    pub fee_collector: Pubkey,
    pub pool: Pubkey,
    pub amount: u64,
    pub remaining_accumulated_fees: u64,
    pub timestamp: i64,
}

#[event]
pub struct ExchangeRateUpdated {
    pub oracle: Pubkey,
    pub pool: Pubkey,
    pub old_rate: u64,
    pub new_rate: u64,
    pub timestamp: i64,
}

#[event]
pub struct PoolConfigUpdated {
    pub admin: Pubkey,
    pub pool: Pubkey,
    pub config_field: String,
    pub old_value: String,
    pub new_value: String,
    pub timestamp: i64,
}

#[event]
pub struct UserWithdrawalRequested {
    pub user: Pubkey,
    pub pool: Pubkey,
    pub ipt_amount: u64,
    pub expected_usdc_amount: u64,
    pub expected_withdrawal_fee: u64,
    pub min_usdc_amount: u64,
    pub exchange_rate: u64,
    pub timestamp: i64,
}

#[event]
pub struct AddedToQueue {
    pub user: Pubkey,
    pub amount: u64,
    pub position: u32,
}

#[event]
pub struct WithdrawExecuted {
    pub user: Pubkey,
    pub ipt_amount: u64,
    pub usdc_amount: u64,
    pub withdrawal_fee: u64,
    pub batch_index: u8,
}

#[event]
pub struct BatchWithdrawExecuted {
    pub executor: Pubkey,
    pub successful_count: u8,
    pub skipped_count: u8,
    pub total_ipt_burned: u64,
    pub total_usdc_transferred: u64,
    pub total_fees: u64,
    pub new_pool_reserves: u64,
    pub timestamp: i64,
}

#[event]
pub struct WithdrawSkipped {
    pub user: Pubkey,
    pub ipt_amount: u64,
    pub reason: String,
    pub batch_index: u8,
}

#[event]
pub struct WithdrawalCancelled {
    pub user: Pubkey,
    pub ipt_amount: u64,
    pub position: u32,
    pub timestamp: i64,
}