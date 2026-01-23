// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;

#[error_code]
pub enum PoolError {
    #[msg("Unauthorized: Only admin can perform this action")]
    UnauthorizedAdmin,

    #[msg("Unauthorized: Only oracle can update exchange rate")]
    UnauthorizedOracle,

    #[msg("Unauthorized: Only fee collector can withdraw fees")]
    UnauthorizedFeeCollector,

    #[msg("Unauthorized: Only authorized executor can process batch withdrawals")]
    UnauthorizedExecutor,

    #[msg("Pool is currently paused")]
    PoolPaused,

    #[msg("Pool is frozen")]
    PoolFrozen,

    #[msg("Deposits are disabled")]
    DepositsDisabled,

    #[msg("Withdrawals are disabled")]
    WithdrawalsDisabled,

    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    #[msg("Insufficient reserves for withdrawal")]
    InsufficientReserves,

    #[msg("Insufficient accumulated fees")]
    InsufficientAccumulatedFees,

    #[msg("Invalid exchange rate - must be greater than 0")]
    InvalidExchangeRate,

    #[msg("Invalid fee rate - must be less than 10000 basis points")]
    InvalidFeeRate,

    #[msg("Token account owner mismatch")]
    TokenAccountOwnerMismatch,

    #[msg("Mint mismatch")]
    MintMismatch,

    #[msg("Mathematical overflow")]
    MathematicalOverflow,

    #[msg("Mathematical underflow")]
    MathematicalUnderflow,

    #[msg("Division by zero")]
    DivisionByZero,

    #[msg("Invalid configuration parameter")]
    InvalidConfigParameter,

    #[msg("Insufficient account balance")]
    InsufficientAccountBalance,

    #[msg("Zero amount not allowed")]
    ZeroAmountNotAllowed,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Insufficient approval for token operation")]
    InsufficientApproval,

    #[msg("Invalid delegate authority")]
    InvalidDelegate,

    #[msg("Invalid USDC mint address")]
    InvalidUsdcMint,

    #[msg("Empty withdrawal batch not allowed")]
    EmptyWithdrawalBatch,

    #[msg("Batch size too large - maximum 10 withdrawals per transaction")]
    BatchSizeTooLarge,

    #[msg("Invalid user account")]
    InvalidUserAccount,

    #[msg("Invalid accounts count - must provide 2 accounts per user")]
    InvalidAccountsCount,

    #[msg("Invalid mint address")]
    InvalidMint,

    #[msg("Token not delegated to pool authority")]
    NotDelegated,

    #[msg("Insufficient delegation amount")]
    InsufficientDelegation,

    #[msg("Maximum total supply exceeded - deposit would exceed max_total_supply limit")]
    MaxTotalSupplyExceeded,

    #[msg("Withdrawal queue is full - maximum capacity reached")]
    QueueFull,

    #[msg("User already has a pending withdrawal request")]
    AlreadyInQueue,

    #[msg("Invalid authority pubkey - cannot be default pubkey")]
    InvalidAuthority,
}