import {
  address,
  AccountRole,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getBase58Decoder } from "@solana/codecs";
import type {
  Address,
  AccountMeta,
  AccountSignerMeta,
  TransactionSigner,
  Instruction,
  Blockhash,
} from "@solana/kit";

import type { NaclacProvider } from "./provider";
import type { NaclacIdl, IdlInstruction } from "./idl";
import { encodeInstructionData } from "./coder/instruction";
import { resolvePdas } from "./utils/pda";
import { translateRpcError } from "./utils/rpc";
import {
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  SYSVAR_RENT_PUBKEY,
} from "./constants";

/**
 * MethodsBuilder — the fluent instruction pipeline.
 *
 * Usage:
 *   await program.methods.initialize()
 *     .accounts({ payer: wallet.address })
 *     .rpc();
 *
 *   await program.methods.increment({ bump: 254 })
 *     .accounts({ authority: wallet.address })
 *     .rpc();
 */
export class MethodsBuilder {
  private readonly idl: NaclacIdl;
  private readonly ixDef: IdlInstruction;
  private readonly args: Record<string, unknown>;
  private readonly provider: NaclacProvider;
  private programId: Address;

  /** Accounts explicitly provided by the developer (non-PDA accounts). */
  private _userAccounts: Record<string, Address> = {};

  private _extraSigners: TransactionSigner[] = [];
  private _remainingAccounts: Address[] = [];
  private _preInstructions: Instruction<string>[] = [];
  private _postInstructions: Instruction<string>[] = [];

  constructor(
    idl: NaclacIdl,
    ixDef: IdlInstruction,
    args: Record<string, unknown>,
    provider: NaclacProvider,
  ) {
    this.idl = idl;
    this.ixDef = ixDef;
    this.args = args;
    this.provider = provider;
    this.programId = address(idl.address);
  }

  /**
   * Supply the account addresses for this instruction.
   * PDA accounts will be auto-resolved from IDL seeds — you only need
   * to provide the non-PDA accounts (signers, system program, etc.).
   *
   * @param accounts - A map of account name → base58 address.
   */
  accounts(accounts: Record<string, Address | string>): this {
    // Normalize all values to Address — accepts both typed Address and plain strings
    const normalized: Record<string, Address> = {};
    for (const [key, val] of Object.entries(accounts)) {
      normalized[key] = address(val as string);
    }
    this._userAccounts = { ...this._userAccounts, ...normalized };
    return this;
  }

  signers(signers: TransactionSigner[]): this {
    this._extraSigners.push(...signers);
    return this;
  }

  remainingAccounts(addresses: (Address | string)[]): this {
    this._remainingAccounts.push(...addresses.map((a) => address(a as string)));
    return this;
  }

  preInstructions(ixs: Instruction<string>[]): this {
    this._preInstructions.push(...ixs);
    return this;
  }

  postInstructions(ixs: Instruction<string>[]): this {
    this._postInstructions.push(...ixs);
    return this;
  }

