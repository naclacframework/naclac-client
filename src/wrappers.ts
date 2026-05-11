import { Address } from "gill";

/**
 * A binary-stable wrapper for boolean values.
 * In Naclac Zero-Copy, bool is stored as a u8 (1 or 0).
 */
export interface Bool {
  value: number;
}

/**
 * A binary-stable wrapper for Option<Pubkey>.
 * Layout: [32 bytes pubkey, 1 byte hasValue, 7 bytes padding]
 */
export interface OptPubkey {
  value: Address | string;
  hasValue: number;
  padding: number[] | Uint8Array;
}

/**
 * A binary-stable wrapper for Option<u64>.
 * Layout: [8 bytes value, 1 byte hasValue, 7 bytes padding]
 */
export interface OptU64 {
  value: bigint | number;
  hasValue: number;
  padding: number[] | Uint8Array;
}
