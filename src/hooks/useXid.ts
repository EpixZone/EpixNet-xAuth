import { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount, useChains, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { createPublicClient, decodeErrorResult, encodeFunctionData, formatEther, http } from "viem";
import { XID_ADDRESS, XID_ABI, ZERO_ADDRESS } from "../config/contract";
import { DEFAULT_TLD, REST_API } from "../config/chain";
import { evmToBech32 } from "../config/bech32";

export function useResolve(name: string, tld: string = DEFAULT_TLD) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: XID_ADDRESS,
    abi: XID_ABI,
    functionName: "resolve",
    args: [name, tld],
    query: { enabled: !!name },
  });

  return {
    owner: data as `0x${string}` | undefined,
    isAvailable: data === ZERO_ADDRESS,
    isLoading,
    error,
    refetch,
  };
}

export function useReverseResolve(addr: `0x${string}` | undefined) {
  const { data, isLoading, error } = useReadContract({
    address: XID_ADDRESS,
    abi: XID_ABI,
    functionName: "reverseResolve",
    args: addr ? [addr] : undefined,
    query: { enabled: !!addr },
  });

  const result = data as [string, string] | undefined;
  return {
    name: result?.[0] || "",
    tld: result?.[1] || "",
    isLoading,
    error,
  };
}

export function useReverseResolveBech32(bech32Addr: string) {
  const { data, isLoading, error } = useReadContract({
    address: XID_ADDRESS,
    abi: XID_ABI,
    functionName: "reverseResolveBech32",
    args: [bech32Addr],
    query: { enabled: !!bech32Addr },
  });

  const result = data as [string, string] | undefined;
  return {
    name: result?.[0] || "",
    tld: result?.[1] || "",
    isLoading,
    error,
  };
}

export function usePrimaryName(addr: `0x${string}` | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: XID_ADDRESS,
    abi: XID_ABI,
    functionName: "getPrimaryName",
    args: addr ? [addr] : undefined,
    query: { enabled: !!addr },
  });

  const result = data as [string, string] | undefined;
  return {
    primaryName: result?.[0] || "",
    primaryTld: result?.[1] || "",
    isLoading,
    error,
    refetch,
  };
}

export function useRegistrationFee(name: string, tld: string = DEFAULT_TLD) {
  const { data, isLoading } = useReadContract({
    address: XID_ADDRESS,
    abi: XID_ABI,
    functionName: "getRegistrationFee",
    args: [name, tld],
    query: { enabled: !!name },
  });

  return {
    fee: data as bigint | undefined,
    feeFormatted: data ? formatEther(data as bigint) : "0",
    isLoading,
  };
}

export function useProfile(name: string, tld: string = DEFAULT_TLD) {
  const { data, isLoading, refetch } = useReadContract({
    address: XID_ADDRESS,
    abi: XID_ABI,
    functionName: "getProfile",
    args: [name, tld],
    query: { enabled: !!name },
  });

  const result = data as [string, string] | undefined;
  return {
    avatar: result?.[0] || "",
    bio: result?.[1] || "",
    isLoading,
    refetch,
  };
}

export function useLinkedIdentities(name: string, tld: string = DEFAULT_TLD) {
  const { data, isLoading, refetch } = useReadContract({
    address: XID_ADDRESS,
    abi: XID_ABI,
    functionName: "getLinkedIdentities",
    args: [name, tld],
    query: { enabled: !!name },
  });

  const result = data as [string[], string[], bigint[], boolean[], bigint[], bigint[]] | undefined;
  const peers = result
    ? result[0].map((addr, i) => ({
        address: addr,
        label: result[1][i],
        addedAt: result[2][i],
        active: result[3][i],
        revokedAt: result[4][i],
        revokedAtTime: result[5][i],
      }))
    : [];

  return { peers, isLoading, refetch };
}

export function useContentRoot(name: string, tld: string = DEFAULT_TLD) {
  const { data, isLoading } = useReadContract({
    address: XID_ADDRESS,
    abi: XID_ABI,
    functionName: "getContentRoot",
    args: [name, tld],
    query: { enabled: !!name },
  });

  const result = data as [string, bigint] | undefined;
  return {
    root: result?.[0] || "",
    updatedAt: result?.[1] || BigInt(0),
    isLoading,
  };
}

export interface NameEntry {
  name: string;
  tld: string;
  owner: string;
}

