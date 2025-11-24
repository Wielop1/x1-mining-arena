import { PublicKey } from "@solana/web3.js";
import { ixInitializeStakingPool, PROGRAM_ID } from "../sdk/client";
import { findGlobalConfig, findStakingPool } from "../sdk/pdas";
import { ensureAta, getConnection, loadKeypair, sendTx } from "./helpers";

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const admin = loadKeypair(walletPath);
  const connection = getConnection();

  const GAME_MINT = new PublicKey(
    "2iz7CgsTQifAg1z1wkC7MNj876hENnDP55PLpg1KsbVr"
  );
  const XNT_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );

  const [globalConfig, globalBump] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool, stakingBump] = findStakingPool(PROGRAM_ID);

  // Staking vault ATA owned by staking_pool PDA for GAME mint.
  const stakingVault = await ensureAta({
    connection,
    payer: admin,
    mint: GAME_MINT,
    owner: stakingPool,
  });

  const sig = await sendTx(
    connection,
    admin,
    [
      ixInitializeStakingPool({
        admin: admin.publicKey,
        gameMint: GAME_MINT,
        xntMint: XNT_MINT,
        stakingVault,
      }),
    ],
    []
  );

  console.log("initializeStakingPool signature:", sig);
  console.log("GlobalConfig PDA:", globalConfig.toBase58(), "bump", globalBump);
  console.log("StakingPool PDA:", stakingPool.toBase58(), "bump", stakingBump);
  console.log("Staking vault ATA (owner = staking_pool):", stakingVault.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
