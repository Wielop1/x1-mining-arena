import { PublicKey } from "@solana/web3.js";
import { ixInitializeGlobal, PROGRAM_ID } from "../sdk/client";
import { findGlobalConfig } from "../sdk/pdas";
import { ensureAta, getConnection, loadKeypair, sendTx } from "./helpers";

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const admin = loadKeypair(walletPath);
  const connection = getConnection();

  const XNT_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );
  const GAME_MINT = new PublicKey(
    "2iz7CgsTQifAg1z1wkC7MNj876hENnDP55PLpg1KsbVr"
  );

  const [globalConfig, globalBump] = findGlobalConfig(PROGRAM_ID);

  // Ensure admin ATAs (requested).
  const adminGameAta = await ensureAta({
    connection,
    payer: admin,
    mint: GAME_MINT,
    owner: admin.publicKey,
  });
  const adminXntAta = await ensureAta({
    connection,
    payer: admin,
    mint: XNT_MINT,
    owner: admin.publicKey,
  });

  const sig = await sendTx(
    connection,
    admin,
    [
      ixInitializeGlobal({
        admin: admin.publicKey,
        payer: admin.publicKey,
        xntMint: XNT_MINT,
        gameMint: GAME_MINT,
        halvingInterval: 100000000,
        stakingShareBps: 3000,
      }),
    ],
    []
  );

  console.log("initializeGlobal signature:", sig);
  console.log("GlobalConfig PDA:", globalConfig.toBase58(), "bump", globalBump);
  console.log("Admin GAME ATA:", adminGameAta.toBase58());
  console.log("Admin XNT ATA:", adminXntAta.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
