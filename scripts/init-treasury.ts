import { PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { ixInitializeTreasuryVault, PROGRAM_ID } from "../sdk/client";
import { findGlobalConfig } from "../sdk/pdas";
import { getConnection, loadKeypair, sendTx } from "./helpers";

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const admin = loadKeypair(walletPath);
  const connection = getConnection();

  const XNT_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );

  const [globalConfig, globalBump] = findGlobalConfig(PROGRAM_ID);

  // Create a fresh token account keypair for the treasury vault; program will init it.
  const treasuryVaultKp = Keypair.generate();

  const sig = await sendTx(
    connection,
    admin,
    [
      ixInitializeTreasuryVault({
        admin: admin.publicKey,
        xntMint: XNT_MINT,
        treasuryXntVault: treasuryVaultKp.publicKey,
      }),
    ],
    [treasuryVaultKp]
  );

  console.log("initializeTreasuryVault signature:", sig);
  console.log("GlobalConfig PDA:", globalConfig.toBase58(), "bump", globalBump);
  console.log(
    "Treasury XNT vault:",
    treasuryVaultKp.publicKey.toBase58(),
    "(keypair generated in script)"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
