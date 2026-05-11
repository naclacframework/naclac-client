/**
 * Pads a string with spaces (or a custom character) to a specific length.
 * Useful for fixed-size Rust byte arrays (e.g. `[u8; 32]`).
 */
export function padString(
  str: string,
  length: number = 32,
  padChar: string = " ",
): Uint8Array {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str.padEnd(length, padChar));
  if (bytes.length > length) {
    return bytes.slice(0, length);
  }
  return bytes;
}

/**
 * Converts a BigInt (or number) to a little-endian Uint8Array of a specific length.
 * Defaults to 8 bytes (u64).
 */
export function toLeBytes(
  num: bigint | number,
  length: number = 8,
): Uint8Array {
  const buffer = new Uint8Array(length);
  const view = new DataView(buffer.buffer);
  const val = BigInt(num);

  if (length === 8) {
    view.setBigUint64(0, val, true);
  } else if (length === 4) {
    view.setUint32(0, Number(val), true);
  } else if (length === 2) {
    view.setUint16(0, Number(val), true);
  } else if (length === 1) {
    view.setUint8(0, Number(val));
  } else {
    throw new Error(`[Naclac] Unsupported LE bytes length: ${length}`);
  }
  return buffer;
}

/**
 * Retries an async function up to a certain number of times with a delay between attempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number; actionName?: string } = {},
): Promise<T> {
  const retries = opts.retries ?? 5;
  const delayMs = opts.delayMs ?? 2000;
  const actionName = opts.actionName ?? "Action";

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i === retries - 1) throw e;
      console.warn(
        `[Naclac] ${actionName} failed (Attempt ${i + 1}/${retries}). Retrying in ${delayMs / 1000}s... Error: ${e.message}`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("[Naclac] Unreachable retry state");
}

/**
 * A simple promise-based delay helper.
 */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * High-quality error logger that extracts and formats Solana transaction logs.
 */
export function logError(e: any) {
  console.error("\n💥 TRANSACTION ERROR 💥");
  // Try to find logs in various common Solana error structures
  const logs =
    e.cause?.context?.logs ||
    e.context?.logs ||
    (e.message?.includes("logs:") ? e.message : null);

  if (logs && Array.isArray(logs)) {
    console.error("LOGS:\n" + logs.join("\n"));
  } else if (logs) {
    console.error("LOGS: " + logs);
  } else {
    // If no logs, print cause or message
    console.error("MESSAGE: " + (e.cause?.message || e.message || e));
  }
  throw e;
}
