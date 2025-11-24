import { PublicKey } from "@solana/web3.js";

const utf8 = (s: string) => Buffer.from(s, "utf8");

export const PDA_SEEDS = {
  globalConfig: utf8("global-config"),
  stakingPool: utf8("staking-pool"),
  userAccount: utf8("user-account"),
  userStake: utf8("user-stake"),
  boostConfig: utf8("boost-config"),
};

export function findGlobalConfig(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([PDA_SEEDS.globalConfig], programId);
}

export function findStakingPool(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([PDA_SEEDS.stakingPool], programId);
}

export function findUserAccount(user: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [PDA_SEEDS.userAccount, user.toBuffer()],
    programId
  );
}

export function findUserStake(user: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [PDA_SEEDS.userStake, user.toBuffer()],
    programId
  );
}

export function findBoostConfig(id: number, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [PDA_SEEDS.boostConfig, Buffer.from([id])],
    programId
  );
}
