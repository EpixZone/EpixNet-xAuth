import { useState, useEffect, useCallback } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther } from "viem";
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

  const result = data as [string[], string[], bigint[], boolean[], bigint[]] | undefined;
  const peers = result
    ? result[0].map((addr, i) => ({
        address: addr,
        label: result[1][i],
        addedAt: result[2][i],
        active: result[3][i],
        revokedAt: result[4][i],
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
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  return {
    writeContract,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}
