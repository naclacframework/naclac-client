import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import type { TransactionSigner, Commitment, Address } from "@solana/kit";

const _dummyRpc = createSolanaRpc("");
export type NaclacRpc = typeof _dummyRpc;

const _dummyWs = createSolanaRpcSubscriptions("");
export type NaclacRpcSubscriptions = typeof _dummyWs;

/**
 * NaclacProvider — the connection config consumed by every Program instance.
 *
 * @property rpc              - A @solana/kit Rpc client created via createSolanaRpc().
 * @property rpcSubscriptions - A @solana/kit RpcSubscriptions client created via createSolanaRpcSubscriptions().
 * @property signer           - The wallet/keypair used to sign every transaction.
 * @property commitment       - Optional commitment override. Defaults to "confirmed".
 * @property _sendAndConfirm  - Bound sendAndConfirmTransaction from gill's createSolanaClient.
 *                              Automatically set when using createProvider(). Token utilities use this.
 */
export interface NaclacProvider {
  rpc: NaclacRpc;
  rpcSubscriptions: NaclacRpcSubscriptions;
  signer: TransactionSigner;
  commitment?: Commitment;
  _sendAndConfirm?: (tx: any) => Promise<string>;
  getBalance: (address: string | Address) => Promise<bigint>;
  getTokenBalance: (address: string | Address) => Promise<number>;
}
