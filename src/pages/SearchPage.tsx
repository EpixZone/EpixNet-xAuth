import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { isAddress } from "viem";
import { formatEther } from "viem";
import {
  useResolve,
  useRegistrationFee,
  useProfile,
  extractContractError,
} from "../hooks/useXid";
import { DEFAULT_TLD } from "../config/chain";
import { useRestApi } from "../contexts/EpixNetContext";
import { evmToBech32, truncateAddress } from "../config/bech32";

export default function SearchPage() {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-1">Search Names</h1>
        <p className="text-secondary text-sm">Look up a name to see if it's registered.</p>
      </div>

      <NameSearch />

      <div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors"
        >
          <span className={`transition-transform text-xs ${showAdvanced ? "rotate-90" : ""}`}>
            &#9654;
          </span>
          Advanced Lookup
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-6">
            <ForwardResolve />
            <ReverseResolve />
            <IdentityReverseLookup />
          </div>
        )}
      </div>
    </div>
  );
}

function NameSearch() {
  const [input, setInput] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  const { owner, isAvailable, isLoading } = useResolve(debouncedName);
  const { fee } = useRegistrationFee(debouncedName);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedName(input.toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const hasResult = debouncedName.length > 0 && !isLoading;
  const isRegistered = hasResult && !isAvailable && owner;

  return (
    <div className="bg-card rounded-lg border border-default p-6">
      <label className="block text-sm font-medium text-secondary mb-2">
        Search for a name
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.toLowerCase())}
          placeholder="Search names..."
          className="flex-1 bg-input border border-default rounded-md px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors"
          maxLength={64}
        />
        <div className="flex items-center bg-input border border-default rounded-md px-4 text-tertiary font-mono text-sm">
          .{DEFAULT_TLD}
        </div>
      </div>

      <div className="mt-3 min-h-[24px]">
        {isLoading && debouncedName && (
          <p className="text-tertiary text-sm">Searching...</p>
        )}
      </div>

      {isRegistered && (
        <div className="mt-2 p-4 bg-input rounded-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">
                {debouncedName}
                <span className="text-tertiary">.{DEFAULT_TLD}</span>
              </p>
              <p className="text-secondary text-sm mt-1">
                Owner:{" "}
                <span className="font-mono text-primary">
                  {truncateAddress(owner!)}
                </span>
              </p>
            </div>
            <Link
              to={`/name/${DEFAULT_TLD}/${debouncedName}`}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              View Details
            </Link>
          </div>
        </div>
      )}

      {hasResult && isAvailable && (
        <div className="mt-2 p-4 bg-input rounded-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-secondary text-sm">
                <span className="font-semibold text-primary">
                  {debouncedName}.{DEFAULT_TLD}
                </span>{" "}
                is not registered.
                {fee !== undefined && (
                  <span className="text-tertiary">
                    {" "}
                    Fee: {formatEther(fee)} EPIX
                  </span>
                )}
              </p>
            </div>
            <Link
              to="/"
              className="px-4 py-2 bg-badge-green text-badge-green rounded-md text-sm font-medium transition-colors hover:opacity-80"
            >
              Register It
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ForwardResolve() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState({ name: "", tld: DEFAULT_TLD });
  const { owner, isAvailable, isLoading, error } = useResolve(query.name, query.tld);
  const { fee } = useRegistrationFee(query.name, query.tld);
  const { avatar, bio } = useProfile(query.name, query.tld);

  const hasResult = query.name.length > 0 && !isLoading;

  const doResolve = () => setQuery({ name: input.toLowerCase(), tld: DEFAULT_TLD });

  return (
    <div className="bg-card rounded-lg border border-default p-6">
      <h2 className="text-base font-semibold mb-1">Forward Resolve</h2>
      <p className="text-secondary text-sm mb-4">
        Look up the owner of a registered name.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.toLowerCase())}
          placeholder="name"
          className="flex-1 bg-input border border-default rounded-md px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors"
          onKeyDown={(e) => e.key === "Enter" && doResolve()}
        />
        <div className="flex items-center bg-input border border-default rounded-md px-3 text-tertiary font-mono text-sm">
          .{DEFAULT_TLD}
        </div>
        <button
          onClick={doResolve}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md font-medium text-sm transition-colors"
        >
          Resolve
        </button>
      </div>

      {isLoading && query.name && (
        <p className="mt-4 text-tertiary text-sm">Resolving...</p>
      )}

      {hasResult && !error && !isAvailable && owner && (
        <div className="mt-4 p-4 bg-input rounded-md space-y-3">
          <div className="flex justify-between">
            <span className="text-secondary text-sm">Name</span>
            <span className="font-semibold text-sm">
              {query.name}.{query.tld}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-secondary text-sm">Owner (EVM)</span>
            <span className="font-mono text-sm">{owner}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-secondary text-sm">Owner (Cosmos)</span>
            <span className="font-mono text-sm">{evmToBech32(owner)}</span>
          </div>
          {(avatar || bio) && (
            <>
              {avatar && (
                <div className="flex justify-between items-center">
                  <span className="text-secondary text-sm">Avatar</span>
                  <img
                    src={avatar}
                    alt="avatar"
                    className="w-8 h-8 rounded-full"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                  />
                </div>
              )}
              {bio && (
                <div className="flex justify-between">
                  <span className="text-secondary text-sm">Bio</span>
                  <span className="text-sm text-primary max-w-xs text-right">{bio}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {hasResult && !error && isAvailable && (
        <div className="mt-4 p-4 bg-input rounded-md">
          <p className="text-secondary text-sm">
            <span className="font-semibold text-primary">
              {query.name}.{query.tld}
            </span>{" "}
            is not registered.
            {fee !== undefined && (
              <span className="text-tertiary">
                {" "}
                Registration fee: {formatEther(fee)} EPIX
              </span>
            )}
          </p>
        </div>
      )}

      {error && hasResult && (
        <p className="mt-4 text-error text-sm">
          {extractContractError(error)}
        </p>
      )}
    </div>
  );
}

function isBech32Address(addr: string): boolean {
  try {
    return addr.startsWith("epix1") && addr.length > 10;
  } catch {
    return false;
  }
}

function isValidLookupAddress(addr: string): boolean {
  return isAddress(addr) || isBech32Address(addr);
}

interface NameEntry {
  name: string;
  tld: string;
  owner: string;
}

function ReverseResolve() {
  const restApi = useRestApi();
  const [input, setInput] = useState("");
  const [displayAddr, setDisplayAddr] = useState("");
  const [primaryEntry, setPrimaryEntry] = useState<NameEntry | null>(null);
  const [names, setNames] = useState<NameEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const doLookup = async () => {
    const trimmed = input.trim();
    setDisplayAddr(trimmed);
    setPrimaryEntry(null);
    setNames([]);
    setError("");
    setSearched(true);
    setLoading(true);
    setShowAll(false);

    try {
      let bech32Addr: string;
      if (isAddress(trimmed)) {
        bech32Addr = evmToBech32(trimmed);
      } else if (isBech32Address(trimmed)) {
        bech32Addr = trimmed;
      } else {
        return;
      }

      const [primaryRes, namesRes] = await Promise.all([
        fetch(`${restApi}/xid/v1/reverse/${bech32Addr}`),
        fetch(`${restApi}/xid/v1/names/${bech32Addr}?pagination.limit=50&pagination.count_total=true`),
      ]);

      if (primaryRes.ok) {
        const primaryData = await primaryRes.json();
        if (primaryData.primary_name?.name) {
          setPrimaryEntry(primaryData.primary_name);
        }
      }

      if (!namesRes.ok) throw new Error("Failed to fetch names");
      const namesData = await namesRes.json();
      setNames(namesData.names || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  };

  const otherNames = primaryEntry
    ? names.filter((n) => !(n.name === primaryEntry.name && n.tld === primaryEntry.tld))
    : names;

  return (
    <div className="bg-card rounded-lg border border-default p-6">
      <h2 className="text-base font-semibold mb-1">Reverse Resolve</h2>
      <p className="text-secondary text-sm mb-4">
        Look up all names owned by an address (0x... or epix1...).
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0x... or epix1..."
          className="flex-1 bg-input border border-default rounded-md px-4 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors"
          onKeyDown={(e) => e.key === "Enter" && doLookup()}
        />
        <button
          onClick={doLookup}
          disabled={!isValidLookupAddress(input.trim())}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md font-medium text-sm transition-colors disabled:opacity-50"
        >
          Lookup
        </button>
      </div>

      {input.trim() && !isValidLookupAddress(input.trim()) && (
        <p className="mt-2 text-error text-sm">
          Invalid address (enter a 0x... EVM address or epix1... bech32 address)
        </p>
      )}

      {loading && (
        <p className="mt-4 text-tertiary text-sm">Resolving...</p>
      )}

      {error && (
        <p className="mt-4 text-error text-sm">{error}</p>
      )}

      {searched && !loading && !error && names.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex justify-between text-sm text-secondary mb-2">
            <span>Address: <span className="font-mono">{truncateAddress(displayAddr)}</span></span>
            <span>{names.length} name{names.length !== 1 ? "s" : ""}</span>
          </div>

          {primaryEntry && (
            <Link
              to={`/name/${primaryEntry.tld}/${primaryEntry.name}`}
              className="flex items-center justify-between p-3 bg-accent-subtle border border-default rounded-md hover:opacity-80 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="text-primary font-medium text-sm">
                  {primaryEntry.name}.{primaryEntry.tld}
                </span>
                <span className="text-xs bg-accent-subtle text-accent px-2 py-0.5 rounded-full font-medium">
                  Primary
                </span>
              </span>
              <span className="text-secondary text-sm">View</span>
            </Link>
          )}

          {otherNames.length > 0 && (
            <>
              <button
                onClick={() => setShowAll(!showAll)}
                className="flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors mt-1"
              >
                <span className={`transition-transform text-xs ${showAll ? "rotate-90" : ""}`}>
                  &#9654;
                </span>
                Show all {names.length} names
              </button>
              {showAll && (
                <div className="space-y-1">
                  {otherNames.map((entry) => (
                    <Link
                      key={`${entry.tld}-${entry.name}`}
                      to={`/name/${entry.tld}/${entry.name}`}
                      className="flex items-center justify-between p-3 bg-input rounded-md hover:bg-hover transition-colors"
                    >
                      <span className="text-primary font-medium text-sm">
                        {entry.name}.{entry.tld}
                      </span>
                      <span className="text-secondary text-sm">View</span>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {searched && !loading && !error && names.length === 0 && (
        <div className="mt-4 p-4 bg-input rounded-md">
          <p className="text-secondary text-sm">
            No names owned by{" "}
            <span className="font-mono">{truncateAddress(displayAddr)}</span>.
            {" "}If this is an EpixNet identity address, try the Identity Reverse Lookup below.
          </p>
        </div>
      )}
    </div>
  );
}

function IdentityReverseLookup() {
  const restApi = useRestApi();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<{
    name: string;
    tld: string;
    owner: string;
    identityActive: boolean;
    identityLabel: string;
    addedAt: number;
    revokedAt: number;
  } | null>(null);

  const doLookup = async () => {
    const trimmed = input.trim();
    setError("");
    setSearched(true);
    setLoading(true);
    setResult(null);

    try {
      if (!isBech32Address(trimmed)) {
        setError("Enter a valid epix1... bech32 identity address");
        return;
      }

      const res = await fetch(`${restApi}/xid/v1/reverse_identity/${trimmed}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      if (data.name_record?.name) {
        setResult({
          name: data.name_record.name,
          tld: data.name_record.tld,
          owner: data.name_record.owner,
          identityActive: data.peer?.active ?? true,
          identityLabel: data.peer?.label ?? "",
          addedAt: parseInt(data.peer?.added_at ?? "0"),
          revokedAt: parseInt(data.peer?.revoked_at ?? "0"),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card rounded-lg border border-default p-6">
      <h2 className="text-base font-semibold mb-1">Identity Reverse Lookup</h2>
      <p className="text-secondary text-sm mb-4">
        Look up the xID name linked to an EpixNet identity address (epix1...).
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="epix1..."
          className="flex-1 bg-input border border-default rounded-md px-4 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors"
          onKeyDown={(e) => e.key === "Enter" && doLookup()}
        />
        <button
          onClick={doLookup}
          disabled={!isBech32Address(input.trim())}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md font-medium text-sm transition-colors disabled:opacity-50"
        >
          Lookup
        </button>
      </div>

      {loading && (
        <p className="mt-4 text-tertiary text-sm">Resolving...</p>
      )}

      {error && (
        <p className="mt-4 text-error text-sm">{error}</p>
      )}

      {searched && !loading && !error && result && (
        <div className="mt-4 p-4 bg-input rounded-md space-y-3">
          <div className="flex justify-between">
            <span className="text-secondary text-sm">xID Name</span>
            <Link
              to={`/name/${result.tld}/${result.name}`}
              className="font-semibold text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {result.name}.{result.tld}
            </Link>
          </div>
          <div className="flex justify-between">
            <span className="text-secondary text-sm">Owner</span>
            <span className="font-mono text-sm">{truncateAddress(result.owner)}</span>
          </div>
          {result.identityLabel && (
            <div className="flex justify-between">
              <span className="text-secondary text-sm">Identity Label</span>
              <span className="text-sm">{result.identityLabel}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-secondary text-sm">Status</span>
            <span className={`text-sm font-medium ${result.identityActive ? "text-green-400" : "text-red-400"}`}>
              {result.identityActive ? "Active" : `Revoked (block ${result.revokedAt})`}
            </span>
          </div>
          {result.addedAt > 0 && (
            <div className="flex justify-between">
              <span className="text-secondary text-sm">Added At Block</span>
              <span className="text-sm font-mono">{result.addedAt}</span>
            </div>
          )}
        </div>
      )}

      {searched && !loading && !error && !result && (
        <div className="mt-4 p-4 bg-input rounded-md">
          <p className="text-secondary text-sm">
            No xID name linked to this identity address.
          </p>
        </div>
      )}
    </div>
  );
}
