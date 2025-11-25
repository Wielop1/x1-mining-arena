/**
 * Stake GAME tokens into the staking pool.
 *
 * Env:
 *   ANCHOR_WALLET (owner signer)
 *   RPC_URL or ANCHOR_PROVIDER_URL
 *   STAKE_AMOUNT (u64, default 1_000_000_000 = 1 GAME if decimals=9)
 *   LOCK_DAYS (u16, default 0)
 */
import { PublicKey } from "@solana/web3.js";
import { ixStake, PROGRAM_ID } from "../sdk/client";
import {
  findGlobalConfig,
  findStakingPool,
  findUserAccount,
  findUserStakePosition,
} from "../sdk/pdas";
import {
  ensureAta,
  getConnection,
  loadKeypair,
  sendTx,
  decodeUserAccount,
} from "./helpers";

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const owner = loadKeypair(walletPath);
  const connection = getConnection();

  const amount = process.env.STAKE_AMOUNT
    ? BigInt(process.env.STAKE_AMOUNT)
    : BigInt(1_000_000_000); // 1 GAME (decimals=9)
  const lockDays = process.env.LOCK_DAYS
    ? Number(process.env.LOCK_DAYS)
    : 7;

  const GAME_MINT = new PublicKey(
    "CnjGqKoErC2MvPpUJrbscS7KmSqNSHbrg3vMsP9rAD1C"
  );
  const XNT_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );

  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool] = findStakingPool(PROGRAM_ID);
  const [userAccount] = findUserAccount(owner.publicKey, PROGRAM_ID);

  let positionId = 1;
  const userAccountInfo = await connection.getAccountInfo(userAccount);
  if (userAccountInfo) {
    const decoded = decodeUserAccount(userAccountInfo.data);
    positionId =
      (decoded.nextPositionId as number | undefined) ||
      (decoded.next_position_id as number | undefined) ||
      1;
  }
  const [userStakePosition] = findUserStakePosition(
    owner.publicKey,
    positionId,
    PROGRAM_ID
  );

  // Ensure ATAs
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

  const sig = await sendTx(
    connection,
    owner,
    [
      ixStake({
        owner: owner.publicKey,
        stakingVault: new PublicKey(
          "6jvYaqokZPpQqXbTZZwZcMAkJCKeTJSEG7pn15JvY9sa"
        ),
        treasuryXntVault: new PublicKey(
          "2e9R8j7Ya8gvQeoa9DvEdJ24KfuMHkmjwayyoKtZHyn3"
        ),
        userGameAccount: userGameAta,
        userXntAccount: userXntAta,
        amount,
        lockDays,
        positionId,
      }),
    ],
    []
  );

  console.log("stake signature:", sig);
  console.log("amount:", amount.toString(), "lock_days:", lockDays);
  console.log("position_id used:", positionId);
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
