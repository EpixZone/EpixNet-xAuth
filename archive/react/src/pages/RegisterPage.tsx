import { useState } from "react";
import { useAccount } from "wagmi";
import { useResolve, useRegistrationFee, useXidWrite } from "../hooks/useXid";
import { XID_ADDRESS, XID_ABI } from "../config/contract";
import { DEFAULT_TLD, explorerTxUrl } from "../config/chain";
import xidLogo from "../../public/xID.png";

export default function RegisterPage() {
  const { isConnected } = useAccount();
  const [name, setName] = useState("");
  const { owner, isAvailable, isLoading: resolving } = useResolve(name);
  const { feeFormatted, isLoading: feeLoading } = useRegistrationFee(name);
  const { writeContract, hash, isPending, isConfirming, isSuccess, error } = useXidWrite();

  const handleRegister = () => {
    writeContract({
      address: XID_ADDRESS,
      abi: XID_ABI,
      functionName: "register",
      args: [name, DEFAULT_TLD],
    });
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-3">
        <img src={xidLogo} alt="xID" className="h-16 mx-auto" />
        <p className="text-secondary text-sm">
          Claim your identity on EpixChain. Names are permanent and transferable.
        </p>
      </div>

      <div className="bg-card rounded-lg border border-default p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-secondary mb-2">Name</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="Enter a name"
              className="flex-1 bg-input border border-default rounded-md px-4 py-2.5 text-primary focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors"
            />
            <span className="flex items-center px-4 py-2.5 bg-input border border-default rounded-md text-secondary font-medium text-sm">
              .{DEFAULT_TLD}
            </span>
          </div>
        </div>

        {name && (
          <div className="space-y-3">
            {resolving ? (
              <p className="text-secondary text-sm">Checking availability...</p>
            ) : isAvailable ? (
              <div className="flex items-center gap-2">
                <span className="bg-badge-green text-badge-green rounded-full px-2.5 py-0.5 text-xs font-medium">
                  Available
                </span>
                <span className="text-secondary text-sm">
                  {name}.{DEFAULT_TLD}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="bg-badge-red text-badge-red rounded-full px-2.5 py-0.5 text-xs font-medium">
                  Taken
                </span>
                <span className="text-secondary text-sm">
                  {name}.{DEFAULT_TLD} is owned by{" "}
                  <span className="font-mono text-xs">{owner}</span>
                </span>
              </div>
            )}

            {isAvailable && (
              <div className="flex items-center justify-between bg-input rounded-md p-3">
                <span className="text-secondary text-sm">Registration Fee</span>
                <span className="text-primary font-medium text-sm">
                  {feeLoading ? "..." : `${feeFormatted} EPIX`}
                </span>
              </div>
            )}
          </div>
        )}

        {!isConnected ? (
          <p className="text-warning text-sm">Connect your wallet to register a name.</p>
        ) : (
          <button
            onClick={handleRegister}
            disabled={!name || !isAvailable || isPending || isConfirming}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-md text-sm transition-colors"
          >
            {isPending
              ? "Confirming..."
              : isConfirming
                ? "Waiting for tx..."
                : `Register ${name || "..."}.${DEFAULT_TLD}`}
          </button>
        )}

        {isSuccess && hash && (
          <div className="bg-success rounded-md p-3 text-success text-sm">
            Name registered successfully!{" "}
            <a
              href={explorerTxUrl(hash)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              View transaction
            </a>
          </div>
        )}

        {error && (
          <div className="bg-error rounded-md p-3 text-error text-sm">
            Error: {error.message.split("\n")[0]}
          </div>
        )}
      </div>
    </div>
  );
}
