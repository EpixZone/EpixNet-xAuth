import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { epixFrame } from "../config/epixframe";
import { REST_API } from "../config/chain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EpixNetState {
  /** "dark" or "light" — sourced from EpixNet user settings. */
  theme: "dark" | "light";
  /** Language code from EpixNet (e.g. "en", "hu"). */
  language: string;
  /** EVM RPC URL override from EpixNet config, or null for default. */
  rpcUrl: string | null;
  /** Cosmos REST API URL override, or null for default. */
  restApi: string;
  /** The visiting user's EpixNet auth address (Bitcoin-style public key address). */
  authAddress: string | null;
  /** True once EpixNet settings have been loaded (or immediately if not embedded). */
  ready: boolean;
}

const defaults: EpixNetState = {
  theme: "dark",
  language: "en",
  rpcUrl: null,
  restApi: REST_API,
  authAddress: null,
  ready: false,
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const EpixNetContext = createContext<EpixNetState>({ ...defaults, ready: true });

export function useEpixNet() {
  return useContext(EpixNetContext);
}

/** Shortcut: returns the REST API base URL (from EpixNet config or default). */
export function useRestApi() {
  return useContext(EpixNetContext).restApi;
}

/** Shortcut: returns the visiting user's EpixNet auth address, or null. */
export function useAuthAddress() {
  return useContext(EpixNetContext).authAddress;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function EpixNetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EpixNetState>(() => {
    // If not inside EpixNet, resolve immediately with defaults
    if (!epixFrame.isEmbedded) return { ...defaults, ready: true };
    return defaults;
  });

  useEffect(() => {
    if (!epixFrame.isEmbedded) return;

    let cancelled = false;

    Promise.all([
      epixFrame.getServerInfo().catch(() => null),
      epixFrame.getConfigList().catch(() => null),
      epixFrame.getSiteInfo().catch(() => null),
    ]).then(([serverInfo, configList, siteInfo]) => {
      if (cancelled) return;

      // -- Theme ----------------------------------------------------------
      const userTheme =
        (serverInfo?.user_settings?.theme as string) ?? "dark";
      const theme: "dark" | "light" =
        userTheme === "light" ? "light" : "dark";

      // -- Language -------------------------------------------------------
      const language = serverInfo?.language || "en";

      // -- RPC URL --------------------------------------------------------
      const rpcCfg = configList?.chain_rpc_url;
      const rpcUrl =
        rpcCfg && typeof rpcCfg.value === "string" && rpcCfg.value
          ? rpcCfg.value
          : null;

      // -- REST API -------------------------------------------------------
      // Derive a Epix Chain REST endpoint from the EVM RPC if available.
      // Convention: replace "evmrpc" with "api" in the hostname.
      let restApi = REST_API;
      if (rpcUrl) {
        try {
          const u = new URL(rpcUrl);
          u.hostname = u.hostname.replace("evmrpc", "api");
          u.pathname = "/";
          restApi = u.origin;
        } catch {
          // keep default
        }
      }

      // -- Auth Address ---------------------------------------------------
      const authAddress = siteInfo?.auth_address || null;

      setState({ theme, language, rpcUrl, restApi, authAddress, ready: true });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <EpixNetContext.Provider value={state}>{children}</EpixNetContext.Provider>
  );
}