  /**
   * Builds, signs, and sends the transaction. Returns the signature string.
   *
   * Execution order:
   *  1. Auto-resolve PDA accounts from IDL seeds.
   *  2. Encode instruction data (discriminator + args).
   *  3. Map accounts → AccountMeta array (isSigner / isMut from IDL).
   *  4. Create a v0 transaction message.
   *  5. Sign with provider.signer.
   *  6. Send and confirm at the configured commitment.
   */
  private async _buildInstructionMetasAndData() {
    const pdaAccounts = await resolvePdas(
      this.programId,
      this.ixDef,
      this.args,
      this._userAccounts,
    );

    const allAccounts: Record<string, Address> = {
      ...this._userAccounts,
      ...pdaAccounts,
    };

    const data = encodeInstructionData(this.ixDef, this.args);

    type AnyAccountMeta =
      | AccountMeta<Address>
      | AccountSignerMeta<Address, TransactionSigner<Address>>;

    const accountMetas: AnyAccountMeta[] = this.ixDef.accounts.map(
      (acctDef) => {
        let addr = allAccounts[acctDef.name];

        if (!addr) {
          // 1. Try to resolve from IDL hardcoded address
          if (acctDef.address) {
            addr = address(acctDef.address);
          }
          // 2. Fallback to name-based resolution for common system programs
          else {
            const nameLower = acctDef.name.toLowerCase();
            if (nameLower === "systemprogram") addr = SYSTEM_PROGRAM_ID;
            else if (nameLower === "tokenprogram") addr = TOKEN_PROGRAM_ID;
            else if (nameLower === "token2022program")
              addr = TOKEN_2022_PROGRAM_ID;
            else if (nameLower === "ataprogram") addr = ATA_PROGRAM_ID;
            else if (nameLower === "rent" || nameLower === "sysvarrent")
              addr = SYSVAR_RENT_PUBKEY;
          }
        }

        if (!addr) {
          throw new Error(
            `[Naclac] Account "${acctDef.name}" was not provided and could not be auto-resolved.`,
          );
        }

        // Normalize field names: JSON IDL uses "writable"/"signer", TS type uses "isMut"/"isSigner"
        const isWritable =
          (acctDef as any).writable ?? (acctDef as any).isMut ?? false;
        const isSigner =
          (acctDef as any).signer ?? (acctDef as any).isSigner ?? false;

        let role: AccountRole;
        if (isSigner && isWritable) role = AccountRole.WRITABLE_SIGNER;
        else if (isSigner) role = AccountRole.READONLY_SIGNER;
        else if (isWritable) role = AccountRole.WRITABLE;
        else role = AccountRole.READONLY;

        const extraSigner = this._extraSigners.find((s) => s.address === addr);
        if (
          extraSigner &&
          (role === AccountRole.WRITABLE_SIGNER ||
            role === AccountRole.READONLY_SIGNER)
        ) {
          return {
            address: extraSigner.address,
            signer: extraSigner,
            role,
          } as unknown as AccountSignerMeta<
            Address,
            TransactionSigner<Address>
          >;
        }

        return { address: addr, role } as AccountMeta<Address>;
      },
    );

    // Append dynamic remaining accounts (default to WRITABLE per Naclac convention)
    for (const addr of this._remainingAccounts) {
      accountMetas.push({
        address: addr,
        role: AccountRole.WRITABLE,
      } as AccountMeta<Address>);
    }

    return { data, accountMetas };
  }

