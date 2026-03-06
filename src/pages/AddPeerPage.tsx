import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  usePrimaryName,
  useUserNames,
  useResolve,
  useRegistrationFee,
  useXidWrite,
  extractContractError,
} from "../hooks/useXid";
import { formatEther } from "viem";
import { XID_ADDRESS, XID_ABI } from "../config/contract";
import { DEFAULT_TLD } from "../config/chain";
import { epixFrame } from "../config/epixframe";
import { useRestApi } from "../contexts/EpixNetContext";

// ---------------------------------------------------------------------------
// Price tier helpers (reused from PricesPage)
// ---------------------------------------------------------------------------

interface PriceTier {
  max_length: number;
  price: string;
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
  if (max >= 4294967295 || max >= 1000) return `${min}+ characters`;
  if (min === max) return `${min} character${min !== 1 ? "s" : ""}`;
  return `${min}\u2013${max} characters`;
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS = ["Connect Wallet", "Select xID", "Link Identity"] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className="w-8 h-px"
                style={{
                  background: done
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                }}
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors"
                style={{
                  background: done
                    ? "var(--color-accent)"
                    : active
                    ? "var(--color-accent)"
                    : "var(--color-input-bg)",
                  color: done || active ? "#fff" : "var(--color-text-secondary)",
                  border:
                    !done && !active
                      ? "1px solid var(--color-border)"
                      : "none",
                }}
              >
                {done ? (
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className="text-xs font-medium whitespace-nowrap"
                style={{
                  color: done || active
                    ? "var(--color-text-primary)"
                    : "var(--color-text-tertiary)",
                }}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Connect Wallet
// ---------------------------------------------------------------------------

function StepConnectWallet() {
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-5">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ background: "var(--color-accent-subtle)" }}
      >
        <svg
          className="w-8 h-8"
          fill="none"
          viewBox="0 0 24 24"
          stroke="var(--color-accent)"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 013 6v3"
          />
        </svg>
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-lg font-semibold text-primary">
          Connect Your Wallet
        </h2>
        <p className="text-secondary text-sm max-w-xs">
          You need to connect an EpixChain wallet to register an xID and add
          identity addresses.
        </p>
      </div>
      <ConnectButton />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Select or Register xID
// ---------------------------------------------------------------------------

interface StepSelectXidProps {
  names: { name: string; tld: string }[];
  namesLoading: boolean;
  selectedName: string;
  selectedTld: string;
  restApi: string;
  onSelect: (name: string, tld: string) => void;
  onRegistered: () => void;
}

function StepSelectXid({
  names,
  namesLoading,
  selectedName,
  selectedTld,
  restApi,
  onSelect,
  onRegistered,
}: StepSelectXidProps) {
  const [showRegister, setShowRegister] = useState(false);
  const [newName, setNewName] = useState("");
  const [showTiers, setShowTiers] = useState(false);
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(false);
  const {
    isAvailable,
    isLoading: resolving,
  } = useResolve(newName);
  const { feeFormatted, isLoading: feeLoading } = useRegistrationFee(newName);
  const registerWriter = useXidWrite();

  // Fetch price tiers when user expands them
  useEffect(() => {
    if (!showTiers || priceTiers.length > 0) return;
    setTiersLoading(true);
    fetch(`${restApi}/xid/v1/tlds`)
      .then((res) => res.json())
      .then((data) => {
        const tld = (data.tlds || []).find(
          (t: { tld: string }) => t.tld === DEFAULT_TLD
        );
        if (tld) setPriceTiers(tld.price_tiers || []);
      })
      .catch(() => {})
      .finally(() => setTiersLoading(false));
  }, [showTiers, priceTiers.length, restApi]);

  const handleRegister = () => {
    registerWriter.writeContract({
      address: XID_ADDRESS,
      abi: XID_ABI,
      functionName: "register",
      args: [newName, DEFAULT_TLD],
    });
  };

  // After successful registration, refresh the names list and select the new one
  useEffect(() => {
    if (registerWriter.isSuccess) {
      onSelect(newName, DEFAULT_TLD);
      onRegistered();
      setShowRegister(false);
      setNewName("");
    }
  }, [registerWriter.isSuccess]);

  if (namesLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div
          className="animate-spin rounded-full h-6 w-6 border-2 border-transparent"
          style={{ borderTopColor: "var(--color-accent)" }}
        />
        <p className="text-secondary text-sm mt-3">
          Looking up your xID names...
        </p>
      </div>
    );
  }

  // No names — show register form directly
  if (names.length === 0 && !showRegister) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center py-6 space-y-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: "var(--color-badge-amber-bg)" }}
          >
            <svg
              className="w-7 h-7"
              fill="none"
              viewBox="0 0 24 24"
              stroke="var(--color-badge-amber-text)"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>
          <div className="text-center space-y-1">
            <h2 className="text-lg font-semibold text-primary">
              No xID Found
            </h2>
            <p className="text-secondary text-sm max-w-xs">
              You need to register an xID name before you can add an EpixNet
              identity address.
            </p>
          </div>
          <button
            onClick={() => setShowRegister(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 px-6 rounded-md text-sm transition-colors"
          >
            Register a New xID
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Existing names list */}
      {names.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-secondary">
              {names.length === 1 ? "Your xID" : "Select an xID to use"}
            </h3>
            {names.length > 0 && (
              <button
                onClick={() => setShowRegister(!showRegister)}
                className="text-xs text-accent hover:opacity-80 transition-colors"
              >
                {showRegister ? "Cancel" : "+ Register New"}
              </button>
            )}
          </div>

          <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: "var(--color-border)" }}
          >
            {names.map((entry, i) => {
              const isSelected =
                entry.name === selectedName && entry.tld === selectedTld;
              return (
                <button
                  key={`${entry.tld}-${entry.name}`}
                  onClick={() => onSelect(entry.name, entry.tld)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors"
                  style={{
                    background: isSelected
                      ? "var(--color-accent-subtle)"
                      : "var(--color-card-bg)",
                    borderBottom:
                      i < names.length - 1
                        ? "1px solid var(--color-border)"
                        : "none",
                  }}
                >
                  <span className="font-medium text-sm text-primary">
                    {entry.name}.{entry.tld}
                  </span>
                  {isSelected && (
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: "var(--color-accent)" }}
                    >
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Inline registration form */}
      {showRegister && (
        <div
          className="rounded-lg border p-4 space-y-3"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-card-bg)",
          }}
        >
          <h3 className="text-sm font-medium text-primary">
            Register a New xID
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase())}
              placeholder="Enter a name"
              className="flex-1 bg-input border border-default rounded-md px-3 py-2 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors"
            />
            <span className="flex items-center px-3 py-2 bg-input border border-default rounded-md text-secondary font-medium text-sm">
              .{DEFAULT_TLD}
            </span>
          </div>

          {newName && (
            <div className="space-y-2">
              {resolving ? (
                <p className="text-secondary text-xs">
                  Checking availability...
                </p>
              ) : isAvailable ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="bg-badge-green text-badge-green rounded-full px-2 py-0.5 text-xs font-medium">
                      Available
                    </span>
                    <span className="text-secondary text-xs">
                      {newName}.{DEFAULT_TLD}
                    </span>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowTiers(!showTiers)}
                      className="w-full flex items-center justify-between bg-input rounded-md p-2.5 hover:opacity-80 transition-opacity cursor-pointer"
                    >
                      <span className="text-secondary text-xs flex items-center gap-1">
                        Registration Fee
                        <svg
                          className="w-3 h-3 transition-transform"
                          style={{
                            transform: showTiers ? "rotate(180deg)" : "rotate(0deg)",
                          }}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </span>
                      <span className="text-primary font-medium text-xs">
                        {feeLoading ? "..." : `${feeFormatted} EPIX`}
                      </span>
                    </button>

                    {showTiers && (
                      <div
                        className="mt-2 rounded-md border overflow-hidden"
                        style={{
                          borderColor: "var(--color-border)",
                          background: "var(--color-input-bg)",
                        }}
                      >
                        <div className="px-3 py-2 border-b" style={{ borderColor: "var(--color-border)" }}>
                          <span className="text-xs font-medium text-secondary uppercase tracking-wider">
                            All Price Tiers for .{DEFAULT_TLD}
                          </span>
                        </div>
                        {tiersLoading ? (
                          <div className="px-3 py-3 text-center">
                            <span className="text-tertiary text-xs">Loading tiers...</span>
                          </div>
                        ) : priceTiers.length === 0 ? (
                          <div className="px-3 py-3 text-center">
                            <span className="text-tertiary text-xs">Could not load pricing</span>
                          </div>
                        ) : (
                          <table className="w-full">
                            <tbody>
                              {priceTiers.map((tier, i) => {
                                const isCurrentTier =
                                  newName.length > 0 &&
                                  newName.length <= tier.max_length &&
                                  (i === 0 || newName.length > priceTiers[i - 1].max_length);
                                return (
                                  <tr
                                    key={tier.max_length}
                                    style={{
                                      background: isCurrentTier
                                        ? "var(--color-accent-subtle)"
                                        : "transparent",
                                      borderBottom:
                                        i < priceTiers.length - 1
                                          ? "1px solid var(--color-border)"
                                          : "none",
                                    }}
                                  >
                                    <td className="px-3 py-1.5 text-xs text-primary">
                                      {tierLabel(tier, i, priceTiers)}
                                      {isCurrentTier && (
                                        <span className="ml-1.5 text-accent font-medium">&larr;</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono text-xs text-accent">
                                      {formatEpix(tier.price)} EPIX
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="bg-badge-red text-badge-red rounded-full px-2 py-0.5 text-xs font-medium">
                    Taken
                  </span>
                  <span className="text-secondary text-xs">
                    {newName}.{DEFAULT_TLD} is already registered
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleRegister}
            disabled={
              !newName ||
              !isAvailable ||
              registerWriter.isPending ||
              registerWriter.isConfirming
            }
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-md text-sm transition-colors"
          >
            {registerWriter.isPending
              ? "Confirm in wallet..."
              : registerWriter.isConfirming
              ? "Waiting for tx..."
              : `Register ${newName || "..."}.${DEFAULT_TLD}`}
          </button>

          {registerWriter.isSuccess && (
            <div className="bg-success rounded-md p-2.5 text-success text-xs">
              Name registered successfully!
            </div>
          )}

          {registerWriter.error && (
            <div className="bg-error rounded-md p-2.5 text-error text-xs">
              {extractContractError(registerWriter.error)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Link Identity
// ---------------------------------------------------------------------------

interface StepLinkIdentityProps {
  selectedName: string;
  selectedTld: string;
  peerAddress: string;
  returnTo: string;
}

function StepLinkIdentity({
  selectedName,
  selectedTld,
  peerAddress,
  returnTo,
}: StepLinkIdentityProps) {
  const writer = useXidWrite();
  const [linkStatus, setLinkStatus] = useState<
    "idle" | "polling" | "confirmed"
  >("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAdd = () => {
    if (!selectedName || !peerAddress) return;
    writer.writeContract({
      address: XID_ADDRESS,
      abi: XID_ABI,
      functionName: "linkIdentity",
      args: [selectedName, selectedTld, peerAddress, "epixnet"],
    });
  };

  const pollIdentityResolution = useCallback(async () => {
    if (!epixFrame.isEmbedded || !peerAddress) {
      if (returnTo) {
        setTimeout(() => {
          window.location.href = returnTo;
        }, 1500);
      }
      return;
    }

    setLinkStatus("polling");

    try {
      await epixFrame.cmd("xidInvalidateCache", {
        peer_address: peerAddress,
      });
    } catch (_) {
      /* ignore */
    }

    pollRef.current = setInterval(async () => {
      try {
        await epixFrame.cmd("xidInvalidateCache", {
          peer_address: peerAddress,
        });
        const result = await epixFrame.cmd<{ name?: string } | null>(
          "xidResolve",
          { peer_address: peerAddress }
        );
        if (result && result.name) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setLinkStatus("confirmed");
          if (returnTo) {
            setTimeout(() => {
              window.location.href = returnTo;
            }, 1000);
          }
        }
      } catch (_) {
        /* ignore */
      }
    }, 3000);

    timeoutRef.current = setTimeout(() => {
      if (pollRef.current) clearInterval(pollRef.current);
      setLinkStatus("confirmed");
      if (returnTo) {
        window.location.href = returnTo;
      }
    }, 60000);
  }, [peerAddress, returnTo]);

  useEffect(() => {
    if (writer.isSuccess && linkStatus === "idle") {
      pollIdentityResolution();
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [writer.isSuccess, linkStatus, pollIdentityResolution]);

  if (writer.isSuccess) {
    return (
      <div className="flex flex-col items-center py-8 space-y-4">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: "var(--color-success-bg)" }}
        >
          <svg
            className="w-7 h-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="var(--color-success-text)"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-success-text)" }}>
            Identity Linked!
          </h2>
          <p className="text-secondary text-sm">
            <span className="font-mono text-xs">{peerAddress}</span> has been
            added to{" "}
            <strong>
              {selectedName}.{selectedTld}
            </strong>
            .
          </p>
        </div>
        {returnTo && linkStatus === "polling" && (
          <div className="flex items-center gap-2">
            <div
              className="animate-spin rounded-full h-4 w-4 border-2 border-transparent"
              style={{ borderTopColor: "var(--color-accent)" }}
            />
            <span className="text-secondary text-sm">
              Waiting for identity confirmation...
            </span>
          </div>
        )}
        {returnTo && linkStatus === "confirmed" && (
          <p className="text-secondary text-sm">Redirecting back...</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg border p-4 space-y-3"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-card-bg)",
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-secondary text-sm">Your xID</span>
          <span className="font-semibold text-sm text-primary">
            {selectedName}.{selectedTld}
          </span>
        </div>
        <div
          className="w-full h-px"
          style={{ background: "var(--color-border)" }}
        />
        <div className="space-y-1">
          <span className="text-secondary text-sm">EpixNet Identity</span>
          <p className="font-mono text-xs text-primary break-all">
            {peerAddress || (
              <span className="text-tertiary italic">
                No identity address provided
              </span>
            )}
          </p>
        </div>
      </div>

      {writer.error && (
        <div className="bg-error rounded-md p-3 text-error text-sm">
          {extractContractError(writer.error)}
        </div>
      )}

      <button
        onClick={handleAdd}
        disabled={writer.isPending || writer.isConfirming || !peerAddress}
        className="w-full py-3 px-4 rounded-lg font-semibold text-white transition-colors"
        style={{
          background:
            writer.isPending || writer.isConfirming
              ? "#4b5563"
              : "var(--color-accent)",
          cursor:
            writer.isPending || writer.isConfirming
              ? "not-allowed"
              : "pointer",
        }}
      >
        {writer.isPending
          ? "Confirm in wallet..."
          : writer.isConfirming
          ? "Confirming..."
          : "Link Identity"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard page
// ---------------------------------------------------------------------------

export default function AddPeerPage() {
  const params = useMemo(
    () => new URLSearchParams(window.location.search),
    []
  );
  const peerAddress = params.get("linkIdentity") || params.get("address") || "";
  const returnTo = params.get("returnTo") || "";

  const { address, isConnected } = useAccount();
  const restApi = useRestApi();
  const {
    primaryName,
    primaryTld,
    isLoading: primaryLoading,
    refetch: refetchPrimary,
  } = usePrimaryName(address);
  const {
    names,
    isLoading: namesLoading,
    refetch: refetchNames,
  } = useUserNames(address, restApi);

  const [selectedName, setSelectedName] = useState("");
  const [selectedTld, setSelectedTld] = useState("");

  // Auto-select primary name when it loads, or the only available name
  useEffect(() => {
    if (selectedName) return;
    if (primaryName && primaryTld) {
      setSelectedName(primaryName);
      setSelectedTld(primaryTld);
    } else if (names.length === 1) {
      setSelectedName(names[0].name);
      setSelectedTld(names[0].tld);
    }
  }, [primaryName, primaryTld, names, selectedName]);

  const handleSelect = (name: string, tld: string) => {
    setSelectedName(name);
    setSelectedTld(tld);
  };

  const handleRegistered = () => {
    refetchNames();
    refetchPrimary();
  };

  // Determine current step
  const currentStep = !isConnected
    ? 0
    : !selectedName
    ? 1
    : 2;

  const isLoadingNames = primaryLoading || namesLoading;

  return (
    <div className="max-w-lg mx-auto mt-8 p-6">
      <h1
        className="text-2xl font-bold text-center mb-2"
        style={{ color: "var(--color-text-primary)" }}
      >
        Link EpixNet Identity
      </h1>
      <p className="text-secondary text-sm text-center mb-6">
        Link your EpixNet identity to your xID name.
      </p>

      <StepIndicator current={currentStep} />

      <div
        className="rounded-xl border p-6"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-card-bg)",
        }}
      >
        {/* Step 1: Connect Wallet */}
        {currentStep === 0 && <StepConnectWallet />}

        {/* Step 2: Select or Register xID */}
        {currentStep === 1 && (
          <StepSelectXid
            names={names}
            namesLoading={isLoadingNames}
            selectedName={selectedName}
            selectedTld={selectedTld}
            restApi={restApi}
            onSelect={handleSelect}
            onRegistered={handleRegistered}
          />
        )}

        {/* Step 3: Add Peer */}
        {currentStep === 2 && (
          <StepLinkIdentity
            selectedName={selectedName}
            selectedTld={selectedTld}
            peerAddress={peerAddress}
            returnTo={returnTo}
          />
        )}
      </div>

      {/* Show wallet info at bottom when connected */}
      {isConnected && currentStep > 0 && (
        <div className="mt-4 flex justify-center">
          <ConnectButton
            showBalance={false}
            chainStatus="icon"
            accountStatus="address"
          />
        </div>
      )}
    </div>
  );
}
