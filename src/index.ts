/**
 * @naclac/client — The core TypeScript SDK for the Naclac framework.
 *
 * @example
 * ```ts
 * import * as naclac from "@naclac/client";
 * import { IDL } from "../target/types/counter_test";
 *
 * const provider: naclac.NaclacProvider = naclac.createProvider("devnet", wallet);
 * const program = new naclac.Program(IDL, provider);
 *
 * // Send a transaction
 * const sig = await program.methods
 *   .initialize()
 *   .accounts({ payer: wallet.address, systemProgram: naclac.SYSTEM_PROGRAM_ID })
 *   .rpc();
 *
 * // Fetch an account
 * const counter = await program.account.Counter.fetch(pdaAddress);
 * console.log(counter.count);
 * ```
 */

export { Program } from "./program";
export { MethodsBuilder } from "./methods";
export { AccountFetcher } from "./account";
export * from "./wrappers";

export type { NaclacProvider } from "./provider";

export type {
  NaclacIdl,
  IdlInstruction,
  IdlAccount,
  IdlAccountDef,
  IdlField,
  IdlPda,
  IdlSeed,
  IdlEventDef,
  IdlEventField,
  IdlErrorDef,
  IdlConstant,
} from "./idl";

export {
  encodeInstructionData,
  decodeAccountData,
  getIdlCodec,
} from "./coder/index";
export type { NaclacCodec } from "./coder/index";

export { 
  resolvePdas, 
  translateRpcError, 
  getRecentBlockhash, 
  getAssociatedTokenAddress, 
  sleep, 
  logError, 
  padString, 
  toLeBytes, 
  withRetry 
} from "./utils/index";
export type { ResolvedPda } from "./utils/index";

export { createProvider, loadNodeWallet, transferSol } from "./utils/setup";
export type { Cluster } from "./utils/setup";

// gill is a fully compatible superset of @solana/kit + @solana/codecs.
// Re-exporting it gives consumers address, getProgramDerivedAddress,
// generateKeyPairSigner, and all other @solana/kit primitives without
// needing a separate @solana/kit import in their code.
export * from "gill";

export {
  address,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  signTransactionMessageWithSigners,
  createKeyPairSignerFromBytes,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  sendAndConfirmTransactionFactory,
  AccountRole,
  pipe,
} from "@solana/kit";
export * from "./constants";
export * from "./utils/token";