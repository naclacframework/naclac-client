import { sha256 } from "@noble/hashes/sha2.js";

export function getDiscriminator(namespace: string, name: string): Uint8Array {
  const bytes = new TextEncoder().encode(`${namespace}:${name}`);
  const hash = sha256(bytes);
  return hash.slice(0, 8);
}