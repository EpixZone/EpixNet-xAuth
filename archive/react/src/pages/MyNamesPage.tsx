import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { explorerTxUrl } from "../config/chain";
import { useRestApi } from "../contexts/EpixNetContext";
import { evmToBech32 } from "../config/bech32";
import { usePrimaryName, useXidWrite } from "../hooks/useXid";
import { XID_ADDRESS, XID_ABI } from "../config/contract";

interface NameEntry {
  name: string;
  tld: string;
  owner: string;
}

interface NamesResponse {
  names: NameEntry[];
  pagination: {
    total: string;
  };
}

export default function MyNamesPage() {
  const restApi = useRestApi();
  const { address, isConnected } = useAccount();
  const { primaryName, primaryTld, refetch: refetchPrimary } = usePrimaryName(address);
  const setPrimaryWriter = useXidWrite();
  const [names, setNames] = useState<NameEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (setPrimaryWriter.isSuccess) {
      refetchPrimary();
    }
  }, [setPrimaryWriter.isSuccess]);

  useEffect(() => {
    if (!address) return;

    const fetchNames = async () => {
      setLoading(true);
      setError("");
      try {
        const bech32Addr = evmToBech32(address);
        const res = await fetch(
          `${restApi}/xid/v1/names/${bech32Addr}?pagination.limit=10&pagination.offset=${page * 10}&pagination.count_total=true`
        );
        if (!res.ok) throw new Error("Failed to fetch names");
        const data: NamesResponse = await res.json();
        setNames(data.names || []);
        setTotal(parseInt(data.pagination?.total || "0", 10));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch names");
      } finally {
        setLoading(false);
      }
    };

    fetchNames();
  }, [address, page]);

  if (!isConnected) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">My Names</h1>
        <div className="bg-card rounded-lg border border-default p-8 text-center">
          <p className="text-secondary text-sm">Connect your wallet to view your names.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          My Names
          {total > 0 && (
            <span className="text-base font-normal text-tertiary ml-2">({total})</span>
          )}
        </h1>
        <Link
          to="/"
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          Register New
        </Link>
      </div>

      <div className="bg-card rounded-lg border border-default">
        {loading ? (
          <div className="p-8 text-center text-secondary text-sm">Loading...</div>
        ) : error ? (
          <div className="p-8 text-center text-error text-sm">{error}</div>
        ) : names.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-secondary text-sm">You don't own any names yet.</p>
            <Link
              to="/"
              className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
            >
              Register Your First Name
            </Link>
          </div>
        ) : (
          <div>
            {names.map((entry, i) => {
              const isPrimary = entry.name === primaryName && entry.tld === primaryTld;
              return (
                <div
                  key={`${entry.tld}-${entry.name}`}
                  className={`flex items-center justify-between px-5 py-3.5 hover:bg-hover transition-colors ${
                    i < names.length - 1 ? "border-b border-default" : ""
                  }`}
                >
                  <Link
                    to={`/name/${entry.tld}/${entry.name}`}
                    className="flex items-center gap-2 flex-1 min-w-0"
                  >
                    <span className="text-primary font-medium text-sm">
                      {entry.name}.{entry.tld}
                    </span>
                    {isPrimary && (
                      <span className="text-xs bg-accent-subtle text-accent px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                        Primary
                      </span>
                    )}
                  </Link>
                  <div className="flex items-center gap-3">
                    {!isPrimary && names.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setPrimaryWriter.writeContract({
                            address: XID_ADDRESS,
                            abi: XID_ABI,
                            functionName: "setPrimaryName",
                            args: [entry.name, entry.tld],
                          });
                        }}
                        disabled={setPrimaryWriter.isPending || setPrimaryWriter.isConfirming}
                        className="text-xs px-2.5 py-1 bg-accent-subtle text-accent hover:opacity-80 rounded-md transition-colors disabled:opacity-50"
                      >
                        Set Primary
                      </button>
                    )}
                    <Link
                      to={`/name/${entry.tld}/${entry.name}`}
                      className="text-secondary text-sm hover:text-primary transition-colors"
                    >
                      View
                    </Link>
                  </div>
                </div>
              );
            })}
            {setPrimaryWriter.hash && (
              <div className="px-5 py-3 border-t border-default">
                <p className="text-sm text-secondary">
                  Set Primary tx:{" "}
                  <a
                    href={explorerTxUrl(setPrimaryWriter.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent font-mono"
                  >
                    {setPrimaryWriter.hash.slice(0, 16)}...
                  </a>
                  {setPrimaryWriter.isSuccess && (
                    <span className="ml-2 text-success">Confirmed!</span>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {total > 10 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-default">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-sm text-accent hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-secondary text-sm">
              Page {page + 1} of {Math.ceil(total / 10)}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * 10 >= total}
              className="text-sm text-accent hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
