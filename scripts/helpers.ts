import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { BorshAccountsCoder, Idl } from "@coral-xyz/anchor";
import fs from "fs";

// Lazy-load the IDL coder for decoding program accounts in scripts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require("../target/idl/x1_mining_arena.json") as Idl;
const coder = new BorshAccountsCoder(idl);

export function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function getConnection(): Connection {
  const url =
    process.env.ANCHOR_PROVIDER_URL ||
    process.env.SOLANA_URL ||
    "https://rpc.testnet.x1.xyz";
  return new Connection(url, "confirmed");
}

export async function ensureAta(params: {
  connection: Connection;
  payer: Keypair;
  mint: PublicKey;
  owner: PublicKey;
}) {
  const { connection, payer, mint, owner } = params;
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner,
    true,
    "confirmed",
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata.address;
}

export async function sendTx(
  connection: Connection,
  payer: Keypair,
  ixs: TransactionInstruction[],
  extraSigners: Keypair[] = []
) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  const sig = await sendAndConfirmTransaction(connection, tx, [
    payer,
    ...extraSigners,
  ]);
  return sig;
}

export function decodeUserAccount(data: Buffer) {
  return coder.decode("userAccount", data);
}

export function decodeUserStakePosition(data: Buffer) {
  return coder.decode("userStakePosition", data);
}

export function decodeGlobalConfig(data: Buffer) {
  return coder.decode("globalConfig", data);
}

export function decodeStakingPool(data: Buffer) {
  return coder.decode("stakingPool", data);
}

export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };
