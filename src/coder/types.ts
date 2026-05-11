import {
  getU8Codec,
  getU16Codec,
  getU32Codec,
  getU64Codec,
  getU128Codec,
  getI8Codec,
  getI16Codec,
  getI32Codec,
  getI64Codec,
  getI128Codec,
  getF32Codec,
  getF64Codec,
  getBooleanCodec,
  getUtf8Codec,
  getBytesCodec,
  addCodecSizePrefix,
  getArrayCodec,
  getOptionCodec,
} from "@solana/codecs";
import { getAddressCodec } from "@solana/kit";

/** A minimal interface for any codec from @solana/codecs / @solana/kit. */
export interface NaclacCodec {
  encode: (value: unknown) => Uint8Array | Readonly<Uint8Array> | (Uint8Array & Readonly<Uint8Array>);
  decode: (bytes: Uint8Array | Readonly<Uint8Array> | (Uint8Array & Readonly<Uint8Array>)) => unknown;
  read: (bytes: Uint8Array | Readonly<Uint8Array> | (Uint8Array & Readonly<Uint8Array>), offset: number) => [unknown, number];
}

/**
 * Maps an IDL type string (as emitted by build.rs) to its corresponding
 * @solana/codecs codec. Throws a descriptive error for unmapped types.
 *
 * Supported primitives: u8, u16, u32, u64, u128, i8, i16, i32, i64, i128,
 *                       f32, f64, bool, string, publicKey, bytes
 */
export function getIdlCodec(type: any): NaclacCodec {
  if (typeof type === "string") {
    switch (type) {
      case "u8":
        return getU8Codec() as unknown as NaclacCodec;
      case "u16":
        return getU16Codec() as unknown as NaclacCodec;
      case "u32":
        return getU32Codec() as unknown as NaclacCodec;
      case "u64":
        return getU64Codec() as unknown as NaclacCodec;
      case "u128":
        return getU128Codec() as unknown as NaclacCodec;
      case "i8":
        return getI8Codec() as unknown as NaclacCodec;
      case "i16":
        return getI16Codec() as unknown as NaclacCodec;
      case "i32":
        return getI32Codec() as unknown as NaclacCodec;
      case "i64":
        return getI64Codec() as unknown as NaclacCodec;
      case "i128":
        return getI128Codec() as unknown as NaclacCodec;
      case "f32":
        return getF32Codec() as unknown as NaclacCodec;
      case "f64":
        return getF64Codec() as unknown as NaclacCodec;
      case "bool":
        return getBooleanCodec() as unknown as NaclacCodec;
      case "string":
      case "String":
        // Borsh dynamic string: 4-byte LE length prefix + UTF-8 bytes
        return addCodecSizePrefix(getUtf8Codec(), getU32Codec()) as unknown as NaclacCodec;
      case "publicKey":
        return getAddressCodec() as unknown as NaclacCodec;
      case "bytes":
        return getBytesCodec() as unknown as NaclacCodec;
      default:
        throw new Error(
          `[Naclac] Unknown IDL type "${type}". ` +
          `Supported types: u8, u16, u32, u64, u128, i8, i16, i32, i64, i128, ` +
          `f32, f64, bool, string, publicKey, bytes.`
        );
    }
  }

  if (typeof type === "object" && type !== null) {
    if ("array" in type) {
      const [innerType, size] = type.array;

      // Special case: [u8; N] — support plain string input with auto-padding
      if (innerType === "u8" && typeof size === "number") {
        const innerCodec = getIdlCodec(innerType) as any;
        const rawCodec = getArrayCodec(innerCodec, { size }) as unknown as NaclacCodec;
        return {
          encode: (value: unknown) => {
            if (typeof value === "string") {
              // Auto-pad / truncate string to fixed size, space-padded
              const buf = new Uint8Array(size);
              const encoded = new TextEncoder().encode(value);
              buf.set(encoded.slice(0, size));
              return buf;
            }
            return rawCodec.encode(value);
          },
          decode: rawCodec.decode,
          read: rawCodec.read,
        };
      }

      return getArrayCodec(getIdlCodec(innerType) as any, { size }) as unknown as NaclacCodec;
    }
    if ("vec" in type) {
      const innerType = type.vec;
      return addCodecSizePrefix(getArrayCodec(getIdlCodec(innerType) as any), getU32Codec()) as unknown as NaclacCodec;
    }
    if ("option" in type) {
      const innerType = type.option;
      return getOptionCodec(getIdlCodec(innerType) as any, { prefix: getU8Codec() }) as unknown as NaclacCodec;
    }
    if ("defined" in type) {
      return getU8Codec() as unknown as NaclacCodec;
    }
  }

  throw new Error(`[Naclac] Unknown IDL type "${JSON.stringify(type)}". Supported types include primitives, array, vec, option.`);
}
