use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer},
};

declare_id!("9Hd5Nv7MYPeFbSntrdEg92uojcWGuGGH2Mkmyrm7eMGd");

pub const PRECISION: u128 = 1_000_000_000_000;
pub const GAME_DECIMALS: u8 = 2;
pub const XNT_DECIMALS: u8 = 9;
pub const DEFAULT_HALVING_INTERVAL: u64 = 100_000_000 * 10_u64.pow(GAME_DECIMALS as u32);
pub const DEFAULT_STAKING_SHARE_BPS: u16 = 3000;
pub const MAX_ACTIVE_BOOSTS: usize = 8;

const GLOBAL_CONFIG_SEED: &[u8] = b"global-config";
const STAKING_POOL_SEED: &[u8] = b"staking-pool";
const USER_STAKE_SEED: &[u8] = b"user-stake";
const USER_ACCOUNT_SEED: &[u8] = b"user-account";
const BOOST_CONFIG_SEED: &[u8] = b"boost-config";

const MINING_POINTS: [u32; 4] = [1, 3, 7, 12];

#[program]
pub mod x1_mining_arena {
    use super::*;

    pub fn initialize_global(ctx: Context<InitializeGlobal>, args: InitializeArgs) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.payer.key(),
            args.admin,
            ArenaError::Unauthorized
        );
        let halving_interval = if args.halving_interval == 0 {
            DEFAULT_HALVING_INTERVAL
        } else {
            args.halving_interval
        };
        let staking_share_bps = if args.staking_share_bps == 0 {
            DEFAULT_STAKING_SHARE_BPS
        } else {
            args.staking_share_bps
        };
        require!(staking_share_bps <= 10_000, ArenaError::InvalidBps);

        let global = &mut ctx.accounts.global_config;
        global.admin = args.admin;
        global.game_mint = ctx.accounts.game_mint.key();
        global.xnt_mint = ctx.accounts.xnt_mint.key();
        global.treasury_xnt_vault = Pubkey::default();
        global.halving_interval = halving_interval;
        global.halving_level = 0;
        global.total_minted = 0;
        global.staking_share_bps = staking_share_bps;

        Ok(())
    }

    pub fn initialize_treasury_vault(
        ctx: Context<InitializeTreasuryVault>,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.global_config.admin,
            ArenaError::Unauthorized
        );
        let global = &mut ctx.accounts.global_config;
        global.treasury_xnt_vault = ctx.accounts.treasury_xnt_vault.key();
        Ok(())
    }

    pub fn initialize_staking_pool(ctx: Context<InitializeStakingPool>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.global_config.admin,
            ArenaError::Unauthorized
        );
        require!(
            ctx.accounts.global_config.treasury_xnt_vault != Pubkey::default(),
            ArenaError::IncompleteConfig
        );

        let staking_pool = &mut ctx.accounts.staking_pool;
        staking_pool.token_mint = ctx.accounts.game_mint.key();
        staking_pool.xnt_mint = ctx.accounts.xnt_mint.key();
        staking_pool.staking_vault = ctx.accounts.staking_vault.key();
        staking_pool.treasury_xnt_vault = ctx.accounts.global_config.treasury_xnt_vault;
        staking_pool.total_effective_stake = 0;
        staking_pool.acc_reward_per_share = 0;

        Ok(())
    }

    pub fn update_halving(ctx: Context<UpdateHalving>) -> Result<()> {
        let global = &mut ctx.accounts.global_config;
        require_keys_eq!(
            ctx.accounts.admin.key(),
            global.admin,
            ArenaError::Unauthorized
        );
        global.halving_level = (global.total_minted / global.halving_interval) as u8;
        Ok(())
    }

    pub fn mine_with_rig(ctx: Context<MineWithRig>, rig_id: u8) -> Result<()> {
        let clock = Clock::get()?;
        let user_account = &mut ctx.accounts.user_account;
        user_account.purge_expired(clock.unix_timestamp);
        if user_account.owner == Pubkey::default() {
            user_account.owner = ctx.accounts.payer.key();
        }
        require_keys_eq!(
            user_account.owner,
            ctx.accounts.payer.key(),
            ArenaError::Unauthorized
        );

        let rig = RigConfig::get(rig_id).ok_or(ArenaError::InvalidRig)?;
        let global = &ctx.accounts.global_config;
        let halving_level = global.halving_level;
        let staking_share_bps = global.staking_share_bps;
        let staking_pool = &mut ctx.accounts.staking_pool;

        let mut deposit_xnt = rig.base_cost_xnt;
        let mut used_free_rig = false;

        // Apply free rig ticket boost if present.
        if let Some(idx) = user_account.active_boosts.iter().position(|b| {
            b.kind == BoostKind::FreeRigTicket
                && !b.is_expired(clock.unix_timestamp)
                && b.applies_to_rig(rig_id)
        }) {
            deposit_xnt = 0;
            used_free_rig = true;
            user_account.active_boosts.remove(idx);
        }

        if deposit_xnt > 0 {
            // Transfer XNT to treasury vault.
            let cpi_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_xnt_account.to_account_info(),
                    to: ctx.accounts.treasury_xnt_vault.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            );
            token::transfer(cpi_ctx, deposit_xnt)?;

            let to_stakers = (deposit_xnt as u128)
                .checked_mul(staking_share_bps as u128)
                .ok_or(ArenaError::MathOverflow)?
                / 10_000u128;

            if to_stakers > 0 && staking_pool.total_effective_stake > 0 {
                staking_pool.acc_reward_per_share = staking_pool
                    .acc_reward_per_share
                    .checked_add(
                        (to_stakers)
                            .checked_mul(PRECISION)
                            .ok_or(ArenaError::MathOverflow)?
                            .checked_div(staking_pool.total_effective_stake)
                            .ok_or(ArenaError::MathOverflow)?,
                    )
                    .ok_or(ArenaError::MathOverflow)?;
            }

            user_account.mining_xnt_spent =
                user_account.mining_xnt_spent.saturating_add(deposit_xnt);
        }

        let reward =
            compute_reward_amount(&rig, halving_level, &ctx.accounts.payer, &clock, rig_id)?;
        let boosted_reward = apply_mining_reward_boost(user_account, reward, clock.unix_timestamp);
        let reward_u64 = boosted_reward.min(u64::MAX as u128) as u64;

        let signer_seeds: &[&[u8]] = &[GLOBAL_CONFIG_SEED, &[ctx.bumps.global_config]];
        let signer_seeds_arr: &[&[&[u8]]] = &[signer_seeds];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.game_mint.to_account_info(),
                to: ctx.accounts.user_game_account.to_account_info(),
                authority: ctx.accounts.global_config.to_account_info(),
            },
            signer_seeds_arr,
        );
        token::mint_to(cpi_ctx, reward_u64)?;

        {
            let global_mut = &mut ctx.accounts.global_config;
            global_mut.total_minted = global_mut.total_minted.saturating_add(reward_u64);
            global_mut.halving_level =
                (global_mut.total_minted / global_mut.halving_interval) as u8;
        }

        // Update points.
        let mut points = MINING_POINTS[rig_id as usize] as u128;
        points = apply_mining_point_boost(user_account, points, clock.unix_timestamp);
        let points_u64 = points.min(u64::MAX as u128) as u64;

        user_account.daily_points = user_account.daily_points.saturating_add(points_u64 as u32);
        user_account.lifetime_points = user_account.lifetime_points.saturating_add(points_u64);
        user_account.mining_tokens_mined =
            user_account.mining_tokens_mined.saturating_add(reward_u64);
        user_account.mining_runs_by_rig[rig_id as usize] =
            user_account.mining_runs_by_rig[rig_id as usize].saturating_add(1);
        if reward_u64 == boosted_reward.min(u64::MAX as u128) as u64
            && boosted_reward >= (rig.reward_high(halving_level) as u128)
        {
            user_account.mining_crit_count = user_account.mining_crit_count.saturating_add(1);
        }

        emit!(MiningEvent {
            user: ctx.accounts.payer.key(),
            rig_id,
            deposit_xnt,
            reward_game: reward_u64,
            used_free_rig,
        });

        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64, lock_days: u16) -> Result<()> {
        let clock = Clock::get()?;
        let user_account = &mut ctx.accounts.user_account;
        user_account.purge_expired(clock.unix_timestamp);
        if user_account.owner == Pubkey::default() {
            user_account.owner = ctx.accounts.owner.key();
        }
        require_keys_eq!(
            user_account.owner,
            ctx.accounts.owner.key(),
            ArenaError::Unauthorized
        );

        let position_id = user_account.next_position_id.max(1);
        user_account.next_position_id = position_id;

        let lock_multiplier_bps = lock_multiplier(lock_days)?;
        let boost_multiplier_bps = resolve_staking_multiplier(user_account, clock.unix_timestamp);

        let stake_position = &mut ctx.accounts.user_stake_position;
        if stake_position.owner == Pubkey::default() {
            stake_position.owner = ctx.accounts.owner.key();
        }
        stake_position.position_id = position_id;
        require_keys_eq!(
            stake_position.owner,
            ctx.accounts.owner.key(),
            ArenaError::Unauthorized
        );

        // Transfer GAME into staking vault.
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_game_account.to_account_info(),
                to: ctx.accounts.staking_vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        let effective = calculate_effective(amount, lock_multiplier_bps, boost_multiplier_bps)?;

        stake_position.amount_staked = amount;
        stake_position.lock_multiplier_bps = lock_multiplier_bps;
        stake_position.boost_multiplier_bps = boost_multiplier_bps;
        stake_position.effective_stake = effective;
        stake_position.lock_until_ts = clock.unix_timestamp + (lock_days as i64) * 86_400;
        stake_position.reward_debt = stake_position
            .effective_stake
            .checked_mul(ctx.accounts.staking_pool.acc_reward_per_share)
            .ok_or(ArenaError::MathOverflow)?
            / PRECISION;

        ctx.accounts.staking_pool.total_effective_stake = ctx
            .accounts
            .staking_pool
            .total_effective_stake
            .saturating_add(effective);

        user_account.next_position_id = position_id.saturating_add(1);

        emit!(StakeEvent {
            owner: ctx.accounts.owner.key(),
            position_id,
            amount,
            lock_days,
            effective,
        });

        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let position_id = assert_valid_user_stake_pda(
            ctx.program_id,
            &ctx.accounts.owner.key(),
            Some(ctx.accounts.user_stake_position.position_id),
            &ctx.accounts.user_stake_position.key(),
        )?;
        require_keys_eq!(
            ctx.accounts.user_stake_position.owner,
            ctx.accounts.owner.key(),
            ArenaError::Unauthorized
        );
        let claimed = settle_rewards(
            &mut ctx.accounts.staking_pool,
            &mut ctx.accounts.user_stake_position,
            &ctx.accounts.global_config,
            &ctx.accounts.treasury_xnt_vault,
            &ctx.accounts.user_xnt_account,
            &ctx.accounts.token_program,
            ctx.bumps.global_config,
        )?;

        emit!(ClaimEvent {
            owner: ctx.accounts.owner.key(),
            position_id,
            rewards_claimed: claimed,
        });
        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let clock = Clock::get()?;
        let position_id = assert_valid_user_stake_pda(
            ctx.program_id,
            &ctx.accounts.owner.key(),
            Some(ctx.accounts.user_stake_position.position_id),
            &ctx.accounts.user_stake_position.key(),
        )?;
        require_keys_eq!(
            ctx.accounts.user_stake_position.owner,
            ctx.accounts.owner.key(),
            ArenaError::Unauthorized
        );
        require!(
            ctx.accounts.user_stake_position.lock_until_ts <= clock.unix_timestamp,
            ArenaError::StakeLocked
        );

        settle_rewards(
            &mut ctx.accounts.staking_pool,
            &mut ctx.accounts.user_stake_position,
            &ctx.accounts.global_config,
            &ctx.accounts.treasury_xnt_vault,
            &ctx.accounts.user_xnt_account,
            &ctx.accounts.token_program,
            ctx.bumps.global_config,
        )?;

        let amount = ctx.accounts.user_stake_position.amount_staked;
        let stake_seeds: &[&[u8]] = &[STAKING_POOL_SEED, &[ctx.bumps.staking_pool]];
        let stake_signer: &[&[&[u8]]] = &[stake_seeds];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.staking_vault.to_account_info(),
                to: ctx.accounts.user_game_account.to_account_info(),
                authority: ctx.accounts.staking_pool.to_account_info(),
            },
            stake_signer,
        );
        token::transfer(cpi_ctx, amount)?;

        let prev_effective = ctx.accounts.user_stake_position.effective_stake;
        ctx.accounts.staking_pool.total_effective_stake = ctx
            .accounts
            .staking_pool
            .total_effective_stake
            .saturating_sub(prev_effective);

        ctx.accounts.user_stake_position.amount_staked = 0;
        ctx.accounts.user_stake_position.effective_stake = 0;
        ctx.accounts.user_stake_position.reward_debt = 0;

        emit!(UnstakeEvent {
            owner: ctx.accounts.owner.key(),
            position_id,
            amount,
        });
        Ok(())
    }

    pub fn apply_ranking_results(
        ctx: Context<ApplyRankingResults>,
        boost_points_to_add: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.global_config.admin,
            ArenaError::Unauthorized
        );
        let user_account = &mut ctx.accounts.user_account;
        if user_account.owner == Pubkey::default() {
            user_account.owner = ctx.accounts.user.key();
        }
        require_keys_eq!(
            user_account.owner,
            ctx.accounts.user.key(),
            ArenaError::Unauthorized
        );
        user_account.boost_points = user_account
            .boost_points
            .saturating_add(boost_points_to_add);
        emit!(RankingAppliedEvent {
            user: ctx.accounts.user.key(),
            added_boost_points: boost_points_to_add,
        });
        Ok(())
    }

    pub fn reset_daily_points(ctx: Context<ResetDailyPoints>, day_id: i64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.global_config.admin,
            ArenaError::Unauthorized
        );
        let user_account = &mut ctx.accounts.user_account;
        if user_account.owner == Pubkey::default() {
            user_account.owner = ctx.accounts.user.key();
        }
        require_keys_eq!(
            user_account.owner,
            ctx.accounts.user.key(),
            ArenaError::Unauthorized
        );
        user_account.daily_points = 0;
        user_account.last_day_id = day_id;
        Ok(())
    }

    pub fn upsert_boost_config(
        ctx: Context<UpsertBoostConfig>,
        args: BoostConfigArgs,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.global_config.admin,
            ArenaError::Unauthorized
        );
        let boost_config = &mut ctx.accounts.boost_config;
        boost_config.id = args.id;
        boost_config.kind = args.kind;
        boost_config.cost_boost_points = args.cost_boost_points;
        boost_config.value_bps = args.value_bps;
        boost_config.duration_seconds = args.duration_seconds;
        boost_config.rig_id = args.rig_id;
        Ok(())
    }

    pub fn activate_boost(ctx: Context<ActivateBoost>) -> Result<()> {
        let clock = Clock::get()?;
        let user_account = &mut ctx.accounts.user_account;
        user_account.purge_expired(clock.unix_timestamp);
        if user_account.owner == Pubkey::default() {
            user_account.owner = ctx.accounts.user.key();
        }
        require_keys_eq!(
            user_account.owner,
            ctx.accounts.user.key(),
            ArenaError::Unauthorized
        );

        require!(
            user_account.active_boosts.len() < MAX_ACTIVE_BOOSTS,
            ArenaError::TooManyActiveBoosts
        );
        require!(
            user_account.boost_points >= ctx.accounts.boost_config.cost_boost_points,
            ArenaError::InsufficientBoostPoints
        );

        user_account.boost_points = user_account
            .boost_points
            .saturating_sub(ctx.accounts.boost_config.cost_boost_points);

        let expires_at = if ctx.accounts.boost_config.duration_seconds > 0 {
            clock
                .unix_timestamp
                .saturating_add(ctx.accounts.boost_config.duration_seconds)
        } else {
            0
        };

        user_account.active_boosts.push(UserBoost {
            boost_id: ctx.accounts.boost_config.id,
            kind: ctx.accounts.boost_config.kind.clone(),
            value_bps: ctx.accounts.boost_config.value_bps,
            expires_at_ts: expires_at,
            rig_id: ctx.accounts.boost_config.rig_id,
            applied_to_mining: matches!(
                ctx.accounts.boost_config.kind,
                BoostKind::MiningRewardBps | BoostKind::MiningPointsBps | BoostKind::FreeRigTicket
            ),
            applied_to_staking: matches!(
                ctx.accounts.boost_config.kind,
                BoostKind::StakingMultiplierBps
            ),
        });

        emit!(BoostActivatedEvent {
            user: ctx.accounts.user.key(),
            boost_id: ctx.accounts.boost_config.id,
            expires_at,
        });
        Ok(())
    }
}

