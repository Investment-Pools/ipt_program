// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;
use crate::states::*;
use crate::errors::PoolError;
use crate::events::*;

#[derive(Accounts)]
pub struct CancelWithdrawalRequest<'info> {
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
}

/// User cancels their own withdrawal request
pub fn handler(ctx: Context<CancelWithdrawalRequest>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let user = ctx.accounts.user.key();

    // Find user's withdrawal request in queue
    let position = pool.pending_queue
        .iter()
        .position(|w| w.user == user)
        .ok_or(PoolError::InvalidUserAccount)?;

    // Remove the withdrawal request
    let withdrawn_request = pool.pending_queue.remove(position);

    emit!(WithdrawalCancelled {
        user,
        ipt_amount: withdrawn_request.amount,
        position: position as u32,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "User {} cancelled withdrawal request for {} IPT at position {}",
        user,
        withdrawn_request.amount,
        position
    );

    Ok(())
}
