/**
 * List staking positions for the connected wallet.
 *
 * Env:
 *   ANCHOR_WALLET
 *   RPC_URL or ANCHOR_PROVIDER_URL
 */
import { BorshAccountsCoder, utils } from "@coral-xyz/anchor";
import { PROGRAM_ID } from "../sdk/client";
import { findStakingPool, findUserStake, findUserStakePosition } from "../sdk/pdas";
import {
  decodeStakingPool,
  decodeUserStakePosition,
  getConnection,
  loadKeypair,
} from "./helpers";

const PRECISION = 1_000_000_000_000n;

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const owner = loadKeypair(walletPath);
  const connection = getConnection();

  const [stakingPoolPda] = findStakingPool(PROGRAM_ID);
  const stakingPoolInfo = await connection.getAccountInfo(stakingPoolPda);
  if (!stakingPoolInfo) {
    throw new Error("StakingPool account not found");
  }
  const stakingPool = decodeStakingPool(stakingPoolInfo.data);
  const accRewardPerShare = BigInt(stakingPool.accRewardPerShare.toString());

  const discriminator = utils.bytes.bs58.encode(
    BorshAccountsCoder.accountDiscriminator("userStakePosition")
  );
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: discriminator,
        },
      },
    ],
  });

  const ownerKey = owner.publicKey.toBase58();
  const summaries = accounts
    .map((acct) => {
      const decoded = decodeUserStakePosition(acct.account.data);
      if (decoded.owner.toBase58() !== ownerKey) {
        return null;
      }
      const rawPositionId =
        (decoded as any).positionId ?? (decoded as any).position_id ?? 0;
      const rawAmount =
        (decoded as any).amountStaked ?? (decoded as any).amount_staked;
      const rawEffective =
        (decoded as any).effectiveStake ?? (decoded as any).effective_stake;
      const rawRewardDebt =
        (decoded as any).rewardDebt ?? (decoded as any).reward_debt;
      const rawLock =
        (decoded as any).lockUntilTs ?? (decoded as any).lock_until_ts ?? 0;

      const positionId = Number(rawPositionId);
      const amount = BigInt(rawAmount.toString());
      const effective = BigInt(rawEffective.toString());
      const rewardDebt = BigInt(rawRewardDebt.toString());
      const accrued = (effective * accRewardPerShare) / PRECISION;
      const pending = accrued > rewardDebt ? accrued - rewardDebt : 0n;
      const lockUntil =
        typeof rawLock === "number" ? rawLock : Number(rawLock);
      return {
        pubkey: acct.pubkey.toBase58(),
        positionId,
        amount,
        effective,
        lockUntil,
        pending,
        legacy:
          acct.pubkey.equals(findUserStake(owner.publicKey, PROGRAM_ID)[0]) ||
          positionId === 0,
        expectedPda:
          positionId === 0
            ? findUserStake(owner.publicKey, PROGRAM_ID)[0].toBase58()
            : findUserStakePosition(owner.publicKey, positionId, PROGRAM_ID)[0].toBase58(),
      };
    })
    .filter(Boolean) as {
      pubkey: string;
      positionId: number;
      amount: bigint;
      effective: bigint;
      lockUntil: number;
      pending: bigint;
      legacy: boolean;
      expectedPda: string;
    }[];

  summaries.sort((a, b) => a.positionId - b.positionId);

  if (!summaries.length) {
    console.log("No staking positions found for owner", ownerKey);
    return;
  }

  console.log("Found positions for", ownerKey);
  summaries.forEach((s) => {
    console.log(
      `position ${s.positionId} (${s.legacy ? "legacy" : "new"})`,
      "\npda:", s.pubkey,
      "\nexpected_pda:", s.expectedPda,
      "\namount_staked:", s.amount.toString(),
      "\neffective_stake:", s.effective.toString(),
      "\nlock_until_ts:", s.lockUntil,
      "\npending_rewards:", s.pending.toString(),
      "\n---"
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
