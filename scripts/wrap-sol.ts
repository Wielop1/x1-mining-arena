/**
 * Wraps native SOL into wSOL (mint So111...) into the ATA of the owner.
 *
 * Env:
 *   ANCHOR_WALLET (payer/owner, defaults to /root/.config/solana/id.json)
 *   RPC_URL or ANCHOR_PROVIDER_URL
 *   AMOUNT (SOL to wrap, default 0.3)
 */
import fs from "fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createSyncNativeInstruction,
} from "@solana/spl-token";

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const walletPath =
    process.env.ANCHOR_WALLET || "/root/.config/solana/id.json";
  const payer = loadKeypair(walletPath);

  const rpc =
    process.env.RPC_URL ||
    process.env.ANCHOR_PROVIDER_URL ||
    "https://rpc.testnet.x1.xyz";
  const connection = new Connection(rpc, "confirmed");

  const amountSol = process.env.AMOUNT ? Number(process.env.AMOUNT) : 0.3;
  const amountLamports = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));

  const WSOL_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );

  const ata = getAssociatedTokenAddressSync(
    WSOL_MINT,
    payer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // Create ATA if missing, by transferring 0 lamports (it will fail if missing, so we just create via CPI)
  const instructions = [];

  // Create ATA via system (explicit create)
  const ataAccountInfo = await connection.getAccountInfo(ata);
  if (!ataAccountInfo) {
    instructions.push(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: ata,
        lamports: 0,
        space: 165,
        programId: TOKEN_PROGRAM_ID,
      })
    );
  }

  // Transfer SOL to ATA
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: ata,
      lamports: Number(amountLamports),
    })
  );

  // Sync native
  instructions.push(createSyncNativeInstruction(ata));

  const tx = new Transaction().add(...instructions);
  tx.feePayer = payer.publicKey;

  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);

  console.log("Wrap SOL signature:", sig);
  console.log("Owner:", payer.publicKey.toBase58());
  console.log("wSOL ATA:", ata.toBase58());
  console.log("Wrapped", amountSol, "SOL into wSOL (mint So111...)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
