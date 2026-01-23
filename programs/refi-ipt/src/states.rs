// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;

#[account]
pub struct Pool {
    /// Pool authority (PDA)
    pub pool_authority: Pubkey,
    /// USDC mint address
    pub usdc_mint: Pubkey,
    /// IPT mint address
    pub ipt_mint: Pubkey,
    /// USDC reserve token account
    pub usdc_reserve: Pubkey,
    pub pending_queue: Vec<PendingWithdraw>,

    /// Current exchange rate (IPT to USDC, scaled by 1e6)
    /// e.g., 1.02 USDC per IPT = 1_020_000
    pub current_exchange_rate: u64,

    /// Total IPT supply in circulation
    pub total_ipt_supply: u64,
    /// Total USDC reserves in pool
    pub total_usdc_reserves: u64,
    /// Total accumulated fees
    pub total_accumulated_fees: u64,
    /// Maximum total IPT supply allowed (0 = unlimited)
    pub max_total_supply: u64,

    /// Pool configuration
    pub config: PoolConfig,

    /// Pool state
    pub pool_state: PoolState,

    /// Timestamps
    pub last_rate_update: i64,
    pub created_at: i64,

    /// PDA bump
    pub bump: u8,
}

impl Pool {
    pub const SEED_PREFIX: &'static [u8] = b"pool";
    
    // Maximum queue size for account allocation
    // Each PendingWithdraw = 32 (Pubkey) + 8 (u64) + 8 (u64) = 48 bytes
    pub const MAX_QUEUE_SIZE: usize = 20;
    pub const PENDING_WITHDRAW_SIZE: usize = 32 + 8 + 8; // 48 bytes

    pub const LEN: usize = 8 + // discriminator
        32 + // pool_authority
        32 + // usdc_mint
        32 + // ipt_mint
        32 + // usdc_reserve
        4 +  // pending_queue vec length prefix
        (Self::MAX_QUEUE_SIZE * Self::PENDING_WITHDRAW_SIZE) + // pending_queue data: MAX_QUEUE_SIZE items × 48 bytes
        8 +  // current_exchange_rate
        8 +  // total_ipt_supply
        8 +  // total_usdc_reserves
        8 +  // total_accumulated_fees
        8 +  // max_total_supply
        PoolConfig::LEN + // config
        1 +  // pool_state
        8 +  // last_rate_update
        8 +  // created_at
        1;   // bump

    pub fn authority_seeds(&self) -> [&[u8]; 3] {
        [
            Self::SEED_PREFIX,
            self.usdc_mint.as_ref(),
            std::slice::from_ref(&self.bump),
        ]
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PoolConfig {
    /// Admin authority
    pub admin_authority: Pubkey,
    /// Oracle authority
    pub oracle_authority: Pubkey,
    /// Fee collector address
    pub fee_collector: Pubkey,

    /// Fee rates in basis points (100 = 1%)
    pub deposit_fee_bps: u16,
    pub withdrawal_fee_bps: u16,
    pub management_fee_bps: u16,

    /// Initial exchange rate (IPT to USDC, scaled by 1e6)
    pub initial_exchange_rate: u64,

    /// Maximum total IPT supply (0 = unlimited)
    pub max_total_supply: u64,

    /// Maximum withdrawal queue size
    pub max_queue_size: u32,
}

impl PoolConfig {
    pub const LEN: usize = 32 + // admin_authority
        32 + // oracle_authority
        32 + // fee_collector
        2 +  // deposit_fee_bps
        2 +  // withdrawal_fee_bps
        2 +  // management_fee_bps
        8 +  // initial_exchange_rate
        8 +  // max_total_supply
        4; // max_queue_size
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum PoolState {
    Active,
    Paused,
    Frozen,
    DepositOnly,
    WithdrawOnly,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LockState {
   pub is_locked: bool
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PendingWithdraw {
    pub user: Pubkey,
    pub amount: u64,
    pub min_usdc_amount: u64,
}