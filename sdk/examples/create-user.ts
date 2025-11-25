/**
 * Initializes a UserAccount PDA by calling `apply_ranking_results` with 0 boost points.
 *
 * Env:
 *   ANCHOR_WALLET (path to admin keypair; defaults to /root/.config/solana/id.json)
 *   RPC_URL or ANCHOR_PROVIDER_URL (defaults to https://rpc.testnet.x1.xyz)
 *   USER_PUBKEY (optional; defaults to admin pubkey)
 */
import fs from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { ixApplyRankingResults, PROGRAM_ID } from "../client";
import { findUserAccount } from "../pdas";

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const admin = loadKeypair(walletPath);

  const rpc =
    process.env.RPC_URL ||
    process.env.ANCHOR_PROVIDER_URL ||
    "https://rpc.testnet.x1.xyz";
  const connection = new Connection(rpc, "confirmed");

  const user =
    process.env.USER_PUBKEY !== undefined
      ? new PublicKey(process.env.USER_PUBKEY)
      : admin.publicKey;

  const [userAccount] = findUserAccount(user, PROGRAM_ID);

  const ix = ixApplyRankingResults({
    admin: admin.publicKey,
    user,
    addedBoostPoints: 0,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = admin.publicKey;

  const sig = await sendAndConfirmTransaction(connection, tx, [admin]);

  console.log("User init signature:", sig);
  console.log("User pubkey:", user.toBase58());
  console.log("UserAccount PDA:", userAccount.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