// -------------------------------------
// Accounts
// -------------------------------------

#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub game_mint: Pubkey,
    pub xnt_mint: Pubkey,
    pub treasury_xnt_vault: Pubkey,
    pub halving_interval: u64,
    pub halving_level: u8,
    pub total_minted: u64,
    pub staking_share_bps: u16,
}

impl GlobalConfig {
    pub const LEN: usize = 32 * 4 + 8 + 1 + 8 + 2 + 8;
}

#[account]
pub struct StakingPool {
    pub token_mint: Pubkey,
    pub xnt_mint: Pubkey,
    pub staking_vault: Pubkey,
    pub treasury_xnt_vault: Pubkey,
    pub total_effective_stake: u128,
    pub acc_reward_per_share: u128,
}

impl StakingPool {
    pub const LEN: usize = 32 * 4 + 16 + 16 + 8;
}

#[account]
pub struct UserStakePosition {
    pub owner: Pubkey,
    pub amount_staked: u64,
    pub lock_multiplier_bps: u16,
    pub boost_multiplier_bps: u16,
    pub effective_stake: u128,
    pub reward_debt: u128,
    pub lock_until_ts: i64,
    pub position_id: u32,
}

impl UserStakePosition {
    // Keep the total allocated size the same as before (8 bytes padding
    // retained) so legacy accounts remain compatible.
    pub const LEN: usize = 32 + 8 + 2 + 2 + 16 + 16 + 8 + 4 + 4;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum BoostKind {
    MiningRewardBps,
    MiningPointsBps,
    FreeRigTicket,
    StakingMultiplierBps,
}

impl Default for BoostKind {
    fn default() -> Self {
        BoostKind::MiningRewardBps
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct UserBoost {
    pub boost_id: u8,
    pub kind: BoostKind,
    pub value_bps: u16,
    pub expires_at_ts: i64,
    pub rig_id: Option<u8>,
    pub applied_to_mining: bool,
    pub applied_to_staking: bool,
}

impl UserBoost {
    pub const LEN: usize = 1 + 1 + 2 + 8 + 2 + 1 + 1;

    pub fn is_expired(&self, now: i64) -> bool {
        self.expires_at_ts > 0 && self.expires_at_ts < now
    }

    pub fn applies_to_rig(&self, rig_id: u8) -> bool {
        match self.rig_id {
            Some(id) => id == rig_id,
            None => true,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct Achievements {
    pub first_mine: bool,
    pub first_stake: bool,
    pub seven_day_streak: bool,
    pub heavy_operator: bool,
}

#[account]
pub struct UserAccount {
    pub owner: Pubkey,
    pub daily_points: u32,
    pub lifetime_points: u64,
    pub boost_points: u64,
    pub mining_xnt_spent: u64,
    pub mining_tokens_mined: u64,
    pub mining_runs_by_rig: [u64; 4],
    pub mining_crit_count: u64,
    pub staking_xnt_earned: u64,
    pub last_day_id: i64,
    pub achievements: Achievements,
    pub next_position_id: u32,
    pub active_boosts: Vec<UserBoost>,
}

impl UserAccount {
    pub const LEN: usize = 32  // owner
        + 4                   // daily_points
        + 8                   // lifetime_points
        + 8                   // boost_points
        + 8                   // mining_xnt_spent
        + 8                   // mining_tokens_mined
        + 32                  // mining_runs_by_rig
        + 8                   // mining_crit_count
        + 8                   // staking_xnt_earned
        + 8                   // last_day_id
        + 4                   // achievements
        + 4                   // next_position_id
        + 4 + MAX_ACTIVE_BOOSTS * UserBoost::LEN
        + 12; // padding (keeps total size stable after adding next_position_id)

    pub fn purge_expired(&mut self, now: i64) {
        self.active_boosts.retain(|b| !b.is_expired(now));
    }
}

#[account]
pub struct BoostConfig {
    pub id: u8,
    pub kind: BoostKind,
    pub cost_boost_points: u64,
    pub value_bps: u16,
    pub duration_seconds: i64,
    pub rig_id: Option<u8>,
}

impl BoostConfig {
    pub const LEN: usize = 1 + 1 + 8 + 2 + 8 + 2 + 8;
}

// -------------------------------------
// Account Contexts
// -------------------------------------

#[derive(Accounts)]
#[instruction(args: InitializeArgs)]
pub struct InitializeGlobal<'info> {
    #[account(
        init,
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        payer = payer,
        space = 8 + GlobalConfig::LEN
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// XNT mint must already exist.
    pub xnt_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        mint::decimals = GAME_DECIMALS,
        mint::authority = global_config,
        mint::freeze_authority = global_config
    )]
    pub game_mint: Box<Account<'info, Mint>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitializeTreasuryVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_CONFIG_SEED], bump, has_one = xnt_mint)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, address = global_config.xnt_mint)]
    pub xnt_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = admin,
        token::mint = xnt_mint,
        token::authority = global_config
    )]
    pub treasury_xnt_vault: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitializeStakingPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = game_mint,
        has_one = xnt_mint
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        init,
        seeds = [STAKING_POOL_SEED],
        bump,
        payer = admin,
        space = 8 + StakingPool::LEN
    )]
    pub staking_pool: Box<Account<'info, StakingPool>>,

    #[account(mut, address = global_config.game_mint)]
    pub game_mint: Box<Account<'info, Mint>>,
    #[account(address = global_config.xnt_mint)]
    pub xnt_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        token::mint = game_mint,
        token::authority = staking_pool
    )]
    pub staking_vault: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct UpdateHalving<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
}

