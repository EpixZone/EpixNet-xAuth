import { useState, useEffect } from "react";
import { formatEther } from "viem";
import { useRestApi } from "../contexts/EpixNetContext";
const XID_MODULE_BECH32 = "epix1gs90m79353yufdyqrl93yklqgcg0s6cfdcjv7h";
const BURN_EXPLORER_URL = `/epix1epxrwflutk4j2saxuy84wvv52tdepuep8yqcqk?account=${XID_MODULE_BECH32}`;

interface TldStat {
  tld: string;
  name_count: string;
  fees_burned: string;
  enabled: boolean;
}

interface Stats {
  total_names: string;
  total_fees_burned: string;
  tld_stats: TldStat[];
}

export default function StatsPage() {
  const restApi = useRestApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${restApi}/xid/v1/stats`);
        if (!res.ok) throw new Error("Failed to fetch stats");
        const data: Stats = await res.json();
        setStats(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch stats");
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [restApi]);

  const formatBurned = (wei: string) => {
    try {
      return Number(formatEther(BigInt(wei))).toLocaleString();
    } catch {
      return "0";
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Stats</h1>

      {loading ? (
        <div className="text-center text-secondary text-sm py-8">Loading...</div>
      ) : error ? (
        <div className="bg-error rounded-md p-4 text-error text-sm">{error}</div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-card rounded-lg border border-default p-6">
              <p className="text-secondary text-xs uppercase tracking-wider font-medium mb-2">Total Names Registered</p>
              <p className="text-2xl font-semibold text-accent">{stats.total_names || "0"}</p>
            </div>
            <a
              href={BURN_EXPLORER_URL}
              target="_blank"
              rel="noreferrer"
              className="bg-card rounded-lg border border-default p-6 block hover:bg-hover transition-colors"
            >
              <p className="text-secondary text-xs uppercase tracking-wider font-medium mb-2">Total Fees Burned 🔥</p>
              <p className="text-2xl font-semibold text-badge-amber">
                {formatBurned(stats.total_fees_burned)}
              </p>
              <p className="text-tertiary text-xs mt-1">
                EPIX — <span className="text-accent">View burn transactions ↗</span>
              </p>
            </a>
          </div>

          {stats.tld_stats && stats.tld_stats.length > 0 && (
            <div className="bg-card rounded-lg border border-default overflow-hidden">
              <div className="px-5 py-4 border-b border-default">
                <h2 className="text-base font-semibold">TLD Breakdown</h2>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-default bg-table-header">
                    <th className="text-left text-xs font-medium text-secondary uppercase tracking-wider px-5 py-3">TLD</th>
                    <th className="text-left text-xs font-medium text-secondary uppercase tracking-wider px-5 py-3">Names</th>
                    <th className="text-left text-xs font-medium text-secondary uppercase tracking-wider px-5 py-3">Fees Burned (EPIX) 🔥</th>
                    <th className="text-left text-xs font-medium text-secondary uppercase tracking-wider px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.tld_stats.map((tld) => (
                    <tr key={tld.tld} className="border-b border-subtle last:border-0 hover:bg-hover transition-colors">
                      <td className="px-5 py-3 text-primary font-medium text-sm">.{tld.tld}</td>
                      <td className="px-5 py-3 text-secondary text-sm">{tld.name_count}</td>
                      <td className="px-5 py-3 text-secondary text-sm">{formatBurned(tld.fees_burned)}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            tld.enabled
                              ? "bg-badge-green text-badge-green"
                              : "bg-badge-red text-badge-red"
                          }`}
                        >
                          {tld.enabled ? "Active" : "Disabled"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
