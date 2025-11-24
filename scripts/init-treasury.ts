import { PublicKey } from "@solana/web3.js";
import { ixInitializeTreasuryVault, PROGRAM_ID } from "../sdk/client";
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

  const [globalConfig, globalBump] = findGlobalConfig(PROGRAM_ID);

  // Treasury vault ATA owned by GlobalConfig PDA.
  const treasuryAta = await ensureAta({
    connection,
    payer: admin,
    mint: XNT_MINT,
    owner: globalConfig,
  });

  const sig = await sendTx(
    connection,
    admin,
    [
      ixInitializeTreasuryVault({
        admin: admin.publicKey,
        xntMint: XNT_MINT,
        treasuryXntVault: treasuryAta,
      }),
    ],
    []
  );

  console.log("initializeTreasuryVault signature:", sig);
  console.log("GlobalConfig PDA:", globalConfig.toBase58(), "bump", globalBump);
  console.log("Treasury XNT ATA (owner = global_config):", treasuryAta.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
