import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { X1MiningArena } from "../target/types/x1_mining_arena";

describe("x1-mining-arena", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.x1MiningArena as Program<X1MiningArena>;

  it.skip("initializes config (provide accounts before enabling)", async () => {
    /**
     * Skeleton only: fill in real accounts before running.
     * Example:
     *
     * await program.methods
     *   .initializeGlobal({
     *     admin: provider.wallet.publicKey,
     *     stakingShareBps: 3000,
     *     halvingInterval: 100_000_000n * 100n,
     *   })
     *   .accounts({
     *     payer: provider.wallet.publicKey,
     *     globalConfig,
     *     xntMint,
     *     gameMint,
     *   })
     *   .rpc();
     *
     * await program.methods
     *   .initializeTreasuryVault()
     *   .accounts({
     *     admin: provider.wallet.publicKey,
     *     globalConfig,
     *     xntMint,
     *     treasuryXntVault,
     *   })
     *   .rpc();
     *
     * await program.methods
     *   .initializeStakingPool()
     *   .accounts({
     *     admin: provider.wallet.publicKey,
     *     globalConfig,
     *     stakingPool,
     *     gameMint,
     *     xntMint,
     *     stakingVault,
     *   })
     *   .rpc();
     */
    console.log("TODO: wire test accounts for X1");
  });
});