#[derive(Accounts)]
pub struct MineWithRig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump,
        constraint = staking_pool.treasury_xnt_vault == global_config.treasury_xnt_vault,
        constraint = staking_pool.token_mint == global_config.game_mint
    )]
    pub staking_pool: Box<Account<'info, StakingPool>>,
    #[account(mut, address = global_config.game_mint)]
    pub game_mint: Box<Account<'info, Mint>>,
    #[account(mut, constraint = user_game_account.mint == game_mint.key(), constraint = user_game_account.owner == payer.key())]
    pub user_game_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_xnt_account.mint == global_config.xnt_mint, constraint = user_xnt_account.owner == payer.key())]
    pub user_xnt_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = global_config.treasury_xnt_vault)]
    pub treasury_xnt_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        seeds = [USER_ACCOUNT_SEED, payer.key().as_ref()],
        bump,
        payer = payer,
        space = 8 + UserAccount::LEN
    )]
    pub user_account: Box<Account<'info, UserAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump,
        constraint = staking_pool.token_mint == global_config.game_mint,
        constraint = staking_pool.treasury_xnt_vault == global_config.treasury_xnt_vault
    )]
    pub staking_pool: Box<Account<'info, StakingPool>>,
    #[account(mut, address = staking_pool.staking_vault)]
    pub staking_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = staking_pool.treasury_xnt_vault)]
    pub treasury_xnt_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_game_account.mint == global_config.game_mint, constraint = user_game_account.owner == owner.key())]
    pub user_game_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_xnt_account.mint == global_config.xnt_mint, constraint = user_xnt_account.owner == owner.key())]
    pub user_xnt_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        seeds = [USER_ACCOUNT_SEED, owner.key().as_ref()],
        bump,
        payer = owner,
        space = 8 + UserAccount::LEN
    )]
    pub user_account: Box<Account<'info, UserAccount>>,
    #[account(
        init,
        seeds = [
            USER_STAKE_SEED,
            owner.key().as_ref(),
            &user_account.next_position_id.max(1).to_le_bytes()
        ],
        bump,
        payer = owner,
        space = 8 + UserStakePosition::LEN
    )]
    pub user_stake_position: Box<Account<'info, UserStakePosition>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump,
        constraint = staking_pool.treasury_xnt_vault == global_config.treasury_xnt_vault
    )]
    pub staking_pool: Box<Account<'info, StakingPool>>,
    #[account(mut, address = staking_pool.treasury_xnt_vault)]
    pub treasury_xnt_vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_xnt_account.mint == global_config.xnt_mint, constraint = user_xnt_account.owner == owner.key())]
    pub user_xnt_account: Account<'info, TokenAccount>,
    #[account(mut, owner = crate::ID)]
    pub user_stake_position: Account<'info, UserStakePosition>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump,
        constraint = staking_pool.token_mint == global_config.game_mint,
        constraint = staking_pool.treasury_xnt_vault == global_config.treasury_xnt_vault
    )]
    pub staking_pool: Box<Account<'info, StakingPool>>,
    #[account(mut, address = staking_pool.staking_vault)]
    pub staking_vault: Account<'info, TokenAccount>,
    #[account(mut, address = staking_pool.treasury_xnt_vault)]
    pub treasury_xnt_vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_game_account.mint == global_config.game_mint, constraint = user_game_account.owner == owner.key())]
    pub user_game_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_xnt_account.mint == global_config.xnt_mint, constraint = user_xnt_account.owner == owner.key())]
    pub user_xnt_account: Account<'info, TokenAccount>,
    #[account(mut, owner = crate::ID, close = owner)]
    pub user_stake_position: Account<'info, UserStakePosition>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ApplyRankingResults<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    /// CHECK: user to reward
    pub user: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        seeds = [USER_ACCOUNT_SEED, user.key().as_ref()],
        bump,
        payer = admin,
        space = 8 + UserAccount::LEN
    )]
    pub user_account: Account<'info, UserAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResetDailyPoints<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    /// CHECK: user to reset
    pub user: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        seeds = [USER_ACCOUNT_SEED, user.key().as_ref()],
        bump,
        payer = admin,
        space = 8 + UserAccount::LEN
    )]
    pub user_account: Account<'info, UserAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: BoostConfigArgs)]
