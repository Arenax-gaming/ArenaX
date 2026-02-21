"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { buildExplorerLink } from "@/lib/wallet/config";
import {
  sanitizeTxError,
  waitForTransactionConfirmation,
} from "@/lib/wallet/transactions";
import {
  TxDirection,
  TxHistoryItem,
  TxKind,
  TxMeta,
  TxPhase,
  TxStatus,
} from "@/lib/wallet/types";

const TX_HISTORY_STORAGE_KEY = "arenax_wallet_tx_history";
const MAX_HISTORY_ITEMS = 50;

interface ToastItem extends TxHistoryItem {
  title: string;
}

interface TrackTxHelpers {
  setPhase: (phase: TxPhase) => void;
}

interface TrackTxResult {
  hash: string;
  kind?: TxKind;
}

type TrackTxInput =
  | string
  | Promise<string | TrackTxResult>
  | ((helpers: TrackTxHelpers) => Promise<string | TrackTxResult>);

interface TrackTxMeta extends TxMeta {
  title?: string;
}

interface AppendHistoryArgs extends Omit<TxMeta, "kind"> {
  kind?: TxKind;
  status?: TxStatus;
  hash?: string;
  reason?: string;
}

interface TxStatusContextValue {
  toasts: ToastItem[];
  history: TxHistoryItem[];
  trackTx: (input: TrackTxInput, meta: TrackTxMeta) => Promise<string>;
  appendHistory: (entry: AppendHistoryArgs) => void;
  dismissToast: (id: string) => void;
  clearHistory: () => void;
}

const TxStatusContext = createContext<TxStatusContextValue | undefined>(undefined);

const buildId = () => {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const readHistory = (): TxHistoryItem[] => {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = localStorage.getItem(TX_HISTORY_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as TxHistoryItem[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
};

const writeHistory = (history: TxHistoryItem[]) => {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(TX_HISTORY_STORAGE_KEY, JSON.stringify(history));
};

export const TxStatusProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [history, setHistory] = useState<TxHistoryItem[]>(() => readHistory());

  const prependHistory = useCallback((entry: TxHistoryItem) => {
    setHistory((current) => {
      const next = [entry, ...current].slice(0, MAX_HISTORY_ITEMS);
      writeHistory(next);
      return next;
    });
  }, []);

  const appendHistory = useCallback(
    ({
      direction,
      asset,
      amount,
      hash,
      reason,
      kind = "classic",
      status = "pending",
    }: AppendHistoryArgs) => {
      const timestamp = new Date().toISOString();
      const explorerUrl = hash ? buildExplorerLink(hash, kind) : undefined;

      const entry: TxHistoryItem = {
        id: buildId(),
        direction,
        asset,
        amount,
        kind,
        status,
        hash,
        reason,
        explorerUrl,
        timestamp,
      };

      prependHistory(entry);
    },
    [prependHistory],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const updateToast = useCallback(
    (id: string, updater: (item: ToastItem) => ToastItem) => {
      setToasts((current) =>
        current.map((item) => {
          if (item.id !== id) {
            return item;
          }

          return updater(item);
        }),
      );
    },
    [],
  );

  const pushToast = useCallback((toast: ToastItem) => {
    setToasts((current) => [toast, ...current].slice(0, 6));
  }, []);

  const trackTx = useCallback(
    async (input: TrackTxInput, meta: TrackTxMeta) => {
      const id = buildId();
      const timestamp = new Date().toISOString();
      let phase: TxPhase = meta.kind === "soroban" ? "signing" : "submitted";
      let txKind = meta.kind;
      let txHash: string | undefined;

      pushToast({
        id,
        title: meta.title ?? "Transaction Pending",
        direction: meta.direction,
        asset: meta.asset,
        amount: meta.amount,
        kind: meta.kind,
        status: "pending",
        phase,
        timestamp,
      });

      const setPhase = (nextPhase: TxPhase) => {
        phase = nextPhase;
        updateToast(id, (item) => ({
          ...item,
          phase: nextPhase,
        }));
      };

      try {
        const response =
          typeof input === "function"
            ? await input({ setPhase })
            : typeof input === "string"
              ? input
              : await input;

        if (typeof response === "string") {
          txHash = response;
        } else {
          txHash = response.hash;
          txKind = response.kind ?? txKind;
        }

        if (!txHash) {
          throw new Error("Submitted transaction did not return a hash.");
        }

        if (phase === "signing") {
          setPhase("submitted");
        }

        const explorerUrl = buildExplorerLink(txHash, txKind);
        updateToast(id, (item) => ({
          ...item,
          hash: txHash,
          explorerUrl,
        }));

        await waitForTransactionConfirmation(txHash, txKind);

        setPhase("confirmed");

        updateToast(id, (item) => ({
          ...item,
          status: "success",
          hash: txHash,
          explorerUrl,
        }));

        const entry: TxHistoryItem = {
          id,
          direction: meta.direction,
          asset: meta.asset,
          amount: meta.amount,
          kind: txKind,
          status: "success",
          hash: txHash,
          explorerUrl,
          timestamp,
          phase: "confirmed",
        };

        prependHistory(entry);

        return txHash;
      } catch (error) {
        const reason = sanitizeTxError(error);

        updateToast(id, (item) => ({
          ...item,
          status: "failed",
          reason,
          hash: txHash,
          explorerUrl: txHash ? buildExplorerLink(txHash, txKind) : undefined,
        }));

        const entry: TxHistoryItem = {
          id,
          direction: meta.direction,
          asset: meta.asset,
          amount: meta.amount,
          kind: txKind,
          status: "failed",
          reason,
          hash: txHash,
          explorerUrl: txHash ? buildExplorerLink(txHash, txKind) : undefined,
          timestamp,
          phase,
        };

        prependHistory(entry);

        throw new Error(reason);
      }
    },
    [prependHistory, pushToast, updateToast],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    writeHistory([]);
  }, []);

  const value = useMemo<TxStatusContextValue>(
    () => ({
      toasts,
      history,
      trackTx,
      appendHistory,
      dismissToast,
      clearHistory,
    }),
    [toasts, history, trackTx, appendHistory, dismissToast, clearHistory],
  );

  return (
    <TxStatusContext.Provider value={value}>{children}</TxStatusContext.Provider>
  );
};

export const useTxStatus = () => {
  const context = useContext(TxStatusContext);

  if (!context) {
    throw new Error("useTxStatus must be used within TxStatusProvider");
  }

  return context;
};

export type { TrackTxInput, TrackTxMeta, TxStatusContextValue, ToastItem, TxDirection };
