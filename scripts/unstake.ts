/**
 * Unstake staked GAME.
 *
 * Env:
 *   ANCHOR_WALLET (owner signer)
 *   RPC_URL or ANCHOR_PROVIDER_URL
 *   POSITION_ID (0 = legacy, >0 = new position)
 */
import { PublicKey } from "@solana/web3.js";
import { ixUnstake, PROGRAM_ID } from "../sdk/client";
import {
  findGlobalConfig,
  findStakingPool,
  findUserStake,
  findUserStakePosition,
  findUserAccount,
} from "../sdk/pdas";
import { ensureAta, getConnection, loadKeypair, sendTx } from "./helpers";

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

  const GAME_MINT = new PublicKey(
    "CnjGqKoErC2MvPpUJrbscS7KmSqNSHbrg3vMsP9rAD1C"
  );
  const XNT_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );

  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool] = findStakingPool(PROGRAM_ID);
  const [userStakePosition] =
    positionId === 0
      ? findUserStake(owner.publicKey, PROGRAM_ID)
      : findUserStakePosition(owner.publicKey, positionId, PROGRAM_ID);
  const [userAccount] = findUserAccount(owner.publicKey, PROGRAM_ID);

  // Ensure ATAs for user
  const userGameAta = await ensureAta({
    connection,
    payer: owner,
    mint: GAME_MINT,
    owner: owner.publicKey,
  });
  const userXntAta = await ensureAta({
    connection,
    payer: owner,
    mint: XNT_MINT,
    owner: owner.publicKey,
  });

  // Treasury/staking vaults known from init
  const stakingVault = new PublicKey(
    "6jvYaqokZPpQqXbTZZwZcMAkJCKeTJSEG7pn15JvY9sa"
  );
  const treasuryXntVault = new PublicKey(
    "2e9R8j7Ya8gvQeoa9DvEdJ24KfuMHkmjwayyoKtZHyn3"
  );

  const sig = await sendTx(
    connection,
    owner,
    [
      ixUnstake({
        owner: owner.publicKey,
        stakingVault,
        treasuryXntVault,
        userGameAccount: userGameAta,
        userXntAccount: userXntAta,
        positionId,
      }),
    ],
    []
  );

  console.log("unstake signature:", sig);
  console.log("position_id:", positionId);
  console.log("user GAME ATA:", userGameAta.toBase58());
  console.log("user XNT ATA:", userXntAta.toBase58());
  console.log("staking pool PDA:", stakingPool.toBase58());
  console.log("userStakePosition PDA:", userStakePosition.toBase58());
  console.log("userAccount PDA:", userAccount.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
