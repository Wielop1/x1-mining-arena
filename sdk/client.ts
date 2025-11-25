import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash } from "crypto";
import {
  findBoostConfig,
  findGlobalConfig,
  findStakingPool,
  findUserAccount,
  findUserStake,
  findUserStakePosition,
} from "./pdas";

/**
 * Program ID for x1-mining-arena on X1 testnet (deployed).
 */
export const PROGRAM_ID = new PublicKey("9Hd5Nv7MYPeFbSntrdEg92uojcWGuGGH2Mkmyrm7eMGd");

type BNish = number | bigint;

const utf8 = (s: string) => Buffer.from(s, "utf8");

const toU8 = (v: BNish) => {
  const b = Buffer.alloc(1);
  b.writeUInt8(Number(v));
  return b;
};
const toU16 = (v: BNish) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(Number(v));
  return b;
};
const toU64 = (v: BNish) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const toI64 = (v: BNish) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(v));
  return b;
};

function discriminator(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function ix(
  name: string,
  dataFields: Buffer[],
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: Buffer.concat([discriminator(name), ...dataFields]),
  });
}

// Instruction builders

export function ixInitializeGlobal(params: {
  admin: PublicKey;
  payer: PublicKey;
  xntMint: PublicKey;
  gameMint: PublicKey;
  halvingInterval: BNish;
  stakingShareBps: BNish;
}) {
  const { admin, payer, xntMint, gameMint, halvingInterval, stakingShareBps } =
    params;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  return ix("initialize_global", [
    admin.toBuffer(),
    toU16(stakingShareBps),
    toU64(halvingInterval),
  ], [
    { pubkey: globalConfig, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: xntMint, isSigner: false, isWritable: false },
    { pubkey: gameMint, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]);
}

export function ixInitializeTreasuryVault(params: {
  admin: PublicKey;
  xntMint: PublicKey;
  treasuryXntVault: PublicKey;
}) {
  const { admin, xntMint, treasuryXntVault } = params;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  return ix("initialize_treasury_vault", [], [
    { pubkey: admin, isSigner: true, isWritable: true },
    { pubkey: globalConfig, isSigner: false, isWritable: true },
    // Mint must be writable to satisfy Anchor mut constraint
    { pubkey: xntMint, isSigner: false, isWritable: true },
    { pubkey: treasuryXntVault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]);
}

export function ixInitializeStakingPool(params: {
  admin: PublicKey;
  gameMint: PublicKey;
  xntMint: PublicKey;
  stakingVault: PublicKey;
}) {
  const { admin, gameMint, xntMint, stakingVault } = params;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool] = findStakingPool(PROGRAM_ID);
  return ix("initialize_staking_pool", [], [
    { pubkey: admin, isSigner: true, isWritable: true },
    { pubkey: globalConfig, isSigner: false, isWritable: true },
    { pubkey: stakingPool, isSigner: false, isWritable: true },
    // gameMint has mut constraint in program, must be writable
    { pubkey: gameMint, isSigner: false, isWritable: true },
    { pubkey: xntMint, isSigner: false, isWritable: false },
    { pubkey: stakingVault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ]);
}

export function ixMineWithRig(params: {
  payer: PublicKey;
  gameMint: PublicKey;
  userGameAccount: PublicKey;
  userXntAccount: PublicKey;
  treasuryXntVault: PublicKey;
  rigId: number;
}) {
  const { payer, gameMint, userGameAccount, userXntAccount, treasuryXntVault, rigId } = params;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool] = findStakingPool(PROGRAM_ID);
  const [userAccount] = findUserAccount(payer, PROGRAM_ID);
  return ix("mine_with_rig", [toU8(rigId)], [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: globalConfig, isSigner: false, isWritable: true },
    { pubkey: stakingPool, isSigner: false, isWritable: true },
    { pubkey: gameMint, isSigner: false, isWritable: true },
    { pubkey: userGameAccount, isSigner: false, isWritable: true },
    { pubkey: userXntAccount, isSigner: false, isWritable: true },
    { pubkey: treasuryXntVault, isSigner: false, isWritable: true },
    { pubkey: userAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ]);
}

export function ixStake(params: {
  owner: PublicKey;
  stakingVault: PublicKey;
  treasuryXntVault: PublicKey;
  userGameAccount: PublicKey;
  userXntAccount: PublicKey;
  amount: BNish;
  lockDays: number;
  positionId: number;
}) {
  const {
    owner,
    stakingVault,
    treasuryXntVault,
    userGameAccount,
    userXntAccount,
    amount,
    lockDays,
    positionId,
  } = params;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool] = findStakingPool(PROGRAM_ID);
  const [userStakePosition] = findUserStakePosition(
    owner,
    positionId,
    PROGRAM_ID
  );
  const [userAccount] = findUserAccount(owner, PROGRAM_ID);
  return ix("stake", [toU64(amount), toU16(lockDays)], [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: globalConfig, isSigner: false, isWritable: true },
    { pubkey: stakingPool, isSigner: false, isWritable: true },
    { pubkey: stakingVault, isSigner: false, isWritable: true },
    { pubkey: treasuryXntVault, isSigner: false, isWritable: true },
    { pubkey: userGameAccount, isSigner: false, isWritable: true },
    { pubkey: userXntAccount, isSigner: false, isWritable: true },
    { pubkey: userStakePosition, isSigner: false, isWritable: true },
    { pubkey: userAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ]);
}

