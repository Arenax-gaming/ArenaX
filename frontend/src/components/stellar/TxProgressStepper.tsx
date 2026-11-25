"use client";

import React from "react";
import { CheckCircle2, Clock, AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { TxPhase, TxStatus } from "@/lib/wallet/types";
import { buildExplorerLink } from "@/lib/wallet/config";

export interface TxProgressStepperProps {
  status: TxStatus;
  phase?: TxPhase;
  hash?: string;
  kind?: "classic" | "soroban";
  reason?: string;
  title?: string;
  explorerUrl?: string;
  onDismiss?: () => void;
  className?: string;
}

export const STEPS = [
  { id: "submitted", label: "Submitted" },
  { id: "confirming", label: "Confirming" },
  { id: "confirmed", label: "Confirmed" },
] as const;

export function getActiveStepIndex(status: TxStatus, phase?: TxPhase): number {
  if (status === "failed") {
    // If it failed during signing or before submit, 0; if it was submitted/confirming, 1
    if (phase === "signing") return 0;
    return 1;
  }
  if (status === "success" || phase === "confirmed") {
    return 2;
  }
  if (phase === "confirming" || phase === "submitted") {
    return 1;
  }
  // Default pending or signing
  return 0;
}

export function TxProgressStepper({
  status,
  phase = "submitted",
  hash,
  kind = "classic",
  reason,
  title = "Stellar Transaction Progress",
  explorerUrl,
  onDismiss,
  className = "",
}: TxProgressStepperProps) {
  const activeIndex = getActiveStepIndex(status, phase);
  const effectiveExplorerUrl = explorerUrl || (hash ? buildExplorerLink(hash, kind) : undefined);

  return (
    <div
      data-testid="tx-progress-stepper"
      className={`rounded-xl border border-slate-700/60 bg-slate-900/90 p-5 shadow-2xl backdrop-blur-md text-slate-100 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h4 className="text-sm font-semibold tracking-wide text-slate-200">{title}</h4>
          {hash && (
            <p className="text-xs font-mono text-slate-400 mt-0.5 truncate max-w-[240px] sm:max-w-xs">
              Tx: {hash}
            </p>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
          >
            ✕
          </button>
        )}
      </div>

      {/* Stepper indicator bar */}
      <div className="flex items-center justify-between relative mb-6">
        <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-0.5 bg-slate-800 -z-0" />
        <div
          className="absolute left-6 top-1/2 -translate-y-1/2 h-0.5 bg-emerald-500 transition-all duration-500 -z-0"
          style={{
            width:
              status === "failed"
                ? `${(activeIndex / (STEPS.length - 1)) * 100}%`
                : `${(activeIndex / (STEPS.length - 1)) * 100}%`,
          }}
        />

        {STEPS.map((step, index) => {
          const isDone = status !== "failed" && index < activeIndex;
          const isCurrent = index === activeIndex;
          const isFailedStep = status === "failed" && isCurrent;

          let icon = <span className="text-xs font-bold">{index + 1}</span>;
          let circleBg = "border-slate-700 bg-slate-800 text-slate-400";

          if (isFailedStep) {
            circleBg = "border-red-500 bg-red-950/80 text-red-400 ring-4 ring-red-500/20";
            icon = <AlertCircle className="w-4 h-4" />;
          } else if (isDone || (isCurrent && status === "success")) {
            circleBg = "border-emerald-500 bg-emerald-950/80 text-emerald-400";
            icon = <CheckCircle2 className="w-4 h-4" />;
          } else if (isCurrent) {
            circleBg = "border-cyan-500 bg-cyan-950/80 text-cyan-300 ring-4 ring-cyan-500/20";
            icon = <Loader2 className="w-4 h-4 animate-spin" />;
          }

          return (
            <div key={step.id} className="flex flex-col items-center relative z-10">
              <div
                data-testid={`step-indicator-${step.id}`}
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${circleBg}`}
              >
                {icon}
              </div>
              <span
                className={`text-xs mt-2 font-medium tracking-wide ${
                  isFailedStep
                    ? "text-red-400 font-semibold"
                    : isCurrent
                    ? "text-cyan-300 font-semibold"
                    : isDone
                    ? "text-emerald-400"
                    : "text-slate-500"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Status Details / Failure State */}
      {status === "failed" ? (
        <div
          data-testid="tx-stepper-failed"
          className="rounded-lg border border-red-500/30 bg-red-950/40 p-3.5 text-xs text-red-200 mt-2 space-y-2"
        >
          <div className="flex items-center gap-2 font-semibold text-red-300">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>Transaction Failed</span>
          </div>
          {reason && <p className="text-red-200/90 pl-6">{reason}</p>}
          {hash && (
            <div className="pt-1 pl-6">
              <span className="text-slate-400">Hash: </span>
              <span className="font-mono text-red-300 break-all">{hash}</span>
            </div>
          )}
          {effectiveExplorerUrl && (
            <div className="pt-1 pl-6">
              <a
                href={effectiveExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-cyan-400 hover:text-cyan-300 underline"
              >
                <span>View on Stellar Expert</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      ) : status === "success" ? (
        <div
          data-testid="tx-stepper-confirmed"
          className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 p-3 text-xs text-emerald-200 mt-2 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Transaction confirmed on Stellar ledger!</span>
          </div>
          {effectiveExplorerUrl && (
            <a
              href={effectiveExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-emerald-300 hover:underline shrink-0"
            >
              <span>Stellar Expert</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      ) : (
        <div
          data-testid="tx-stepper-in-progress"
          className="flex items-center justify-between text-xs text-slate-400 bg-slate-800/40 rounded-lg p-2.5"
        >
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>
              {phase === "confirming"
                ? "Waiting for ledger close confirmation (polling every 2s)..."
                : "Transaction submitted to Stellar network..."}
            </span>
          </div>
          {effectiveExplorerUrl && (
            <a
              href={effectiveExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-cyan-400 hover:underline shrink-0"
            >
              <span>Explorer</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
