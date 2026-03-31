import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import type { Chain } from "viem";
import { epixMainnet } from "./chain";

/** Create a wagmi config for the given chain. */
export function createWagmiConfig(chain: Chain) {
  return getDefaultConfig({
    appName: "xID - EpixChain Identity",
    projectId: "xid-testing-ui",
    chains: [chain],
    ssr: false,
  });
}

/** Static default — used by dev mode. */
export const config = createWagmiConfig(epixMainnet);
