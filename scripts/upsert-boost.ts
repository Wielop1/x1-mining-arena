/**
 * Admin: creates/updates a boost config.
 * Env:
 *   ANCHOR_WALLET (admin signer)
 *   RPC_URL or ANCHOR_PROVIDER_URL
 *   BOOST_ID (default 1)
 *   BOOST_KIND (default 0 => MiningRewardBps; 1=MiningPointsBps; 2=FreeRigTicket; 3=StakingMultiplierBps)
 *   BOOST_COST (u64, default 0)
 *   BOOST_VALUE_BPS (u16, default 500)
 *   BOOST_DURATION (i64 seconds, default 86400)
 *   BOOST_RIG_ID (optional u8; only for FreeRigTicket/rig-targeted)
 */
import { getConnection, loadKeypair, sendTx } from "./helpers";
import { ixUpsertBoostConfig, PROGRAM_ID } from "../sdk/client";
import { findBoostConfig } from "../sdk/pdas";

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const admin = loadKeypair(walletPath);
  const connection = getConnection();

  const boostId = process.env.BOOST_ID ? Number(process.env.BOOST_ID) : 1;
  const boostKind = process.env.BOOST_KIND
    ? Number(process.env.BOOST_KIND)
    : 0; // MiningRewardBps
  const boostCost = process.env.BOOST_COST
    ? BigInt(process.env.BOOST_COST)
    : BigInt(0);
  const boostValueBps = process.env.BOOST_VALUE_BPS
    ? Number(process.env.BOOST_VALUE_BPS)
    : 500;
  const boostDuration = process.env.BOOST_DURATION
    ? BigInt(process.env.BOOST_DURATION)
    : BigInt(86400);
  const boostRigId = process.env.BOOST_RIG_ID
    ? Number(process.env.BOOST_RIG_ID)
    : undefined;

  const sig = await sendTx(
    connection,
    admin,
    [
      ixUpsertBoostConfig({
        admin: admin.publicKey,
        id: boostId,
        kind: boostKind,
        costBoostPoints: boostCost,
        valueBps: boostValueBps,
        durationSeconds: boostDuration,
        rigId: boostRigId,
      }),
    ],
    []
  );

  const [boostPda, _] = findBoostConfig(boostId, PROGRAM_ID);
  console.log("upsert boost signature:", sig);
  console.log("boost id:", boostId, "kind:", boostKind, "value_bps:", boostValueBps, "duration:", boostDuration.toString(), "cost:", boostCost.toString(), "rig_id:", boostRigId);
  console.log("boost config PDA:", boostPda.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