pub struct UpsertBoostConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    #[account(
        init_if_needed,
        seeds = [BOOST_CONFIG_SEED, &[args.id]],
        bump,
        payer = admin,
        space = 8 + BoostConfig::LEN
    )]
    pub boost_config: Account<'info, BoostConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateBoost<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump)]
    pub global_config: Box<Account<'info, GlobalConfig>>,
    pub boost_config: Account<'info, BoostConfig>,
    #[account(
        init_if_needed,
        seeds = [USER_ACCOUNT_SEED, user.key().as_ref()],
        bump,
        payer = user,
        space = 8 + UserAccount::LEN
    )]
    pub user_account: Account<'info, UserAccount>,
    pub system_program: Program<'info, System>,
}

// -------------------------------------
// Types and helpers
// -------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeArgs {
    pub admin: Pubkey,
    pub staking_share_bps: u16,
    pub halving_interval: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct BoostConfigArgs {
    pub id: u8,
    pub kind: BoostKind,
    pub cost_boost_points: u64,
    pub value_bps: u16,
    pub duration_seconds: i64,
    pub rig_id: Option<u8>,
}

#[derive(Clone, Debug)]
pub struct RigConfig {
    pub rig_id: u8,
    pub base_cost_xnt: u64,
    pub base_reward_low: u64,
    pub base_reward_high: u64,
    pub prob_high_bps: u16,
}

