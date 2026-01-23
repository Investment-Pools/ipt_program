// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Burn, Transfer};
use anchor_spl::token::spl_token::solana_program::program_option::COption;
use crate::utils::{CalculationUtils, ValidationUtils};
use crate::events::*;
use crate::states::*;
use crate::errors::PoolError;

#[derive(Accounts)]
#[instruction(batch_size: u8)]
pub struct BatchExecuteWithdraw<'info> {
    /// Backend/Keeper authority
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, Pool>,

    #[account(
        seeds = [Pool::SEED_PREFIX, pool.usdc_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut, address = pool.usdc_reserve)]
    pub pool_usdc_reserve: Account<'info, TokenAccount>,

    #[account(mut, address = pool.ipt_mint)]
    pub ipt_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,

    // remaining_accounts format:
    // [user_ipt_0, user_usdc_0, user_ipt_1, user_usdc_1, ...]
    // Each user needs 2 accounts: IPT account and USDC account
}

pub fn batch_execute_withdraw<'info>(
    ctx: Context<'_, '_, 'info, 'info, BatchExecuteWithdraw<'info>>,
    amounts: Vec<u64>,  // IPT amounts for each user (should match pending_queue amounts)
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let batch_size = amounts.len();

    // Validate pool state
    ValidationUtils::validate_pool_state_for_operation(&pool.pool_state, false)?;

    require!(
        batch_size <= 10,  // Max 10 users/tx to avoid compute limit
        PoolError::BatchSizeTooLarge
    );

    // ============================================================
    // CRITICAL: Validate batch_size doesn't exceed queue length
    // This prevents index out of bounds panic
    // ============================================================
    require!(
        batch_size <= pool.pending_queue.len(),
        PoolError::EmptyWithdrawalBatch
    );

    require!(
        ctx.remaining_accounts.len() == batch_size * 2,
        PoolError::InvalidAccountsCount
    );

    // ============================================================
    // CRITICAL: Sync state with actual balance BEFORE processing
    // This handles cases where external transfers occurred without updating state
    // ============================================================
    let actual_reserve_balance = ctx.accounts.pool_usdc_reserve.amount;
    if pool.total_usdc_reserves != actual_reserve_balance {
        let old_reserves = pool.total_usdc_reserves;
        pool.total_usdc_reserves = actual_reserve_balance;
        msg!(
            "SYNC: pool.total_usdc_reserves {} -> {} (actual balance)",
            old_reserves,
            actual_reserve_balance
        );
    }

    let mut total_ipt_burned = 0u64;
    let mut total_usdc_transferred = 0u64;
    let mut total_fees = 0u64;
    let mut successful_count = 0usize;
    let mut skipped_count = 0usize;

    // Process each withdrawal in FIFO order
    for i in 0..batch_size {
        // Get amount from queue directly (more reliable than external input)
        let pending = &pool.pending_queue[i];
        let ipt_amount = pending.amount;
        
        // Validate amounts[i] matches queue (optional safety check)
        if amounts[i] != ipt_amount {
            msg!(
                "WARNING: amounts[{}] ({}) != pending.amount ({}), using queue value",
                i,
                amounts[i],
                ipt_amount
            );
        }

        // Get user accounts (each user has 2 accounts)
        let user_ipt_account = &ctx.remaining_accounts[i * 2];
        let user_usdc_account = &ctx.remaining_accounts[i * 2 + 1];

        // Deserialize accounts
        let ipt_acc = Account::<TokenAccount>::try_from(user_ipt_account)?;
        let usdc_acc = Account::<TokenAccount>::try_from(user_usdc_account)?;

        // Validate this is the correct user (pending already retrieved above)
        require!(
            ipt_acc.owner == pending.user,
            PoolError::InvalidUserAccount
        );

        // Validate accounts
        require!(
            ipt_acc.mint == pool.ipt_mint,
            PoolError::InvalidMint
        );
        require!(
            usdc_acc.mint == pool.usdc_mint,
            PoolError::InvalidMint
        );

        // Check delegation
        require!(
            ipt_acc.delegate == COption::Some(ctx.accounts.pool_authority.key()),
            PoolError::NotDelegated
        );
        require!(
            ipt_acc.delegated_amount >= ipt_amount,
            PoolError::InsufficientDelegation
        );

        // Check if user still has enough IPT balance
        // IMPORTANT: If user has insufficient balance, SKIP and REMOVE from queue
        // This prevents malicious users from blocking the entire queue
        if ipt_acc.amount < ipt_amount {
            msg!(
                "User {} at index {} has insufficient IPT balance ({} < {}), removing from queue",
                pending.user,
                i,
                ipt_acc.amount,
                ipt_amount
            );

            // Skip this user but mark as processed to remove from queue
            // This prevents queue blocking attacks
            skipped_count += 1;

            // Emit event for tracking
            emit!(WithdrawSkipped {
                user: pending.user,
                ipt_amount,
                reason: "Insufficient IPT balance".to_string(),
                batch_index: i as u8,
            });

            continue; // Continue to next user instead of breaking
        }

        // Calculate USDC amounts
        let (net_usdc_amount, withdrawal_fee) =
            CalculationUtils::calculate_usdc_from_net_ipt_withdrawal(
                ipt_amount,
                pool.current_exchange_rate,
                pool.config.withdrawal_fee_bps,
            )?;

        // Check slippage protection from original request
        // If slippage exceeded, skip and remove from queue (user's responsibility to monitor rate)
        if net_usdc_amount < pending.min_usdc_amount {
            msg!(
                "Slippage protection failed for user {} at index {} ({} < {}), removing from queue",
                pending.user,
                i,
                net_usdc_amount,
                pending.min_usdc_amount
            );

            skipped_count += 1;

            emit!(WithdrawSkipped {
                user: pending.user,
                ipt_amount,
                reason: "Slippage protection exceeded".to_string(),
                batch_index: i as u8,
            });

            continue; // Skip this user
        }

        let gross_usdc_amount = net_usdc_amount
            .checked_add(withdrawal_fee)
            .ok_or(PoolError::MathematicalOverflow)?;

        // Check pool has enough reserves for this withdrawal (using synced state)
        // Calculate remaining reserves after previous withdrawals in this batch
        let used_so_far = total_usdc_transferred
            .checked_add(total_fees)
            .ok_or(PoolError::MathematicalOverflow)?;
        let available_reserves = pool.total_usdc_reserves
            .checked_sub(used_so_far)
            .unwrap_or(0);
            
        if available_reserves < gross_usdc_amount {
            msg!(
                "Insufficient reserves for user at index {} (available: {}, needed: {}), stopping batch (FIFO)",
                i,
                available_reserves,
                gross_usdc_amount
            );
            break;  // FIFO - stop at this user
        }

        // Burn IPT using delegated authority
        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.ipt_mint.to_account_info(),
                    from: user_ipt_account.clone(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                &[&pool.authority_seeds()],
            ),
            ipt_amount,
        )?;

        // Transfer USDC to user
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.pool_usdc_reserve.to_account_info(),
                    to: user_usdc_account.clone(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                &[&pool.authority_seeds()],
            ),
            net_usdc_amount,
        )?;

        // Accumulate totals
        total_ipt_burned = total_ipt_burned
            .checked_add(ipt_amount)
            .ok_or(PoolError::MathematicalOverflow)?;

        total_usdc_transferred = total_usdc_transferred
            .checked_add(net_usdc_amount)
            .ok_or(PoolError::MathematicalOverflow)?;

        total_fees = total_fees
            .checked_add(withdrawal_fee)
            .ok_or(PoolError::MathematicalOverflow)?;

        successful_count += 1;

        // Emit per-user event
        emit!(WithdrawExecuted {
            user: ipt_acc.owner,
            ipt_amount,
            usdc_amount: net_usdc_amount,
            withdrawal_fee,
            batch_index: i as u8,
        });
    }

    // Update pool state once at the end
    pool.total_ipt_supply = pool.total_ipt_supply
        .checked_sub(total_ipt_burned)
        .ok_or(PoolError::MathematicalUnderflow)?;

    pool.total_accumulated_fees = pool.total_accumulated_fees
        .checked_add(total_fees)
        .ok_or(PoolError::MathematicalOverflow)?;

    // Calculate new reserves (subtract gross amount which includes fees)
    let total_gross_usdc = total_usdc_transferred
        .checked_add(total_fees)
        .ok_or(PoolError::MathematicalOverflow)?;

    pool.total_usdc_reserves = pool.total_usdc_reserves
        .checked_sub(total_gross_usdc)
        .ok_or(PoolError::MathematicalUnderflow)?;

    // CRITICAL FIX: Remove both successful and skipped items from the queue
    // This prevents malicious users from blocking the queue
    let total_processed = successful_count + skipped_count;

    if total_processed > 0 {
        pool.pending_queue.drain(0..total_processed);

        msg!(
            "Removed {} items from queue ({} successful, {} skipped)",
            total_processed,
            successful_count,
            skipped_count
        );
    }

    // Emit batch summary event
    emit!(BatchWithdrawExecuted {
        executor: ctx.accounts.executor.key(),
        successful_count: successful_count as u8,
        skipped_count: skipped_count as u8,
        total_ipt_burned,
        total_usdc_transferred,
        total_fees,
        new_pool_reserves: pool.total_usdc_reserves,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "Batch processed: {} successful withdrawals, {} skipped, burned {} IPT, transferred {} USDC (fees: {})",
        successful_count,
        skipped_count,
        total_ipt_burned,
        total_usdc_transferred,
        total_fees
    );

    Ok(())
}