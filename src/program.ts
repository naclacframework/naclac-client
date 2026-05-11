import type { NaclacIdl } from "./idl";
import type { NaclacProvider } from "./provider";
import { MethodsBuilder } from "./methods";
import { AccountFetcher } from "./account";
import { address, type Address } from "@solana/kit";
import { getBase64Encoder } from "@solana/codecs";
import { getDiscriminator } from "./utils/hash";
import { decodeAccountData } from "./coder/instruction";

import { resolvePdas } from "./utils/pda";

export type IdlInstructionName<T extends NaclacIdl> =
  T["instructions"][number]["name"];

export type IdlAccountName<T extends NaclacIdl> = T["accounts"][number]["name"];

/**
 * Program<TIdl> — the main entry point for every Naclac SDK.
 *
 * Instantiate it once with your IDL and a provider, then call methods and
 * fetch accounts with a fluent, Anchor-like API:
 *
 * ```ts
 * import * as naclac from "@naclac/client";
 * import { IDL } from "../target/types/counter_test";
 *
 * const program = new naclac.Program(IDL, provider);
 *
 * // Call an instruction
 * await program.methods
 *   .initialize()
 *   .accounts({ payer: wallet.address })
 *   .rpc();
 *
 * // Fetch an account
 * const counter = await program.account.Counter.fetch(pdaAddress);
 * console.log(counter.count); // → 1n
 * ```
 */
export class Program<TIdl extends NaclacIdl = NaclacIdl> {
  /** The parsed IDL — useful for reading metadata, errors, constants, etc. */
  readonly idl: TIdl;

  /** The provider — holds rpc, rpcSubscriptions, signer, and commitment. */
  readonly provider: NaclacProvider;

  /**
   * Dynamically built methods namespace.
   * Every instruction in the IDL is exposed as a function here.
   *
   * Example: program.methods.increment({ bump: 254 })
   */
  readonly methods: {
    [Name in IdlInstructionName<TIdl>]: (
      args?: Record<string, unknown>,
    ) => MethodsBuilder;
  };

  /**
   * Dynamically built account namespace.
   * Every account type in the IDL is exposed here with a `.fetch()` method.
   *
   * Example: program.account.Counter.fetch(address)
   */
  readonly account: {
    [Name in IdlAccountName<TIdl>]: AccountFetcher;
  };

  private _listenerIdCounter = 0;
  private _eventListeners: Map<number, AbortController> = new Map();

  /**
   * Access the program's constants as defined in the IDL.
   * Returns a map of constant names to their values.
   */
  get constants(): Record<string, any> {
    const constants: Record<string, any> = {};
    for (const c of this.idl.constants) {
      // Return the raw value from the IDL as-is
      constants[c.name] = c.value;
    }
    return constants;
  }

  /**
   * Derive a PDA for a given account name using the instruction definitions in the IDL.
   *
   * Accepts a flat `seeds` object whose keys match seed paths from the IDL.
   * Internally splits them into `args` and `accounts` maps as required by resolvePdas.
   *
   * @param accountName     - The camelCase name of the account in the IDL.
   * @param seeds           - Flat map of every seed value keyed by its IDL path.
   * @param instructionName - Optional: pin to a specific instruction's seed schema.
   */
  async pda(
    accountName: string,
    seeds: Record<string, any> = {},
    instructionName?: string,
  ): Promise<Address> {
    const tryResolve = async (ix: any): Promise<Address | null> => {
      const acct = ix.accounts.find(
        (a: any) => a.name === accountName && a.pda,
      );
      if (!acct) return null;

      const args: Record<string, unknown> = {};
      const accounts: Record<string, Address> = {};
      for (const seed of acct.pda.seeds as any[]) {
        const val = seeds[seed.path];
        if (val === undefined) continue;
        if (seed.kind === "account") {
          accounts[seed.path] = val as Address;
        } else if (seed.kind === "arg") {
          args[seed.path] = val;
        }
      }

      const resolved = await resolvePdas(
        address(this.idl.address),
        ix,
        args,
        accounts,
        accountName,
      );
      return resolved[accountName] ?? null;
    };

    if (instructionName) {
      const ix = (this.idl.instructions as any[]).find(
        (i) => i.name === instructionName,
      );
      if (ix) {
        const result = await tryResolve(ix);
        if (result) return result;
      }
    }

    for (const ix of this.idl.instructions as any[]) {
      const result = await tryResolve(ix);
      if (result) return result;
    }

    throw new Error(
      `[Naclac] No PDA definition found for account "${accountName}" in IDL instructions.`,
    );
  }