impl RigConfig {
    pub fn get(rig_id: u8) -> Option<Self> {
        const FACTOR_XNT: u64 = 10u64.pow(XNT_DECIMALS as u32);
        const FACTOR_GAME: u64 = 10u64.pow(GAME_DECIMALS as u32);
        match rig_id {
            0 => Some(Self {
                rig_id,
                base_cost_xnt: (FACTOR_XNT / 20),            // 0.05
                base_reward_low: (FACTOR_GAME * 50) / 100,   // 0.5
                base_reward_high: (FACTOR_GAME * 100) / 100, // 1.0
                prob_high_bps: 5_000,
            }),
            1 => Some(Self {
                rig_id,
                base_cost_xnt: FACTOR_XNT / 4,     // 0.25
                base_reward_low: FACTOR_GAME * 3,  // 3
                base_reward_high: FACTOR_GAME * 4, // 4
                prob_high_bps: 5_000,
            }),
            2 => Some(Self {
                rig_id,
                base_cost_xnt: FACTOR_XNT,          // 1.0
                base_reward_low: FACTOR_GAME * 14,  // 14
                base_reward_high: FACTOR_GAME * 16, // 16
                prob_high_bps: 5_000,
            }),
            3 => Some(Self {
                rig_id,
                base_cost_xnt: FACTOR_XNT * 3,      // 3.0
                base_reward_low: FACTOR_GAME * 42,  // 42
                base_reward_high: FACTOR_GAME * 48, // 48
                prob_high_bps: 5_000,
            }),
            _ => None,
        }
    }

