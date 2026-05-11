import { createTransaction, address } from "gill";
import {
  getCreateAccountInstruction,
  getInitializeMintInstruction,
  getMintSize,
  getMintTokensInstructions,
  getAssociatedTokenAccountAddress,
  TOKEN_PROGRAM_ADDRESS,
} from "gill/programs";
import { sendAndConfirmTransactionFactory } from "@solana/kit";
import type { NaclacProvider } from "../provider";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper: get a working sendAndConfirmTransaction from any provider.
// If the provider was created through createProvider() it already has
// _sendAndConfirm bound (preferably use that). Otherwise build one from
// the provider's rpc + rpcSubscriptions (fallback).
// ─────────────────────────────────────────────────────────────────────────────
function getSendAndConfirm(provider: NaclacProvider) {
  if (provider._sendAndConfirm) return provider._sendAndConfirm;

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc: provider.rpc as any,
    rpcSubscriptions: provider.rpcSubscriptions as any,
  });
  return (tx: any) => sendAndConfirm(tx, { commitment: provider.commitment ?? "confirmed" });
}

// ─────────────────────────────────────────────────────────────────────────────
// createMint
// Creates and initializes a new SPL Token mint on-chain.
//
// @param provider      - NaclacProvider (must be created via createProvider)
// @param mintSigner    - A KeyPairSigner used as the new mint account address
// @param tokenProgram  - Token program address (defaults to standard SPL Token)
// @param mintAuthority - Public key of the mint authority (defaults to provider signer)
// @param decimals      - Number of decimal places
// ─────────────────────────────────────────────────────────────────────────────
export async function createMint(
  provider: NaclacProvider,
  mintSigner: any,
  tokenProgram: any = TOKEN_PROGRAM_ADDRESS,
  mintAuthority: string = provider.signer.address as string,
  decimals: number = 6,
): Promise<string> {
  const rpc = provider.rpc as any;
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const space = getMintSize();
  const lamports = await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();

  const transaction = createTransaction({
    feePayer: provider.signer,
    version: "legacy",
    latestBlockhash,
    instructions: [
      getCreateAccountInstruction({
        space,
        lamports,
        newAccount: mintSigner,
        payer: provider.signer,
        programAddress: tokenProgram,
      }),
      getInitializeMintInstruction(
        {
          mint: mintSigner.address,
          mintAuthority: address(mintAuthority),
          freezeAuthority: address(mintAuthority),
          decimals,
        },
        { programAddress: tokenProgram },
      ),
    ],
  });

  await getSendAndConfirm(provider)(transaction);
  return mintSigner.address as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// createAta
// Creates an Associated Token Account for a given owner+mint.
// Idempotent — returns immediately if the ATA already exists.
//
// @param provider      - NaclacProvider
// @param mint          - The mint address (string)
// @param owner         - The wallet address that will own the ATA
// @param tokenProgram  - Token program address (defaults to standard SPL Token)
// Returns the ATA address as a string.
// ─────────────────────────────────────────────────────────────────────────────
export async function createAta(
  provider: NaclacProvider,
  mint: string,
  owner: string,
  tokenProgram: any = TOKEN_PROGRAM_ADDRESS,
): Promise<string> {
  const rpc = provider.rpc as any;

  // gill derives the canonical ATA address using the correct ATA program address
  const ata = await getAssociatedTokenAccountAddress(
    mint as any,
    owner as any,
    tokenProgram,
  );

  // Idempotency: if ATA already exists, skip
  // Must use base64 encoding — base58 fails for 32-byte addresses (>128 bytes when encoded)
  const existing = await rpc.getAccountInfo(ata, { encoding: "base64" }).send();
  if (existing.value !== null) return ata as string;

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // getMintTokensInstructions returns [createAtaIdempotent, mintTo].
  // We only want instruction[0] (the idempotent ATA create).
  const instructions = getMintTokensInstructions({
    feePayer: provider.signer,
    mint: mint as any,
    mintAuthority: provider.signer,
    destination: owner as any,
    ata: ata as any,
    amount: 0n,
    tokenProgram,
  });

  const transaction = createTransaction({
    feePayer: provider.signer,
    version: "legacy",
    latestBlockhash,
    instructions: [instructions[0]], // only the createATA idempotent instruction
  });

  await getSendAndConfirm(provider)(transaction);
  return ata as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// mintTo
// Mints tokens to a destination owner's Associated Token Account.
// Automatically creates the ATA if it does not exist (idempotent).
//
// @param provider         - NaclacProvider (must be mint authority)
// @param mint             - The mint address (string)
// @param destinationOwner - The wallet address of the token recipient
// @param amount           - Amount in raw token units (e.g. 1_000_000 for 1 USDC with 6 decimals)
// @param tokenProgram     - Token program address (defaults to standard SPL Token)
// ─────────────────────────────────────────────────────────────────────────────
export async function mintTo(
  provider: NaclacProvider,
  mint: string,
  destinationOwner: string,
  amount: bigint,
  tokenProgram: any = TOKEN_PROGRAM_ADDRESS,
): Promise<void> {
  const rpc = provider.rpc as any;
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Derive the destination ATA (gill uses the correct ATA program address)
  const ata = await getAssociatedTokenAccountAddress(
    mint as any,
    destinationOwner as any,
    tokenProgram,
  );

  // getMintTokensInstructions returns:
  //   [0] createAssociatedTokenAccountIdempotent  (no-op if ATA already exists)
  //   [1] mintTo
  const instructions = getMintTokensInstructions({
    feePayer: provider.signer,
    mint: mint as any,
    mintAuthority: provider.signer,
    destination: destinationOwner as any,
    ata: ata as any,
    amount,
    tokenProgram,
  });

  const transaction = createTransaction({
    feePayer: provider.signer,
    version: "legacy",
    latestBlockhash,
    instructions, // send both: create ATA (idempotent) + mintTo
  });

  await getSendAndConfirm(provider)(transaction);
}