export function ixClaim(params: {
  owner: PublicKey;
  treasuryXntVault: PublicKey;
  userXntAccount: PublicKey;
  positionId: number;
}) {
  const { owner, treasuryXntVault, userXntAccount, positionId } = params;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool] = findStakingPool(PROGRAM_ID);
  const [userStakePosition] =
    positionId === 0
      ? findUserStake(owner, PROGRAM_ID)
      : findUserStakePosition(owner, positionId, PROGRAM_ID);
  return ix("claim", [], [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: globalConfig, isSigner: false, isWritable: true },
    { pubkey: stakingPool, isSigner: false, isWritable: true },
    { pubkey: treasuryXntVault, isSigner: false, isWritable: true },
    { pubkey: userXntAccount, isSigner: false, isWritable: true },
    { pubkey: userStakePosition, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]);
}

export function ixUnstake(params: {
  owner: PublicKey;
  stakingVault: PublicKey;
  treasuryXntVault: PublicKey;
  userGameAccount: PublicKey;
  userXntAccount: PublicKey;
  positionId: number;
}) {
  const {
    owner,
    stakingVault,
    treasuryXntVault,
    userGameAccount,
    userXntAccount,
    positionId,
  } = params;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [stakingPool] = findStakingPool(PROGRAM_ID);
  const [stakePosition] =
    positionId === 0
      ? findUserStake(owner, PROGRAM_ID)
      : findUserStakePosition(owner, positionId, PROGRAM_ID);
  return ix("unstake", [], [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: globalConfig, isSigner: false, isWritable: true },
    { pubkey: stakingPool, isSigner: false, isWritable: true },
    { pubkey: stakingVault, isSigner: false, isWritable: true },
    { pubkey: treasuryXntVault, isSigner: false, isWritable: true },
    { pubkey: userGameAccount, isSigner: false, isWritable: true },
    { pubkey: userXntAccount, isSigner: false, isWritable: true },
    { pubkey: stakePosition, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]);
}

export function ixActivateBoost(params: {
  user: PublicKey;
  boostId: number;
}) {
  const { user, boostId } = params;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [boostConfig] = findBoostConfig(boostId, PROGRAM_ID);
  const [userAccount] = findUserAccount(user, PROGRAM_ID);
  return ix("activate_boost", [], [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: globalConfig, isSigner: false, isWritable: false },
    { pubkey: boostConfig, isSigner: false, isWritable: false },
    { pubkey: userAccount, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
}

export function ixUpsertBoostConfig(params: {
  admin: PublicKey;
  id: number;
  kind: number; // 0: MiningRewardBps, 1: MiningPointsBps, 2: FreeRigTicket, 3: StakingMultiplierBps
  costBoostPoints: bigint;
  valueBps: number;
  durationSeconds: bigint;
  rigId?: number;
}) {
  const {
    admin,
    id,
    kind,
    costBoostPoints,
    valueBps,
    durationSeconds,
    rigId,
  } = params;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [boostConfig] = findBoostConfig(id, PROGRAM_ID);

  // encode args manually: id(u8) kind(u8) cost(u64) value_bps(u16) duration(i64) rig_id(option u8)
  const buf = Buffer.alloc(8 + 1 + 1 + 8 + 2 + 8 + 2); // discriminator + fields (rig option up to 2 bytes)
  const disc = createHash("sha256")
    .update("global:upsert_boost_config")
    .digest()
    .subarray(0, 8);
  disc.copy(buf, 0);
  let offset = 8;
  buf.writeUInt8(id, offset);
  offset += 1;
  buf.writeUInt8(kind, offset);
  offset += 1;
  buf.writeBigUInt64LE(BigInt(costBoostPoints), offset);
  offset += 8;
  buf.writeUInt16LE(valueBps, offset);
  offset += 2;
  buf.writeBigInt64LE(BigInt(durationSeconds), offset);
  offset += 8;
  if (rigId !== undefined) {
    buf.writeUInt8(1, offset);
    offset += 1;
    buf.writeUInt8(rigId, offset);
    offset += 1;
  } else {
    buf.writeUInt8(0, offset);
    offset += 1;
  }
  const data = buf.subarray(0, offset);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: globalConfig, isSigner: false, isWritable: true },
      { pubkey: boostConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function ixApplyRankingResults(params: {
  admin: PublicKey;
  user: PublicKey;
  addedBoostPoints: BNish;
}) {
  const { admin, user, addedBoostPoints } = params;
  const [globalConfig] = findGlobalConfig(PROGRAM_ID);
  const [userAccount] = findUserAccount(user, PROGRAM_ID);
  return ix("apply_ranking_results", [user.toBuffer(), toU64(addedBoostPoints)], [
    { pubkey: admin, isSigner: true, isWritable: true },
    { pubkey: globalConfig, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: false },
    { pubkey: userAccount, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
}
