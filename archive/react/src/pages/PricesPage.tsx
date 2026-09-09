import { useState, useEffect } from "react";
import { formatEther } from "viem";
import { useRegistrationFee } from "../hooks/useXid";
import { DEFAULT_TLD } from "../config/chain";
import { useRestApi } from "../contexts/EpixNetContext";

interface PriceTier {
  max_length: number;
  price: string;
}

interface TLDConfig {
  tld: string;
  enabled: boolean;
  price_tiers: PriceTier[];
}

function formatEpix(aepixStr: string): string {
  try {
    return Number(formatEther(BigInt(aepixStr))).toLocaleString();
  } catch {
    return aepixStr;
  }
}

function tierLabel(tier: PriceTier, index: number, tiers: PriceTier[]): string {
  const prev = index > 0 ? tiers[index - 1].max_length : 0;
  const min = prev + 1;
  const max = tier.max_length;

  if (max >= 4294967295 || max >= 1000) {
    return `${min}+ characters`;
  }
  if (min === max) {
    return `${min} character${min !== 1 ? "s" : ""}`;
  }
  return `${min}\u2013${max} characters`;
}

function PriceTierTable({ tld }: { tld: TLDConfig }) {
  return (
    <div className="bg-card rounded-lg border border-default overflow-hidden">
      <div className="px-5 py-4 border-b border-default flex items-center justify-between">
        <h2 className="text-base font-semibold">
          .{tld.tld}
        </h2>
        {tld.enabled ? (
          <span className="text-xs bg-badge-green text-badge-green rounded-full px-2.5 py-0.5 font-medium">
            Active
          </span>
        ) : (
          <span className="text-xs bg-badge-red text-badge-red rounded-full px-2.5 py-0.5 font-medium">
            Disabled
          </span>
        )}
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-default bg-table-header">
            <th className="text-left px-5 py-3 text-xs font-medium text-secondary uppercase tracking-wider">Name Length</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-secondary uppercase tracking-wider">Registration Fee</th>
          </tr>
        </thead>
        <tbody>
          {tld.price_tiers.map((tier, i) => (
            <tr
              key={tier.max_length}
              className={`hover:bg-hover transition-colors ${
                i < tld.price_tiers.length - 1 ? "border-b border-subtle" : ""
              }`}
            >
              <td className="px-5 py-3 text-primary text-sm">
                {tierLabel(tier, i, tld.price_tiers)}
              </td>
              <td className="px-5 py-3 text-right font-mono text-accent text-sm">
                {formatEpix(tier.price)} EPIX
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeeCalculator() {
  const [name, setName] = useState("");
  const { fee, isLoading } = useRegistrationFee(name);

  return (
    <div className="bg-card rounded-lg border border-default p-6">
      <h2 className="text-base font-semibold mb-1">Fee Calculator</h2>
      <p className="text-secondary text-sm mb-4">
        Enter a name to see the exact registration fee.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="Enter a name..."
          className="flex-1 bg-input border border-default rounded-md px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors"
          maxLength={64}
        />
        <div className="flex items-center bg-input border border-default rounded-md px-3 text-tertiary font-mono text-sm">
          .{DEFAULT_TLD}
        </div>
      </div>

      {name && (
        <div className="mt-4 p-4 bg-input rounded-md">
          {isLoading ? (
            <p className="text-tertiary text-sm">Calculating...</p>
          ) : fee !== undefined ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-primary font-medium text-sm">
                  {name}.{DEFAULT_TLD}
                </p>
                <p className="text-secondary text-xs mt-0.5">
                  {name.length} character{name.length !== 1 ? "s" : ""}
                </p>
              </div>
              <p className="text-lg font-mono text-accent">
                {Number(formatEther(fee)).toLocaleString()} EPIX
              </p>
            </div>
          ) : (
            <p className="text-tertiary text-sm">Enter a valid name to see the fee.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function PricesPage() {
  const restApi = useRestApi();
  const [tlds, setTlds] = useState<TLDConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchTlds = async () => {
      try {
        const res = await fetch(`${restApi}/xid/v1/tlds`);
        if (!res.ok) throw new Error("Failed to fetch TLD pricing");
        const data = await res.json();
        setTlds(data.tlds || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch pricing");
      } finally {
        setLoading(false);
      }
    };
    fetchTlds();
  }, [restApi]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-1">Pricing</h1>
        <p className="text-secondary text-sm">
          Registration fees are based on name length. Shorter names are rarer and cost more.
          All fees are burned permanently.
        </p>
      </div>

      {loading ? (
        <div className="bg-card rounded-lg border border-default p-8 text-center text-secondary text-sm">
          Loading pricing...
        </div>
      ) : error ? (
        <div className="bg-card rounded-lg border border-default p-8 text-center text-error text-sm">
          {error}
        </div>
      ) : (
        tlds.map((tld) => <PriceTierTable key={tld.tld} tld={tld} />)
      )}

      <FeeCalculator />
    </div>
  );
}