    pub fn reward_low(&self, halving_level: u8) -> u64 {
        self.base_reward_low
            .checked_shr(halving_level as u32)
            .unwrap_or(0)
    }

    pub fn reward_high(&self, halving_level: u8) -> u64 {
        self.base_reward_high
            .checked_shr(halving_level as u32)
            .unwrap_or(0)
    }
}

fn compute_reward_amount(
    rig: &RigConfig,
    halving_level: u8,
    user: &Signer,
    clock: &Clock,
    rig_id: u8,
) -> Result<u64> {
    let entropy = keccak::hashv(&[
        &clock.slot.to_le_bytes(),
        &clock.unix_timestamp.to_le_bytes(),
        user.key.as_ref(),
        &[rig_id],
    ]);
    let roll = u16::from_le_bytes([entropy.0[0], entropy.0[1]]) % 10_000;
    let reward = if roll < rig.prob_high_bps {
        rig.reward_high(halving_level)
    } else {
        rig.reward_low(halving_level)
    };
    Ok(reward)
}

fn apply_mining_reward_boost(user: &mut UserAccount, base: u64, now: i64) -> u128 {
    let mut result = base as u128;
    for boost in user.active_boosts.iter() {
        if boost.applied_to_mining
            && !boost.is_expired(now)
            && matches!(boost.kind, BoostKind::MiningRewardBps)
        {
            result = result.saturating_mul(boost.value_bps as u128) / 10_000u128;
        }
    }
    result
}

