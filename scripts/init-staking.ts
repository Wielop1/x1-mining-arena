import { PublicKey } from "@solana/web3.js";
import { ixInitializeStakingPool, PROGRAM_ID } from "../sdk/client";
import { findGlobalConfig, findStakingPool } from "../sdk/pdas";
import { Keypair } from "@solana/web3.js";
import { getConnection, loadKeypair, sendTx } from "./helpers";

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const admin = loadKeypair(walletPath);
  const connection = getConnection();

  const GAME_MINT = (() => {
    const kpPath =
      process.env.GAME_MINT_KEYPAIR || "/root/.config/solana/game-mint.json";
    return loadKeypair(kpPath).publicKey;
  })();
  const XNT_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );

  const [globalConfig, globalBump] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool, stakingBump] = findStakingPool(PROGRAM_ID);

  // Create a fresh token account for staking vault; program will init it.
  const stakingVaultKp = Keypair.generate();

  const sig = await sendTx(
    connection,
    admin,
    [
      ixInitializeStakingPool({
        admin: admin.publicKey,
        gameMint: GAME_MINT,
        xntMint: XNT_MINT,
        stakingVault: stakingVaultKp.publicKey,
      }),
    ],
    [stakingVaultKp]
  );

  console.log("initializeStakingPool signature:", sig);
  console.log("GlobalConfig PDA:", globalConfig.toBase58(), "bump", globalBump);
  console.log("StakingPool PDA:", stakingPool.toBase58(), "bump", stakingBump);
  console.log(
    "Staking vault token account:",
    stakingVaultKp.publicKey.toBase58(),
    "(keypair generated in script)"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
