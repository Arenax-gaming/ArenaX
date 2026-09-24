"use client";

import React, { useCallback, useRef, useState } from "react";
import {
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { isEncryptedSettingsExport } from "@/lib/settingsCrypto";

type Status =
  | { kind: "idle" }
  | { kind: "exported"; encrypted: boolean }
  | { kind: "imported" }
  | { kind: "error"; message: string };

/**
 * Settings Backup (#1104).
 *
 * Exports the user's preferences to a JSON backup — optionally encrypted with
 * a passphrase (PBKDF2 + AES-256-GCM via the Web Crypto API). Import accepts
 * plain JSON backups as well as encrypted `.arenax` backups, requesting the
 * passphrase only when the file is encrypted.
 */
export function SettingsBackup() {
  const { exportSettings, importSettings, downloadSettings, isSaving } =
    useSettings();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [exportEncrypted, setExportEncrypted] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [importNeedPassphrase, setImportNeedPassphrase] = useState(false);
  const [pendingEncryptedText, setPendingEncryptedText] = useState<string | null>(
    null,
  );
  const [isWorking, setIsWorking] = useState(false);

  const readFileAsText = (file: File): Promise<string> =>
    typeof file.text === "function"
      ? file.text()
      : new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(typeof reader.result === "string" ? reader.result : "");
          reader.onerror = () =>
            reject(reader.error ?? new Error("FileReader failed"));
          reader.readAsText(file);
        });

  const handleExport = useCallback(async () => {
    if (exportEncrypted && passphrase !== confirmPassphrase) {
      setStatus({
        kind: "error",
        message: "Passphrases do not match.",
      });
      setPassphrase("");
      setConfirmPassphrase("");
      return;
    }
    if (exportEncrypted && !passphrase) {
      setStatus({ kind: "error", message: "Enter a passphrase." });
      return;
    }

    setIsWorking(true);
    try {
      await downloadSettings(exportEncrypted ? passphrase : undefined);
      setStatus({ kind: "exported", encrypted: exportEncrypted });
      setPassphrase("");
      setConfirmPassphrase("");
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Export failed. Please try again.",
      });
    } finally {
      setIsWorking(false);
    }
  }, [exportEncrypted, passphrase, confirmPassphrase, downloadSettings]);

  const applyImport = useCallback(
    async (text: string, passphrase: string | undefined) => {
      setStatus({ kind: "idle" });
      const ok = await importSettings(text, passphrase);
      if (!ok) {
        const encrypted = isEncryptedSettingsExport(text);
        setStatus({
          kind: "error",
          message: encrypted
            ? "Could not decrypt the backup. Check the passphrase."
            : "Not a valid settings backup file.",
        });
        return;
      }
      setStatus({ kind: "imported" });
      setImportPassphrase("");
      setPendingEncryptedText(null);
    },
    [importSettings],
  );

  const handleFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setIsWorking(true);
      setStatus({ kind: "idle" });
      setImportNeedPassphrase(false);
      setImportPassphrase("");

      try {
        const text = await readFileAsText(file);
        if (!text.trim()) {
          setStatus({ kind: "error", message: "The selected file is empty." });
          return;
        }

        const encrypted = isEncryptedSettingsExport(text);
        if (encrypted && !importPassphrase) {
          setPendingEncryptedText(text);
          setImportNeedPassphrase(true);
          return;
        }

        if (encrypted && importPassphrase) {
          setPendingEncryptedText(null);
        }
        await applyImport(text, importPassphrase || undefined);
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Import failed. Please try again.",
        });
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
        setIsWorking(false);
      }
    },
    [applyImport, importPassphrase],
  );

  const handleUnlockAndImport = async () => {
    if (!pendingEncryptedText) return;
    if (!importPassphrase) {
      setStatus({ kind: "error", message: "Enter the passphrase." });
      return;
    }
    setIsWorking(true);
    try {
      await applyImport(pendingEncryptedText, importPassphrase);
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Import failed. Please try again.",
      });
    } finally {
      setIsWorking(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFile(event);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Backup Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Export your game, notification, accessibility, and theme preferences so you
          can restore them on any device. Add a passphrase to encrypt the backup.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Export */}
        <section className="rounded-xl border bg-card p-6" aria-label="Export settings">
          <div className="flex items-center gap-2 mb-4">
            <Download className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Export</h3>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={exportEncrypted}
              onChange={(e) => {
                setExportEncrypted(e.target.checked);
                setStatus({ kind: "idle" });
              }}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span className="flex items-center gap-2 text-sm text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Protect with a passphrase
            </span>
          </label>

          {exportEncrypted && (
            <div className="space-y-3 mb-4">
              <div>
                <label
                  htmlFor="backup-passphrase"
                  className="text-sm font-medium text-foreground"
                >
                  Passphrase
                </label>
                <input
                  id="backup-passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Choose a passphrase"
                  className="mt-1 block w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="backup-confirm-passphrase"
                  className="text-sm font-medium text-foreground"
                >
                  Confirm Passphrase
                </label>
                <input
                  id="backup-confirm-passphrase"
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Repeat the passphrase"
                  className="mt-1 block w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                You must remember this passphrase — it cannot be recovered.
              </p>
            </div>
          )}

          <button
            onClick={handleExport}
            disabled={isWorking || isSaving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {exportEncrypted ? "Export Encrypted Backup" : "Export Plain Backup"}
          </button>
        </section>

        {/* Import */}
        <section
          className="rounded-xl border bg-card p-6"
          aria-label="Import settings"
        >
          <div className="flex items-center gap-2 mb-4">
            <Upload className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">Import</h3>
          </div>

          {importNeedPassphrase ? (
            <div className="space-y-3 mb-4">
              <p className="text-sm text-muted-foreground">
                This backup is encrypted. Enter the passphrase used when exporting.
              </p>
              <input
                type="password"
                value={importPassphrase}
                onChange={(e) => setImportPassphrase(e.target.value)}
                placeholder="Passphrase"
                className="block w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!importPassphrase || isWorking}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                Unlock &amp; Import
              </button>
            </div>
          ) : (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                Choose a settings backup file (`.json` or encrypted `.arenax`). Your
                current preferences are overwritten by the imported ones.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isWorking}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/60 disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                Choose Backup File
              </button>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.arenax,application/json,text/plain"
            className="hidden"
            onChange={handleFileSelect}
            data-testid="settings-backup-import-input"
          />
        </section>
      </div>

      {/* Status */}
      {status.kind === "exported" && (
        <p
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400"
        >
          <CheckCircle2 className="h-4 w-4" />
          {status.encrypted
            ? "Encrypted backup downloaded. Keep it and your passphrase safe."
            : "Settings backup downloaded."}
        </p>
      )}
      {status.kind === "imported" && (
        <p
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400"
        >
          <CheckCircle2 className="h-4 w-4" />
          Settings restored successfully.
        </p>
      )}
      {status.kind === "error" && (
        <p
          role="alert"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400"
        >
          <AlertTriangle className="h-4 w-4" />
          {status.message}
        </p>
      )}
    </div>
  );
}

export default SettingsBackup;