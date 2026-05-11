export interface IdlSeedAta {
  readonly kind: "ata";
  readonly mint: string;
  readonly authority: string;
  readonly tokenProgram?: string;
}

/** A PDA seed — one of four kinds emitted by the Naclac Rust compiler. */
export type IdlSeed =
  | { readonly kind: "const"; readonly value: readonly number[] }
  | { readonly kind: "arg"; readonly path: string }
  | { readonly kind: "account"; readonly path: string }
  | IdlSeedAta;

/** PDA descriptor attached to an account in the IDL. */
export interface IdlPda {
  readonly seeds: readonly IdlSeed[];
}

/** A single account in an instruction's accounts array. */
export interface IdlAccount {
  name: string;
  // JSON IDL uses writable/signer; legacy TS type used isMut/isSigner — support both
  writable?: boolean;
  signer?: boolean;
  isMut?: boolean;
  isSigner?: boolean;
  pda?: IdlPda;
  address?: string;
}

/** A single field (arg or struct field). */
export interface IdlField {
  name: string;
  type: string;
}

/** A single instruction definition. */
export interface IdlInstruction {
  readonly name: string;
  readonly discriminator: readonly number[];
  readonly accounts: readonly IdlAccount[];
  readonly args: readonly IdlField[];
}

/** A named account type definition (component). */
export interface IdlAccountDef {
  name: string;
  readonly type: {
    readonly kind: string;
    readonly fields: readonly IdlField[];
  };
}

/** An event field in the IDL. */
export interface IdlEventField {
  name: string;
  type: string;
  index: boolean;
}

/** An event definition. */
export interface IdlEventDef {
  readonly name: string;
  readonly fields: readonly IdlEventField[];
}

/** An error definition. */
export interface IdlErrorDef {
  code: number;
  name: string;
  msg?: string;
}

/** A constant definition. */
export interface IdlConstant {
  name: string;
  type: string;
  value: string;
}

/** The root IDL object emitted by `naclac build`. */
export interface NaclacIdl {
  readonly address: string;
  readonly metadata: {
    readonly name: string;
    readonly version: string;
    readonly description: string;
  };
  readonly instructions: readonly IdlInstruction[];
  readonly accounts: readonly IdlAccountDef[];
  readonly events: readonly IdlEventDef[];
  readonly errors: readonly IdlErrorDef[];
  readonly constants: readonly IdlConstant[];
}
