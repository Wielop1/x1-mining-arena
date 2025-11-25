/**
 * Admin: grants boost_points to a user via apply_ranking_results.
 *
 * Env:
 *   ANCHOR_WALLET (admin signer)
 *   RPC_URL or ANCHOR_PROVIDER_URL
 *   USER_PUBKEY (defaults to admin)
 *   BOOST_POINTS (u64, default 1000)
 */
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { ixApplyRankingResults, PROGRAM_ID } from "../sdk/client";
import { findUserAccount } from "../sdk/pdas";
import { getConnection, loadKeypair } from "./helpers";

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const admin = loadKeypair(walletPath);
  const connection = getConnection();

  const user =
    process.env.USER_PUBKEY !== undefined
      ? new PublicKey(process.env.USER_PUBKEY)
      : admin.publicKey;
  const points = process.env.BOOST_POINTS
    ? BigInt(process.env.BOOST_POINTS)
    : BigInt(1000);

  const ix = ixApplyRankingResults({
    admin: admin.publicKey,
    user,
    addedBoostPoints: points,
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = admin.publicKey;
  const sig = await sendAndConfirmTransaction(connection, tx, [admin]);

  const [userAccount] = findUserAccount(user, PROGRAM_ID);
  console.log("grant boost points signature:", sig);
  console.log("user:", user.toBase58(), "boost_points added:", points.toString());
  console.log("UserAccount PDA:", userAccount.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
