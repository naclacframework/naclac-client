import type { Address } from "@solana/kit";
import { address } from "@solana/kit";
import { getBase58Decoder, getBase64Encoder } from "@solana/codecs";
import type { IdlAccountDef } from "./idl";
import type { NaclacProvider } from "./provider";
import { decodeAccountData } from "./coder/instruction";
import { getDiscriminator } from "./utils/hash";

/**
 * AccountFetcher — fetches and deserializes on-chain accounts.
 *
 * Usage:
 *   const counter = await program.account.Counter.fetch("AdArn...");
 *   console.log(counter.count); // → 42n
 */
export class AccountFetcher {
  private readonly accountDef: IdlAccountDef;
  private readonly provider: NaclacProvider;
  private readonly programId: Address;

  constructor(
    accountDef: IdlAccountDef,
    provider: NaclacProvider,
    programId: Address,
  ) {
    this.accountDef = accountDef;
    this.provider = provider;
    this.programId = programId;
  }

  /**
   * Fetches the account at `pubkey` and deserializes its data using the IDL
   * field definitions. Returns a plain object with camelCase field names.
   *
   * @param pubkey - The base58 address of the on-chain account.
   * @throws       If the account does not exist.
   */
  async fetch(pubkey: Address | string): Promise<Record<string, unknown>> {
    const addr = address(pubkey as string);
    const commitment = this.provider.commitment ?? "confirmed";

    const { value: accountInfo } = await (
      this.provider.rpc as {
        getAccountInfo: (
          addr: Address,
          opts?: { commitment: string; encoding: string },
        ) => {
          send: () => Promise<{ value: { data: [string, string] } | null }>;
        };
      }
    )
      .getAccountInfo(addr, { commitment, encoding: "base64" })
      .send();

    if (!accountInfo) {
      throw new Error(
        `[Naclac] Account "${pubkey}" does not exist on-chain (commitment: ${commitment}).`,
      );
    }

    const rawBase64 = (accountInfo.data as [string, string])[0];
    const rawBytes = new Uint8Array(
      atob(rawBase64)
        .split("")
        .map((c) => c.charCodeAt(0)),
    );

    return decodeAccountData(
      this.accountDef.type.fields,
      new Uint8Array(rawBytes),
    );
  }

  /**
   * Fetches multiple accounts in a single RPC call using getMultipleAccounts.
   *
   * @param pubkeys - An array of base58 addresses.
   * @param opts    - Options including `dropCorrupted` to skip units that fail to decode.
   * @returns       An array of decoded account objects (null if account not found/corrupted).
   */
  async fetchMultiple(
    pubkeys: Array<Address | string>,
    opts: { dropCorrupted?: boolean } = {}
  ): Promise<Array<Record<string, unknown> | null>> {
    const addrs = pubkeys.map((pk) => address(pk as string));
    const commitment = this.provider.commitment ?? "confirmed";

    const { value: accounts } = await (
      this.provider.rpc as {
        getMultipleAccounts: (
          addrs: Address[],
          opts?: { commitment: string; encoding: string },
        ) => {
          send: () => Promise<{
            value: Array<{ data: [string, string] } | null>;
          }>;
        };
      }
    )
      .getMultipleAccounts(addrs, { commitment, encoding: "base64" })
      .send();

    return accounts.map((acctInfo) => {
      if (!acctInfo) return null;
      try {
        const rawBase64 = (acctInfo.data as [string, string])[0];
        const rawBytes = getBase64Encoder().encode(rawBase64);
        return decodeAccountData(
          this.accountDef.type.fields,
          new Uint8Array(rawBytes),
        );
      } catch (err) {
        if (opts.dropCorrupted) {
          console.warn(`[Naclac] Dropping corrupted account:`, err);
          return null;
        }
        throw err;
      }
    });
  }

  /**
   * Fetches all on-chain accounts of this type using this program's RPC node.
   * Leverages getProgramAccounts with a memcmp filter on the 8-byte discriminator.
   *
   * @param opts - Options including `filters` for custom GPA filters and `dropCorrupted`.
   * @returns An array of objects containing the base58 publicKey and the decoded account.
   */
  async all(opts: { filters?: any[]; dropCorrupted?: boolean } = {}): Promise<
    Array<{ publicKey: Address; account: Record<string, unknown> }>
  > {
    const discriminator = getDiscriminator("account", this.accountDef.name);
    const base58Discriminator = getBase58Decoder().decode(discriminator);
    const commitment = this.provider.commitment ?? "confirmed";

    const filters = [
      { memcmp: { offset: 0, bytes: base58Discriminator } },
      ...(opts.filters ?? []),
    ];

    const raw = await (this.provider.rpc as any)
      .getProgramAccounts(this.programId, {
        commitment,
        encoding: "base64",
        filters,
      })
      .send();

    const accounts: any[] = Array.isArray(raw) ? raw : (raw?.value ?? []);

    const decoded = accounts.map((acctInfo: any) => {
      try {
        const rawBase64 = acctInfo.account.data[0];
        const rawBytes = getBase64Encoder().encode(rawBase64);
        const accountData = decodeAccountData(
          this.accountDef.type.fields,
          new Uint8Array(rawBytes),
        );
        return {
          publicKey: acctInfo.pubkey,
          account: accountData,
        };
      } catch (err) {
        if (opts.dropCorrupted) {
          console.warn(`[Naclac] Dropping corrupted account at ${acctInfo.pubkey}:`, err);
          return null;
        }
        throw err;
      }
    });

    return decoded.filter((d): d is { publicKey: Address; account: Record<string, unknown> } => d !== null);
  }
}