fn apply_mining_point_boost(user: &mut UserAccount, base: u128, now: i64) -> u128 {
    let mut result = base;
    for boost in user.active_boosts.iter() {
        if boost.applied_to_mining
            && !boost.is_expired(now)
            && matches!(boost.kind, BoostKind::MiningPointsBps)
        {
            result = result.saturating_mul(boost.value_bps as u128) / 10_000u128;
        }
    }
    result
}

fn resolve_staking_multiplier(user: &UserAccount, now: i64) -> u16 {
    let mut mult = 10_000u16;
    for boost in user.active_boosts.iter() {
        if boost.applied_to_staking
            && !boost.is_expired(now)
            && matches!(boost.kind, BoostKind::StakingMultiplierBps)
        {
            mult = mult.max(boost.value_bps);
        }
    }
    mult
}

fn calculate_effective(amount: u64, lock_mult: u16, boost_mult: u16) -> Result<u128> {
    let amount_u128 = amount as u128;
    let result = amount_u128
        .checked_mul(lock_mult as u128)
        .ok_or(ArenaError::MathOverflow)?
        .checked_mul(boost_mult as u128)
        .ok_or(ArenaError::MathOverflow)?
        / 10_000u128
        / 10_000u128;
    Ok(result)
}

fn lock_multiplier(lock_days: u16) -> Result<u16> {
    match lock_days {
        7 => Ok(10_500),
        14 => Ok(11_000),
        30 => Ok(12_000),
        _ => Err(error!(ArenaError::InvalidLock)),
    }
}

