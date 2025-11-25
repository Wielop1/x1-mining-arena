/**
 * Activates a boost for the user.
 *
 * Env:
 *   ANCHOR_WALLET (user signer)
 *   RPC_URL or ANCHOR_PROVIDER_URL
 *   BOOST_ID (default 1)
 */
import { PublicKey } from "@solana/web3.js";
import { ixActivateBoost, PROGRAM_ID } from "../sdk/client";
import { findGlobalConfig, findUserAccount } from "../sdk/pdas";
import { getConnection, loadKeypair, sendTx } from "./helpers";

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const user = loadKeypair(walletPath);
  const connection = getConnection();

  const boostId = process.env.BOOST_ID ? Number(process.env.BOOST_ID) : 1;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [userAccount] = findUserAccount(user.publicKey, PROGRAM_ID);

  const sig = await sendTx(
    connection,
    user,
    [
      ixActivateBoost({
        user: user.publicKey,
        boostId,
      }),
    ],
    []
  );

  console.log("activate boost signature:", sig);
  console.log("boost id:", boostId);
  console.log("global config PDA:", globalConfig.toBase58());
  console.log("userAccount PDA:", userAccount.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
