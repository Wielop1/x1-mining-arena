/**
 * Mine with a rig.
 *
 * Env:
 *   ANCHOR_WALLET (payer signer)
 *   RPC_URL or ANCHOR_PROVIDER_URL
 *   RIG_ID (optional, default 1)
 *
 * Requires:
 *   - XNT balance on payer's ATA (So111…)
 *   - GAME ATA for payer (created automatically)
 */
import { PublicKey } from "@solana/web3.js";
import { ixMineWithRig, PROGRAM_ID } from "../sdk/client";
import {
  findGlobalConfig,
  findStakingPool,
  findUserAccount,
} from "../sdk/pdas";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ensureAta,
  getConnection,
  loadKeypair,
  sendTx,
} from "./helpers";

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const payer = loadKeypair(walletPath);
  const connection = getConnection();

  const RIG_ID = process.env.RIG_ID ? Number(process.env.RIG_ID) : 1;

  const XNT_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );
  const GAME_MINT = new PublicKey(
    "CnjGqKoErC2MvPpUJrbscS7KmSqNSHbrg3vMsP9rAD1C"
  );

  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool] = findStakingPool(PROGRAM_ID);
  const [userAccount] = findUserAccount(payer.publicKey, PROGRAM_ID);

  // Ensure ATAs for user
  const userGameAta = await ensureAta({
    connection,
    payer,
    mint: GAME_MINT,
    owner: payer.publicKey,
  });
  const userXntAta = await ensureAta({
    connection,
    payer,
    mint: XNT_MINT,
    owner: payer.publicKey,
  });

  // Fetch treasury vault from GlobalConfig (account data offset includes 8-byte discriminator)
  const globalInfo = await connection.getAccountInfo(globalConfig);
  if (!globalInfo) {
    throw new Error("GlobalConfig account not found on chain");
  }
  const data = globalInfo.data;
  const offset = 8;
  const treasuryVault = new PublicKey(
    data.subarray(offset + 32 * 3, offset + 32 * 4)
  );

  const sig = await sendTx(
    connection,
    payer,
    [
      ixMineWithRig({
        payer: payer.publicKey,
        gameMint: GAME_MINT,
        userGameAccount: userGameAta,
        userXntAccount: userXntAta,
        treasuryXntVault: treasuryVault,
        rigId: RIG_ID,
      }),
    ],
    []
  );

  console.log("mine_with_rig signature:", sig);
  console.log("rig_id:", RIG_ID);
  console.log("user XNT ATA:", userXntAta.toBase58());
  console.log("user GAME ATA:", userGameAta.toBase58());
  console.log("treasury XNT vault:", treasuryVault.toBase58());
  console.log("user account PDA:", userAccount.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