  /**
   * Fetches raw account info (including owner and lamports) for a given address.
   * Automatically uses base64 encoding and the provider's default commitment.
   *
   * @param address - The base58 or Address of the account to fetch.
   */
  async getAccountInfo(address: string | Address) {
    const { value } = await this.provider.rpc
      .getAccountInfo(address as Address, {
        commitment: this.provider.commitment ?? "confirmed",
        encoding: "base64",
      })
      .send();
    return value;
  }

  constructor(idl: TIdl, provider: NaclacProvider) {
    this.idl = idl;
    this.provider = provider;

    this.methods = {} as any;
    for (const ixDef of idl.instructions) {
      (this.methods as any)[ixDef.name] = (
        args: Record<string, unknown> = {},
      ) => {
        return new MethodsBuilder(idl, ixDef, args, provider);
      };
    }

    this.account = {} as any;
    for (const acctDef of idl.accounts) {
      (this.account as any)[acctDef.name] = new AccountFetcher(
        acctDef,
        provider,
        address(idl.address),
      );
    }
  }

  /**
   * Listens for an event emitted by the program on-chain.
   *
   * @param eventName The name of the event from the IDL
   * @param callback  Triggered when the event is emitted, passing the decoded event data
   * @returns         A numeric listener ID that can be used to stop listening
   */
  addEventListener(
    eventName: string,
    callback: (event: any, slot: number, signature: string) => void,
  ): number {
    const listenerId = this._listenerIdCounter++;
    const abortController = new AbortController();
    this._eventListeners.set(listenerId, abortController);

    const eventDef = this.idl.events?.find((e) => e.name === eventName);
    if (!eventDef) {
      throw new Error(`[Naclac] Event "${eventName}" not found in IDL.`);
    }

    const discriminator = getDiscriminator("event", eventName);
    const rpcSubscriptions = this.provider.rpcSubscriptions as any;
    const programId = address(this.idl.address);

    (async () => {
      try {
        const subscription = await rpcSubscriptions
          .logsSubscribe({ mentions: [programId] }, { commitment: "confirmed" })
          .subscribe({ abortSignal: abortController.signal });

        for await (const notification of subscription) {
          const logs = notification.value.logs;
          if (!logs) continue;

          for (const log of logs) {
            if (log.startsWith("Program data: ")) {
              const base64Data = log.replace("Program data: ", "").trim();
              const parts = base64Data.split(" ");
              const chunks = parts.map((p: string) =>
                getBase64Encoder().encode(p),
              );
              const totalLength = chunks.reduce(
                (acc: number, curr: Uint8Array) => acc + curr.length,
                0,
              );
              const rawBytes = new Uint8Array(totalLength);
              let offset = 0;
              for (const chunk of chunks) {
                rawBytes.set(chunk, offset);
                offset += chunk.length;
              }

              const match = rawBytes
                .slice(0, 8)
                .every((b, i) => b === discriminator[i]);
              if (!match) continue;

              const decoded = decodeAccountData(
                eventDef.fields as any,
                new Uint8Array(rawBytes),
              );
              callback(
                decoded,
                notification.context.slot,
                notification.value.signature,
              );
            }
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        console.error(
          `[Naclac] Subscription error for event ${eventName}:`,
          err,
        );
      }
    })();

    return listenerId;
  }

  /**
   * Stops listening for a previously registered event listener.
   *
   * @param listenerId The ID returned by `addEventListener`
   */
  removeEventListener(listenerId: number): void {
    const controller = this._eventListeners.get(listenerId);
    if (controller) {
      controller.abort();
      this._eventListeners.delete(listenerId);
    }
  }

  /**
   * Listens for a single occurrence of an event and returns a promise that
   * resolves when the event is emitted.
   *
   * @param eventName The name of the event from the IDL
   * @param options   Optional configuration, including timeoutMs (default: 10000ms)
   * @returns         A promise that resolves with the event data, or null if it times out
   */
  async waitForEvent<T = any>(
    eventName: string,
    options: { timeoutMs?: number } = {},
  ): Promise<T | null> {
    const timeoutMs = options.timeoutMs ?? 10000;
    return new Promise((resolve) => {
      let resolved = false;
      const listenerId = this.addEventListener(eventName, (event) => {
        if (!resolved) {
          resolved = true;
          this.removeEventListener(listenerId);
          resolve(event);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.removeEventListener(listenerId);
          resolve(null);
        }
      }, timeoutMs);
    });
  }
}