fn settle_rewards<'info>(
    staking_pool: &mut StakingPool,
    user_stake: &mut UserStakePosition,
    global: &Account<'info, GlobalConfig>,
    treasury_xnt_vault: &Account<'info, TokenAccount>,
    user_xnt_account: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    global_bump: u8,
) -> Result<u64> {
    let pending = pending_rewards(staking_pool.acc_reward_per_share, user_stake)?;
    if pending > 0 {
        let signer_seeds: &[&[u8]] = &[GLOBAL_CONFIG_SEED, &[global_bump]];
        let signer_arr: &[&[&[u8]]] = &[signer_seeds];
        let cpi_ctx = CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: treasury_xnt_vault.to_account_info(),
                to: user_xnt_account.to_account_info(),
                authority: global.to_account_info(),
            },
            signer_arr,
        );
        token::transfer(cpi_ctx, pending)?;
    }

    user_stake.reward_debt = user_stake
        .effective_stake
        .checked_mul(staking_pool.acc_reward_per_share)
        .ok_or(ArenaError::MathOverflow)?
        / PRECISION;

    Ok(pending)
}

fn pending_rewards(acc_reward_per_share: u128, user_stake: &UserStakePosition) -> Result<u64> {
    let accumulated = user_stake
        .effective_stake
        .checked_mul(acc_reward_per_share)
        .ok_or(ArenaError::MathOverflow)?
        / PRECISION;
    let pending = accumulated.saturating_sub(user_stake.reward_debt);
    Ok(pending.min(u64::MAX as u128) as u64)
}

fn assert_valid_user_stake_pda(
    program_id: &Pubkey,
    owner: &Pubkey,
    maybe_position_id: Option<u32>,
    stake_account_key: &Pubkey,
) -> Result<u32> {
    if maybe_position_id == Some(0) || maybe_position_id.is_none() {
        let (legacy_pda, _) =
            Pubkey::find_program_address(&[USER_STAKE_SEED, owner.as_ref()], program_id);
        require_keys_eq!(*stake_account_key, legacy_pda, ArenaError::InvalidStakePda);
        return Ok(0);
    }

    let position_id = maybe_position_id.unwrap();
    let (pda, _) = Pubkey::find_program_address(
        &[
            USER_STAKE_SEED,
            owner.as_ref(),
            &position_id.to_le_bytes(),
        ],
        program_id,
    );
    require_keys_eq!(*stake_account_key, pda, ArenaError::InvalidStakePda);
    Ok(position_id)
}

// -------------------------------------
// Events
// -------------------------------------

#[event]
pub struct MiningEvent {
    pub user: Pubkey,
    pub rig_id: u8,
    pub deposit_xnt: u64,
    pub reward_game: u64,
    pub used_free_rig: bool,
}

#[event]
pub struct StakeEvent {
    pub owner: Pubkey,
    pub position_id: u32,
    pub amount: u64,
    pub lock_days: u16,
    pub effective: u128,
}

#[event]
pub struct UnstakeEvent {
    pub owner: Pubkey,
    pub position_id: u32,
    pub amount: u64,
}

#[event]
pub struct ClaimEvent {
    pub owner: Pubkey,
    pub position_id: u32,
    pub rewards_claimed: u64,
}

#[event]
pub struct BoostActivatedEvent {
    pub user: Pubkey,
    pub boost_id: u8,
    pub expires_at: i64,
}

#[event]
pub struct RankingAppliedEvent {
    pub user: Pubkey,
    pub added_boost_points: u64,
}

// -------------------------------------
// Errors
// -------------------------------------

#[error_code]
pub enum ArenaError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid rig")]
    InvalidRig,
    #[msg("Invalid lock")]
    InvalidLock,
    #[msg("Stake still locked")]
    StakeLocked,
    #[msg("Invalid basis points value")]
    InvalidBps,
    #[msg("Too many active boosts")]
    TooManyActiveBoosts,
    #[msg("Insufficient boost points")]
    InsufficientBoostPoints,
    #[msg("Configuration incomplete")]
    IncompleteConfig,
    #[msg("Invalid stake PDA")]
    InvalidStakePda,
}
