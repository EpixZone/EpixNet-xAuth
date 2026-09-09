import { defineChain } from "viem";

const DEFAULT_RPC = "https://evmrpc.epix.zone/";

/** Create an EpixChain definition with an optional RPC override. */
export function createEpixChain(rpcUrl?: string) {
  return defineChain({
    id: 1916,
    name: "Epix",
    nativeCurrency: { name: "EPIX", symbol: "EPIX", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl || DEFAULT_RPC] },
    },
    blockExplorers: {
      default: { name: "EpixScan", url: "/epix1epxrwflutk4j2saxuy84wvv52tdepuep8yqcqk" },
    },
  });
}

/** Static default — used by dev mode and as import fallback. */
export const epixMainnet = createEpixChain();

export const REST_API = "https://api.epix.zone";
export const DEFAULT_TLD = "epix";

const EXPLORER_SITE = "/epix1epxrwflutk4j2saxuy84wvv52tdepuep8yqcqk";
export const explorerTxUrl = (hash: string) => `${EXPLORER_SITE}?tx=${hash}`;
export const explorerAccountUrl = (address: string) => `${EXPLORER_SITE}?account=${address}`;
