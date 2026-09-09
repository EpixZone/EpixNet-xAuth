import { bech32 } from "bech32";
import { isAddress } from "viem";

const BECH32_PREFIX = "epix";

export function evmToBech32(evmAddress: string): string {
  const hex = evmAddress.replace("0x", "");
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  const words = bech32.toWords(new Uint8Array(bytes));
  return bech32.encode(BECH32_PREFIX, words);
}

export function bech32ToEvm(bech32Addr: string): `0x${string}` {
  const { words } = bech32.decode(bech32Addr);
  const bytes = bech32.fromWords(words);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hex}`;
}

export function isBech32Address(addr: string): boolean {
  try {
    const { prefix, words } = bech32.decode(addr);
    return prefix === BECH32_PREFIX && bech32.fromWords(words).length === 20;
  } catch {
    return false;
  }
}

/** Accept either 0x… or epix1… and return a checksummed EVM address, or null if invalid. */
export function normalizeToEvmAddress(addr: string): `0x${string}` | null {
  const trimmed = addr.trim();
  if (isAddress(trimmed)) return trimmed;
  if (isBech32Address(trimmed)) return bech32ToEvm(trimmed);
  return null;
}

export function truncateAddress(addr: string, chars: number = 6): string {
  return `${addr.slice(0, chars + 2)}...${addr.slice(-chars)}`;
}