export function useUserNames(addr: `0x${string}` | undefined, restApi?: string) {
  const [names, setNames] = useState<NameEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNames = useCallback(async () => {
    if (!addr) return;
    setIsLoading(true);
    setError(null);
    try {
      const bech32Addr = evmToBech32(addr);
      const base = restApi || REST_API;
      const res = await fetch(
        `${base}/xid/v1/names/${bech32Addr}?pagination.limit=100&pagination.count_total=true`
      );
      if (!res.ok) throw new Error("Failed to fetch names");
      const data = await res.json();
      setNames(data.names || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch names");
    } finally {
      setIsLoading(false);
    }
  }, [addr, restApi]);

  useEffect(() => {
    fetchNames();
  }, [fetchNames]);

  return { names, isLoading, error, refetch: fetchNames };
}

export function useXidWrite() {
  const { writeContract: _writeContract, data: hash, isPending: _isPending, error: _writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { address: account } = useAccount();
  const [simError, setSimError] = useState<Error | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Create a direct HTTP public client that bypasses the wallet provider.
  // Wallets (MetaMask etc.) proxy eth_call and may swallow revert data, so
  // we talk to the node directly to get clean Error(string) revert reasons.
  const chains = useChains();
  const directClient = useMemo(() => {
    const chain = chains[0];
    const rpcUrl = chain?.rpcUrls?.default?.http?.[0];
    if (!rpcUrl) return null;
    return createPublicClient({ chain, transport: http(rpcUrl) });
  }, [chains]);

  // Clear simulation error when a new write succeeds or a new attempt starts
  useEffect(() => {
    if (isSuccess || _isPending) setSimError(null);
  }, [isSuccess, _isPending]);

  // Wraps writeContract with an eth_call pre-flight to surface clean revert reasons.
  // cosmos/evm nodes return proper Error(string) revert data on eth_call, but
  // eth_sendRawTransaction loses it, so we simulate first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writeContract = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (params: any) => {
      setSimError(null);

      if (!directClient || !account) {
        _writeContract(params);
        return;
      }

      setIsSimulating(true);
      const p = params as { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint };
      directClient
        .call({
          account,
          to: p.address,
          data: encodeFunctionData({
            abi: p.abi,
            functionName: p.functionName,
            args: (p.args ?? []) as unknown[],
          }),
          value: p.value,
        })
        .then(() => {
          // Simulation succeeded — proceed with actual write
          _writeContract(params);
        })
        .catch((err: unknown) => {
          setSimError(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => setIsSimulating(false));
    },
    [directClient, account, _writeContract],
  );

  return {
    writeContract,
    hash,
    isPending: _isPending || isSimulating,
    isConfirming,
    isSuccess,
    error: simError || _writeError,
  };
}

/**
 * Try to ABI-decode hex revert data as Error(string).
 * The standard selector is 0x08c379a0.
 */
function tryDecodeRevertData(hex: string): string | null {
  try {
    // Error(string) selector = 0x08c379a0
    if (hex.startsWith("0x08c379a0")) {
      const result = decodeErrorResult({
        abi: [{ type: "error", name: "Error", inputs: [{ name: "", type: "string" }] }],
        data: hex as `0x${string}`,
      });
      if (result.args?.[0] && typeof result.args[0] === "string") {
        return result.args[0];
      }
    }
  } catch {
    // Not valid ABI-encoded error data
  }
  return null;
}

/**
 * Extract a human-readable error message from a viem/wagmi contract error.
 *
 * viem wraps revert reasons in nested error objects.  On cosmos/evm nodes the
 * revert reason often appears as an "execution reverted: ..." substring buried
 * inside an RPC error message (e.g. inside an eth_estimateGas failure).  We
 * walk the full cause chain and prioritise:
 *   1. `.reason` (viem's decoded revert reason)
 *   2. `.data.errorName` (custom Solidity errors)
 *   3. "execution reverted: <reason>" extracted from any `.message` in the chain
 *   4. Top-level `.shortMessage`
 *   5. First line of top-level `.message`
 */
export function extractContractError(err: unknown): string {
  if (!err || typeof err !== "object") return "Transaction failed";

  const e = err as Record<string, unknown>;

  // Walk the cause chain looking for structured revert info
  let current: Record<string, unknown> | undefined = e;
  while (current) {
    // viem's ContractFunctionRevertedError sets `.reason`
    // Skip reasons that are just generic RPC/broadcast errors (no actual revert info)
    if (typeof current.reason === "string" && current.reason
        && !current.reason.includes("exceeds block gas limit")
        && !current.reason.includes("failed to broadcast")) {
      return current.reason;
    }
    // Custom Solidity errors via `.data.errorName`
    if (
      current.data &&
      typeof current.data === "object" &&
      typeof (current.data as Record<string, unknown>).errorName === "string"
    ) {
      const d = current.data as Record<string, unknown>;
      return `${d.errorName}${d.args ? `: ${JSON.stringify(d.args)}` : ""}`;
    }
    current = current.cause as Record<string, unknown> | undefined;
  }

  // Walk again looking for revert reasons embedded in message/details strings.
  // cosmos/evm nodes embed the revert reason in RPC error strings as
  // "execution reverted: <reason>".  Also check for viem's own phrasing.
  const revertPatterns = [
    /execution reverted:\s*(.+?)(?:\n|$)/i,
    /reverted with the following reason:\s*\n*(.+?)(?:\n|$)/i,
  ];
  current = e;
  while (current) {
    for (const field of ["message", "details", "shortMessage"] as const) {
      const val = current[field];
      if (typeof val !== "string") continue;
      for (const pattern of revertPatterns) {
        const match = val.match(pattern);
        if (match?.[1]?.trim()) {
          return match[1].trim();
        }
      }
    }
    // Check for hex-encoded revert data that viem may store in `.data`
    if (typeof current.data === "string" && current.data.startsWith("0x")) {
      const decoded = tryDecodeRevertData(current.data);
      if (decoded) return decoded;
    }
    current = current.cause as Record<string, unknown> | undefined;
  }

  // Fallback: viem's shortMessage is a clean one-liner
  if (typeof e.shortMessage === "string" && e.shortMessage) {
    return e.shortMessage;
  }

  // Last resort: first line of the full message
  if (typeof e.message === "string" && e.message) {
    return e.message.split("\n")[0];
  }

  return "Transaction failed";
}
