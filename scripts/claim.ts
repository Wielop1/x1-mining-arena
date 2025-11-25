/**
 * Claims XNT rewards from staking.
 *
 * Env:
 *   ANCHOR_WALLET (owner signer)
 *   RPC_URL or ANCHOR_PROVIDER_URL
 *   POSITION_ID (0 = legacy, >0 = new position)
 */
import { PublicKey } from "@solana/web3.js";
import { ixClaim, PROGRAM_ID } from "../sdk/client";
import {
  findGlobalConfig,
  findStakingPool,
  findUserStake,
  findUserStakePosition,
} from "../sdk/pdas";
import {
  ensureAta,
  getConnection,
  loadKeypair,
  sendTx,
  decodeGlobalConfig,
} from "./helpers";

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const owner = loadKeypair(walletPath);
  const connection = getConnection();

  if (!process.env.POSITION_ID) {
    throw new Error("POSITION_ID env var required (0 = legacy)");
  }
  const positionId = Number(process.env.POSITION_ID);
  if (Number.isNaN(positionId) || positionId < 0) {
    throw new Error("Invalid POSITION_ID");
  }

  const XNT_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );

  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool] = findStakingPool(PROGRAM_ID);
  const [userStakePosition] =
    positionId === 0
      ? findUserStake(owner.publicKey, PROGRAM_ID)
      : findUserStakePosition(owner.publicKey, positionId, PROGRAM_ID);

  // Ensure owner ATA for XNT to receive rewards
  const userXntAta = await ensureAta({
    connection,
    payer: owner,
    mint: XNT_MINT,
    owner: owner.publicKey,
  });

  // Treasury XNT vault is stored in GlobalConfig; already known from init
  const globalInfo = await connection.getAccountInfo(globalConfig);
  if (!globalInfo) {
    throw new Error("GlobalConfig account not found on chain");
  }
  const decodedGlobal = decodeGlobalConfig(globalInfo.data);
  const treasuryVault = decodedGlobal.treasuryXntVault as PublicKey;

  const sig = await sendTx(
    connection,
    owner,
    [
      ixClaim({
        owner: owner.publicKey,
        treasuryXntVault: treasuryVault,
        userXntAccount: userXntAta,
        positionId,
      }),
    ],
    []
  );

  console.log("claim signature:", sig);
  console.log("user XNT ATA:", userXntAta.toBase58());
  console.log("treasury XNT vault:", treasuryVault.toBase58());
  console.log("staking pool PDA:", stakingPool.toBase58());
  console.log("userStakePosition PDA:", userStakePosition.toBase58());
  console.log("position_id:", positionId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
