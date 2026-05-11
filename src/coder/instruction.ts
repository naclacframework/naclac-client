import type { IdlInstruction } from "../idl";
import { getIdlCodec } from "./types";

/**
 * Serializes the arguments for a single instruction into a Uint8Array.
 *
 * Layout: [ discriminator (8 bytes) | arg0 | arg1 | ... ]
 *
 * The 8-byte discriminator is read directly from the IDL (pre-computed by
 * build.rs using sha256("global:<name>")[..8]) — no runtime hashing needed.
 *
 * @param instruction - The full IDL instruction object.
 * @param args        - A key-value map of argument names to their values.
 * @returns           A Uint8Array ready to be used as instruction data.
 */
export function encodeInstructionData(
  instruction: IdlInstruction,
  args: Record<string, unknown>
): Uint8Array {
  const discriminator = new Uint8Array(instruction.discriminator);

  if (instruction.args.length === 0) {
    return discriminator;
  }

  const encodedArgs: Uint8Array[] = instruction.args.map((argDef) => {
    const value = args[argDef.name];
    if (value === undefined) {
      throw new Error(
        `[Naclac] Missing argument "${argDef.name}" for instruction "${instruction.name}". ` +
        `Expected arguments: [${instruction.args.map((a) => a.name).join(", ")}].`
      );
    }
    const codec = getIdlCodec(argDef.type);
    return codec.encode(value);
  });

  const totalLength =
    discriminator.length +
    encodedArgs.reduce((sum, buf) => sum + buf.length, 0);

  const data = new Uint8Array(totalLength);
  let offset = 0;

  data.set(discriminator, offset);
  offset += discriminator.length;

  for (const encoded of encodedArgs) {
    data.set(encoded, offset);
    offset += encoded.length;
  }

  return data;
}

/**
 * Decodes raw on-chain account bytes for a named account type.
 * Skips the leading 8-byte discriminator and deserializes field by field.
 *
 * @param fields - The IDL field definitions for the account type.
 * @param data   - Raw bytes from the RPC (the full account data, excluding length prefix).
 * @returns      A plain object with decoded field values.
 */
export function decodeAccountData(
  fields: readonly { name: string; type: string }[],
  data: Uint8Array
): Record<string, unknown> {
  let offset = 8;
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    const codec = getIdlCodec(field.type);
    const [value, newOffset] = codec.read(data, offset);
    result[field.name] = value;
    offset = newOffset;
  }

  return result;
}