  async transaction() {
    const commitment = this.provider.commitment ?? "confirmed";

    const { data, accountMetas } = await this._buildInstructionMetasAndData();

    const instruction: Instruction<string> = {
      programAddress: this.programId,
      accounts: accountMetas as any,
      data,
    };

    const allInstructions = [
      ...this._preInstructions,
      instruction,
      ...this._postInstructions,
    ];

    const rpc = this.provider.rpc as any;

    const { value: latestBlockhash } = await rpc
      .getLatestBlockhash({ commitment })
      .send();

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayerSigner(this.provider.signer, msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            ...latestBlockhash,
            blockhash: latestBlockhash.blockhash as unknown as Blockhash,
          },
          msg,
        ),
      (msg) => appendTransactionMessageInstructions(allInstructions, msg),
    );

    return txMessage;
  }

  async simulate() {
    const txMessage = await this.transaction();
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const base64Tx = getBase64EncodedWireTransaction(signedTx as any);

    try {
      const response = await (this.provider.rpc as any)
        .simulateTransaction(base64Tx, { encoding: "base64" })
        .send();

      if (response.value.err) {
        const simError = new Error("Transaction simulation failed");
        (simError as any).context = { logs: response.value.logs };
        throw simError;
      }

      return response.value;
    } catch (err: any) {
      translateRpcError(err, this.idl.errors, this.ixDef.accounts);
    }
  }

  /**
   * Builds the instruction object.
   * Alias for Anchor's .instruction() / .buildInstruction().
   */
  async instruction(): Promise<Instruction<string>> {
    return this.buildInstruction();
  }

  /**
   * Resolves all account addresses for this instruction (signers, PDAs, etc.).
   * Useful for debugging or manual transaction assembly.
   */
  async pubkeys(): Promise<Record<string, Address>> {
    const { accountMetas } = await this._buildInstructionMetasAndData();
    const result: Record<string, Address> = {};
    this.ixDef.accounts.forEach((acct, i) => {
      result[acct.name] = accountMetas[i].address;
    });
    return result;
  }

  /**
   * Signs the transaction and returns the base64-encoded wire transaction.
   */
  async encoded(): Promise<string> {
    const txMessage = await this.transaction();
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    return getBase64EncodedWireTransaction(signedTx as any);
  }

  /**
   * Signs and sends the transaction without waiting for confirmation.
   * Equivalent to Anchor's .send().
   */
  async send(options: { skipPreflight?: boolean } = {}): Promise<string> {
    const commitment = this.provider.commitment ?? "confirmed";
    const txMessage = await this.transaction();
    const signedTx = await signTransactionMessageWithSigners(txMessage);

    const rpc = this.provider.rpc as any;
    const base64Tx = getBase64EncodedWireTransaction(signedTx as any);

    try {
      const response = await rpc
        .sendTransaction(base64Tx, {
          encoding: "base64",
          preflightCommitment: commitment,
          skipPreflight: options.skipPreflight ?? false,
        })
        .send();
      return response;
    } catch (err: any) {
      translateRpcError(err, this.idl.errors, this.ixDef.accounts);
      throw err;
    }
  }

  /**
   * Sends the transaction to a specific RPC URL (e.g. TEE / Rollup endpoint).
   * Automatically handles signing and base64 encoding.
   *
   * @param url - The custom RPC URL (can include tokens).
   * @param opts - Options including wait for confirmation.
   */
  async sendTo(
    url: string,
    opts: { confirm?: boolean; timeoutMs?: number } = {},
  ): Promise<string> {
    const base64Tx = await this.encoded();

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [base64Tx, { encoding: "base64", skipPreflight: true }],
      }),
    });

    const data = (await response.json()) as any;
    if (data.error) {
      const err = new Error(
        `[Naclac] Remote RPC error: ${JSON.stringify(data.error)}`,
      );
      throw err;
    }

    const signature = data.result as string;

    if (opts.confirm) {
      const deadline = Date.now() + (opts.timeoutMs ?? 30000);
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        const statusRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getSignatureStatuses",
            params: [[signature], { searchTransactionHistory: true }],
          }),
        });
        const statusData = (await statusRes.json()) as any;
        const status = statusData?.result?.value?.[0];

        if (status?.err) {
          const err = new Error(
            `[Naclac] tx failed on-chain: ${JSON.stringify(status.err)} | sig: ${signature}`,
          );
          translateRpcError(err, this.idl.errors, this.ixDef.accounts);
          throw err;
        }
        if (
          status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized"
        ) {
          return signature;
        }
      }
      throw new Error(
        `[Naclac] Transaction confirmation timed out after ${opts.timeoutMs ?? 30000}ms`,
      );
    }

    return signature;
  }

  async rpc(): Promise<string> {
    const commitment = this.provider.commitment ?? "confirmed";
    const txMessage = await this.transaction();

    const signedTx = await signTransactionMessageWithSigners(txMessage);

    const rpc = this.provider.rpc as any;
    const rpcSubscriptions = this.provider.rpcSubscriptions as any;
    const sendAndConfirm = sendAndConfirmTransactionFactory({
      rpc,
      rpcSubscriptions,
    });

    try {
      await sendAndConfirm(signedTx as any, { commitment });
    } catch (err: any) {
      translateRpcError(err, this.idl.errors, this.ixDef.accounts);
      throw err; // Ensure we re-throw after translation
    }

    const signatureMap = (
      signedTx as { signatures: Record<string, Uint8Array | null> }
    ).signatures;
    const signatures = Object.values(signatureMap).filter(
      (sig): sig is Uint8Array => sig !== null,
    );

    const sig = signatures[0];
    return sig ? getBase58Decoder().decode(sig) : "(no signature)";
  }

  async buildInstruction(): Promise<Instruction<string>> {
    const { data, accountMetas } = await this._buildInstructionMetasAndData();
    return {
      programAddress: this.programId,
      accounts: accountMetas as any,
      data,
    };
  }
}
