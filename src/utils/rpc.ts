import type { Address, Rpc, Commitment } from "@solana/kit";

const NATIVE_SOLANA_ERRORS: Record<string, string> = {
  "0x0": "Generic Instruction Error / Invalid Account Data",
  "0x1": "Insufficient Funds (Not enough SOL to pay for transaction or rent)",
  "0x2": "Invalid Account Data Format",
  "0x3": "Missing Required Signature",
  "0x4": "Account Data Too Small",
  "0x5": "Insufficient Funds For Rent",
  "0xbb8": "Account Already Initialized",
  "0xbbf": "Account Not Initialized",
};

const NACLAC_FRAMEWORK_ERROR_TYPES: Record<number, string> = {
  1: "Mutability mismatch",
  2: "Missing required signature",
  3: "Address mismatch",
  4: "Owner mismatch",
  5: "Account is not rent exempt",
  6: "PDA derivation failed (Seeds mismatch)",
  7: "Account is not executable",
  8: "Account is None (Expected initialized account)",
  9: "HasOne constraint failed",
  10: "Program ID mismatch (Missing required program in accounts array)",
  11: "Account data too small (Missing discriminator or insufficient size)",
  12: "Account borrow failed (Already borrowed)",
  13: "Invalid instruction data",
  14: "Insufficient funds for transaction",
  15: "Account already initialized",
  16: "Account not initialized",
  17: "Not enough account keys provided",
  18: "Max seed length exceeded",
  19: "Unsupported sysvar",
  20: "Invalid reallocation",
  21: "Arithmetic overflow",
  22: "Unauthorized access (Authority mismatch)",
  23: "Account type mismatch (Invalid discriminator)",
  24: "Account deserialization failed",
  25: "Account serialization failed",
};

/** A decoded program error from the IDL. */
export interface NaclacProgramError {
  code: number;
  name: string;
  msg?: string;
}

/**
 * Intercepts a raw @solana/kit RPC error and enriches it with human-readable
 * program error info from the IDL's errors array.
 *
 * If the error contains a Solana program custom error code of the form
 * "Custom program error: 0x1770" (where 0x1770 = 6000), it looks up the
 * matching entry in `idlErrors` and throws a new, enriched error.
 *
 * @param err       - The raw error thrown by the RPC.
 * @param idlErrors - The errors array from the IDL.
 */
export function translateRpcError(
  err: any,
  idlErrors: readonly { code: number; name: string; msg?: string }[],
  ixAccounts?: readonly { name: string }[],
): never {
  let currentErr = err;
  let combinedLogsAndMessages = "";
  const errorChainMessages: string[] = [];

  while (currentErr) {
    if (
      currentErr.message &&
      !errorChainMessages.includes(currentErr.message)
    ) {
      errorChainMessages.push(currentErr.message);
      combinedLogsAndMessages += currentErr.message + "\n";
    }

    if (currentErr.context?.logs && Array.isArray(currentErr.context.logs)) {
      combinedLogsAndMessages += currentErr.context.logs.join("\n") + "\n";
    }
    if (currentErr.logs && Array.isArray(currentErr.logs)) {
      combinedLogsAndMessages += currentErr.logs.join("\n") + "\n";
    }

    currentErr = currentErr.cause;
  }

  const hexMatch = combinedLogsAndMessages.match(
    /(?:(?:custom)? program error:|InstructionError(?:.*)?)\s*(0x[0-9a-fA-F]+)/i,
  );

  if (hexMatch) {
    const hexString = hexMatch[1].toLowerCase();
    const errorCode = parseInt(hexString, 16);

    const idlError = idlErrors.find((e) => e.code === errorCode);
    if (idlError) {
      const enriched = new Error(
        `[Naclac] Program error "${idlError.name}" (code ${idlError.code}): ${
          idlError.msg ?? "(no message)"
        }`,
      );
      enriched.cause = err; // Preserve the original error stack
      throw enriched;
    }

    const strippedHex = hexString.replace("0x", "");
    const normalizedKey = "0x" + parseInt(strippedHex, 16).toString(16);

    const nativeMsg = NATIVE_SOLANA_ERRORS[normalizedKey];
    if (nativeMsg) {
      const enriched = new Error(
        `[Naclac] Solana System Error: ${nativeMsg} (code ${normalizedKey})`,
      );
      enriched.cause = err;
      throw enriched;
    }

    // 3. Try to resolve from Naclac Framework Errors (Range 3000 - 3999)
    if (errorCode >= 3000 && errorCode < 4000) {
      const offset = errorCode - 3000;
      const errorType = offset % 100;
      const accountIndex = Math.floor(offset / 100);

      const typeName =
        NACLAC_FRAMEWORK_ERROR_TYPES[errorType] ?? "Unknown framework error";
      const accountName =
        ixAccounts?.[accountIndex]?.name ?? `Index ${accountIndex}`;

      const enriched = new Error(
        `[Naclac] Framework Error: ${typeName} for account "${accountName}" (code ${errorCode})`,
      );
      enriched.cause = err;
      throw enriched;
    }
  }

  // 4. Try to match decimal "Custom" codes (e.g. from TEE or JSON status)
  const decimalMatch = combinedLogsAndMessages.match(/"Custom":\s*(\d+)/i);
  if (decimalMatch) {
    const errorCode = parseInt(decimalMatch[1], 10);
    const idlError = idlErrors.find((e) => e.code === errorCode);
    if (idlError) {
      const enriched = new Error(
        `[Naclac] Program error "${idlError.name}" (code ${idlError.code}): ${
          idlError.msg ?? "(no message)"
        }`,
      );
      enriched.cause = err;
      throw enriched;
    }
  }

  if (err instanceof Error && errorChainMessages.length > 1) {
    const deepMessage = errorChainMessages.join(" -> ");
    const enriched = new Error(deepMessage);
    enriched.cause = err.cause;
    if ((err as any).context) (enriched as any).context = (err as any).context;
    throw enriched;
  }

  throw err;
}

import type { NaclacRpc } from "../provider";

/**
 * Fetches a recent blockhash from the RPC at the given commitment.
 *
 * @param rpc        - The @solana/kit Rpc instance.
 * @param commitment - The desired commitment level.
 */
export async function getRecentBlockhash(
  rpc: NaclacRpc,
  commitment: Commitment = "confirmed",
): Promise<{ blockhash: string; lastValidBlockHeight: bigint }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = (await (rpc as any)
    .getLatestBlockhash({ commitment })
    .send()) as {
    value: { blockhash: string; lastValidBlockHeight: bigint };
  };
  return response.value;
}
