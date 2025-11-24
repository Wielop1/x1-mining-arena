# X1 Mining Arena (Anchor)

Solana/SVM (X1 testnet) Anchor workspace implementing the on-chain pieces for the mining + staking arena described in the spec.

Key points:
- Cluster: `https://rpc.testnet.x1.xyz` (set in `Anchor.toml`).
- Tokens: GAME (2 decimals, minted by the program) and XNT (assumed 9 decimals, provided mint).
- Halving: default interval `100_000_000 * 10^2` (100M GAME in smallest units), `halving_level = total_minted / halving_interval`.
- Staking: `acc_reward_per_share` with `PRECISION = 1e12`, multipliers for locks (7/14/30 days) and boosts.
- Mining rigs: 4 configs (Mini/Mid/Heavy/Titan) with bitshift halving of rewards and pseudo-RNG via `keccak(slot, ts, user, rig_id)`.
- Boosts: data-driven `BoostConfig` accounts; user-activated boosts tracked in `UserAccount.active_boosts` (bounded list).

Useful commands (after installing dependencies):
- Build: `anchor build`
- Format Rust: `cargo fmt`
- (Optional) JS tests scaffolded in `tests/x1-mining-arena.ts` (currently skipped until accounts are wired).

Note on dependencies: `anchor init` attempted `yarn install` and failed because network access is restricted here. Run `yarn install` (or switch the package manager) once you have network access to pull `@coral-xyz/anchor` JS deps for tests.
