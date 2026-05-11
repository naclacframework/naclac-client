import { createSolanaClient } from "gill";
import {
  createKeyPairSignerFromBytes,
  address,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  AccountRole,
  pipe,
  type Address,
  createSolanaRpcSubscriptions,
} from "@solana/kit";
import type { NaclacProvider } from "../provider";
import { SYSTEM_PROGRAM_ID } from "../constants";

export type Cluster =
  | "mainnet"
  | "devnet"
  | "testnet"
  | "localnet"
  | (string & {});

/**
 * Creates a NaclacProvider from a cluster moniker or custom RPC URL.
 * Uses gill's createSolanaClient under the hood which provides a bound
 * sendAndConfirmTransaction for use by the token utilities.
 */
export function createProvider(
  cluster: Cluster,
  signer: any,
  clusterSubscriptions?: Cluster,
): NaclacProvider {
  // gill's createSolanaClient accepts a moniker ("devnet", "mainnet", "localnet")
  // or a full HTTPS URL. Map "testnet" manually since gill may not recognise it.
  const urlOrMoniker =
    cluster === "testnet" ? "https://api.testnet.solana.com" : cluster;

  const {
    rpc,
    rpcSubscriptions: defaultSubscriptions,
    sendAndConfirmTransaction,
  } = createSolanaClient({
    urlOrMoniker,
  });

  const rpcSubscriptions = clusterSubscriptions
    ? createSolanaRpcSubscriptions(clusterSubscriptions)
    : defaultSubscriptions;

  return {
    rpc: rpc as any,
    rpcSubscriptions: rpcSubscriptions as any,
    signer,
    commitment: "confirmed",
    _sendAndConfirm: sendAndConfirmTransaction as any,
    getBalance: async (addr: string | Address) => {
      const res = await rpc.getAccountInfo(address(addr as string), { commitment: "confirmed" }).send();
      return res.value?.lamports ?? 0n;
    },
    getTokenBalance: async (addr: string | Address) => {
      const res = await (rpc as any).getTokenAccountBalance(address(addr as string)).send();
      return Number(res.value.amount) / Math.pow(10, res.value.decimals);
    }
  };
}

/**
 * Safely loads a local keypair file (Node.js only).
 * Prevents Webpack/Vite from crashing in frontend React apps.
 */
export async function loadNodeWallet(path?: string) {
  let fs: any, os: any;
  try {
    fs = require("fs");
    os = require("os");
  } catch (e) {
    throw new Error("[Naclac] loadNodeWallet can only be used in Node.js environments.");
  }
  const defaultPath = `${os.homedir()}/.config/solana/id.json`;
  const keypairBytes = new Uint8Array(JSON.parse(fs.readFileSync(path ?? defaultPath, "utf8")));
  return createKeyPairSignerFromBytes(keypairBytes);
}

/**
 * Transfers SOL from the provider signer to a destination address.
 */
export async function transferSol(
  provider: NaclacProvider,
  to: Address | string,
  lamports: bigint | number
): Promise<void> {
  const toAddress = address(to as string);
  const amount = BigInt(lamports);

  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, amount, true);

  const instruction = {
    programAddress: SYSTEM_PROGRAM_ID,
    accounts: [
      { address: provider.signer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: toAddress, role: AccountRole.WRITABLE },
    ],
    data,
  };

  const { value: latestBlockhash } = await (provider.rpc as any)
    .getLatestBlockhash({ commitment: provider.commitment ?? "confirmed" })
    .send();

  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayerSigner(provider.signer, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstruction(instruction, msg)
  );

  const signedTx = await signTransactionMessageWithSigners(txMessage);

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc: provider.rpc as any,
    rpcSubscriptions: provider.rpcSubscriptions as any,
  });

  await sendAndConfirm(signedTx as any, {
    commitment: provider.commitment ?? "confirmed",
  });
}