// SPDX-License-Identifier: Apache-2.0

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod states;
pub mod utils;

use instructions::*;
use states::*;

declare_id!("HpPJBUex6FdSw7CGvYzjtUmM1629RNTqgCyu6pfcyNBx");

#[program]
pub mod refi_ipt {
    use super::*;

    /// Initialize a new investment pool (step 1: create pool account)
    pub fn init_pool(ctx: Context<InitializePool>, config: PoolConfig) -> Result<()> {
        instructions::init_pool::handler(ctx, config)
    }

    /// Initialize pool mints and reserve (step 2: create IPT mint and USDC reserve)
    pub fn init_pool_step2(ctx: Context<InitializePoolStep2>) -> Result<()> {
        instructions::init_pool_step2::handler(ctx)
    }

    /// User deposits net USDC into pool and receives IPT (fees calculated internally)
    pub fn user_deposit(
        ctx: Context<UserDeposit>,
        net_usdc_amount: u64,
        min_ipt_amount: u64,
    ) -> Result<()> {
        instructions::user_deposit::handler(ctx, net_usdc_amount, min_ipt_amount)
    }

    /// User withdraws USDC by burning net IPT (fees calculated internally)
    pub fn user_withdraw(
        ctx: Context<UserWithdraw>,
        net_ipt_amount: u64,
        min_usdc_amount: u64,
    ) -> Result<()> {
        instructions::user_withdraw::handler(ctx, net_ipt_amount, min_usdc_amount)
    }

    /// Admin deposits USDC to increase pool reserves
    pub fn admin_deposit_usdc(ctx: Context<AdminDepositUsdc>, amount: u64) -> Result<()> {
        instructions::admin_deposit_usdc::handler(ctx, amount)
    }

    /// Admin withdraws USDC from pool reserves
    pub fn admin_withdraw_usdc(ctx: Context<AdminWithdrawUsdc>, amount: u64) -> Result<()> {
        instructions::admin_withdraw_usdc::handler(ctx, amount)
    }

    /// Fee collector withdraws accumulated fees
    pub fn fee_collector_withdraw(ctx: Context<FeeCollectorWithdraw>, amount: u64) -> Result<()> {
        instructions::fee_collector_withdraw::handler(ctx, amount)
    }

    /// Admin updates pool configuration
    pub fn admin_update_config(
        ctx: Context<AdminUpdateConfig>,
        new_config: PoolConfig,
    ) -> Result<()> {
        instructions::admin_update_config::handler(ctx, new_config)
    }

    /// Update exchange rate (oracle only)
    pub fn update_exchange_rate(ctx: Context<UpdateExchangeRate>, new_rate: u64) -> Result<()> {
        instructions::update_exchange_rate::handler(ctx, new_rate)
    }

    /// User creates withdrawal request
    pub fn user_withdrawal_request(
        ctx: Context<UserWithdrawalRequest>,
        net_ipt_amount: u64,
        min_usdc_amount: u64,
    ) -> Result<()> {
        instructions::user_withdrawal_request::handler(ctx, net_ipt_amount, min_usdc_amount)
    }

    /// Batch execute withdrawal requests from the queue
    pub fn batch_execute_withdraw<'info>(
        ctx: Context<'_, '_, 'info, 'info, BatchExecuteWithdraw<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        instructions::process_queue::batch_execute_withdraw(ctx, amounts)
    }

    /// User cancels their own withdrawal request
    pub fn cancel_withdrawal_request(ctx: Context<CancelWithdrawalRequest>) -> Result<()> {
        instructions::cancel_withdrawal::handler(ctx)
    }
}
