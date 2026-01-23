// SPDX-License-Identifier: Apache-2.0

use crate::errors::PoolError;
use crate::states::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
pub struct InitializePoolStep2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: Pool authority (PDA)
    #[account(
        constraint = pool_authority.key() == pool.pool_authority @ PoolError::InvalidAuthority
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// USDC mint (to get decimals)
    pub usdc_mint: Account<'info, Mint>,

    /// IPT mint
    #[account(
        init,
        payer = payer,
        mint::decimals = usdc_mint.decimals,
        mint::authority = pool_authority,
        seeds = [
            b"ipt_mint",
            pool.key().as_ref()
        ],
        bump
    )]
    pub ipt_mint: Account<'info, Mint>,

    /// USDC reserve token account
    #[account(
        init,
        payer = payer,
        token::mint = usdc_mint,
        token::authority = pool_authority,
        seeds = [
            b"usdc_reserve",
            pool.key().as_ref()
        ],
        bump
    )]
    pub usdc_reserve: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializePoolStep2>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    // Derive PDA addresses and update pool
    let (ipt_mint, _) = Pubkey::find_program_address(
        &[b"ipt_mint", pool.key().as_ref()],
        ctx.program_id,
    );
    let (usdc_reserve, _) = Pubkey::find_program_address(
        &[b"usdc_reserve", pool.key().as_ref()],
        ctx.program_id,
    );

    pool.ipt_mint = ipt_mint;
    pool.usdc_reserve = usdc_reserve;

    msg!("Pool mints initialized (step 2) - IPT: {}, Reserve: {}", ipt_mint, usdc_reserve);

    Ok(())
}