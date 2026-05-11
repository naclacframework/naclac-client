/**
 * @naclac/client — Coder Unit Tests
 *
 * Verifies that byte-packing in encodeInstructionData EXACTLY matches
 * the discriminators and argument layout expected by the Rust backend.
 *
 * Run: pnpm test
 */

import { strict as assert } from "assert";
import { encodeInstructionData, decodeAccountData } from "../src/coder/instruction";
import type { IdlInstruction } from "../src/idl";

// ─────────────────────────────────────────────────────────────────────────────
// IDL fixtures (mirrored from counter_test.json)
// ─────────────────────────────────────────────────────────────────────────────

const initializeIx: IdlInstruction = {
  name: "initialize",
  discriminator: [175, 175, 109, 31, 13, 152, 155, 237],
  accounts: [
    { name: "payer", isMut: true, isSigner: true },
    { name: "counterAccount", isMut: true, isSigner: false, pda: {
      seeds: [{ kind: "const", value: [99, 111, 117, 110, 116, 101, 114, 95, 118, 50] }]
    }},
    { name: "systemProgram", isMut: false, isSigner: false },
  ],
  args: [],
};

const incrementIx: IdlInstruction = {
  name: "increment",
  discriminator: [11, 18, 104, 9, 104, 174, 59, 33],
  accounts: [
    { name: "authority", isMut: false, isSigner: true },
    { name: "counterAccount", isMut: true, isSigner: false, pda: {
      seeds: [
        { kind: "const", value: [99, 111, 117, 110, 116, 101, 114, 95, 118, 50] },
        { kind: "arg", path: "bump" },
      ]
    }},
  ],
  args: [{ name: "bump", type: "u8" }],
};

const closeIx: IdlInstruction = {
  name: "close",
  discriminator: [98, 165, 201, 177, 108, 65, 206, 96],
  accounts: [],
  args: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("encodeInstructionData", () => {
  it("initialize — no args: output is exactly the 8-byte discriminator", () => {
    const result = encodeInstructionData(initializeIx, {});
    assert.equal(result.length, 8, "Should be exactly 8 bytes");
    assert.deepEqual(
      Array.from(result),
      [175, 175, 109, 31, 13, 152, 155, 237],
      "Discriminator bytes must match the IDL exactly"
    );
  });

  it("increment — with u8 bump arg: output is 8 + 1 = 9 bytes", () => {
    const result = encodeInstructionData(incrementIx, { bump: 254 });
    assert.equal(result.length, 9, "Should be 8 (discriminator) + 1 (u8 bump) = 9 bytes");

    // First 8 bytes must be the discriminator
    assert.deepEqual(
      Array.from(result.slice(0, 8)),
      [11, 18, 104, 9, 104, 174, 59, 33],
      "Discriminator bytes must match"
    );

    // Byte 9 must be the bump value (254 = 0xFE)
    assert.equal(result[8], 254, "u8 bump should encode to a single byte with value 254");
  });

  it("increment — bump 0: should encode as a single 0x00 byte", () => {
    const result = encodeInstructionData(incrementIx, { bump: 0 });
    assert.equal(result[8], 0, "bump=0 should encode as 0x00");
  });

  it("close — no args, no accounts: output only the discriminator", () => {
    const result = encodeInstructionData(closeIx, {});
    assert.deepEqual(
      Array.from(result),
      [98, 165, 201, 177, 108, 65, 206, 96]
    );
  });

  it("increment — missing arg throws a descriptive error", () => {
    assert.throws(
      () => encodeInstructionData(incrementIx, {}),
      /Missing argument "bump"/,
      "Should throw a descriptive error for missing args"
    );
  });
});

describe("decodeAccountData", () => {
  it("should decode a Counter account correctly (skip 8-byte discriminator)", () => {
    /**
     * Layout: [disc(8)] [authority: publicKey(32)] [count: u64(8)]
     *
     * We'll use a zeroed-out authority and count=42n.
     */
    const disc     = new Uint8Array(8).fill(0xAB);
    const authority = new Uint8Array(32).fill(0); // all-zero public key
    const countBuf  = new Uint8Array(8);

    // Write count=42 as little-endian u64
    const view = new DataView(countBuf.buffer);
    view.setBigUint64(0, 42n, true /* little-endian */);

    const raw = new Uint8Array([...disc, ...authority, ...countBuf]);

    const fields = [
      { name: "authority", type: "publicKey" },
      { name: "count",     type: "u64" },
    ];

    const decoded = decodeAccountData(fields, raw);

    assert.ok(decoded.authority !== undefined, "authority should be present");
    assert.equal(decoded.count, 42n, "count should decode to BigInt 42n");
  });
});
