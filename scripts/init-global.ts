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

  // Game mint keypair must be signable (we init it on-chain). Default path can be overridden via GAME_MINT_KEYPAIR.
  const gameMintKeypairPath =
    process.env.GAME_MINT_KEYPAIR || "/root/.config/solana/game-mint.json";
  const gameMintKeypair = loadKeypair(gameMintKeypairPath);
  const GAME_MINT = gameMintKeypair.publicKey;

  const [globalConfig, globalBump] = findGlobalConfig(PROGRAM_ID);

  // Ensure admin XNT ATA (GAME mint ATA tworzymy dopiero po utworzeniu mintu w on-chain init).
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
    [gameMintKeypair]
  );

  console.log("initializeGlobal signature:", sig);
  console.log("GlobalConfig PDA:", globalConfig.toBase58(), "bump", globalBump);
  console.log(
    "GAME mint pubkey:",
    GAME_MINT.toBase58(),
    "keypair:",
    gameMintKeypairPath
  );
  console.log("Admin XNT ATA:", adminXntAta.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
