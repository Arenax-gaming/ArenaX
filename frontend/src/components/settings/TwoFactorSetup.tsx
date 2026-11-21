"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  ShieldOff,
  Loader2,
  Copy,
  Check,
  KeyRound,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { QRCode } from "@/components/wallet/QRCode";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

type SetupStep = "idle" | "enrolling" | "confirming" | "backup-codes";

/**
 * Two-factor authentication (TOTP) setup flow for the security settings
 * page. Covers: status display, enable (QR + confirmation code + backup
 * codes), and disable (requires the current TOTP code). See issue #1560.
 */
export function TwoFactorSetup() {
  const { twoFactorEnabled, refreshTwoFactorStatus } = useAuth();

  const [step, setStep] = useState<SetupStep>("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  const resetFlow = () => {
    setStep("idle");
    setSecret(null);
    setOtpauthUrl(null);
    setConfirmCode("");
    setError(null);
  };

  // ── Enable flow ──────────────────────────────────────────────────────────

  const handleStartEnrollment = async () => {
    setError(null);
    setLoading(true);
    try {
      const { secret: newSecret, otpauthUrl: newUrl } = await api.setup2FA();
      setSecret(newSecret);
      setOtpauthUrl(newUrl);
      setStep("enrolling");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start 2FA setup",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmCode.trim().length < 6) {
      setError("Enter the 6-digit code from your authenticator app");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { backupCodes: codes } = await api.confirm2FA(confirmCode.trim());
      setBackupCodes(codes);
      setStep("backup-codes");
      await refreshTwoFactorStatus();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid confirmation code",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFinishSetup = () => {
    resetFlow();
    setBackupCodes([]);
  };

  const handleRegenerateBackupCodes = async () => {
    setError(null);
    setLoading(true);
    try {
      const { backupCodes: codes } = await api.regenerate2FABackupCodes();
      setBackupCodes(codes);
      setStep("backup-codes");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not regenerate backup codes",
      );
    } finally {
      setLoading(false);
    }
  };

  // ── Disable flow ─────────────────────────────────────────────────────────

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disableCode.trim().length < 6) {
      setError("Enter your current 6-digit authenticator code");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api.disable2FA(disableCode.trim());
      await refreshTwoFactorStatus();
      setShowDisableConfirm(false);
      setDisableCode("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not disable 2FA",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      // Clipboard API unavailable — silently ignore, the secret is still
      // visible on screen for manual entry.
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg ${
              twoFactorEnabled ? "bg-success/10" : "bg-muted"
            }`}
          >
            {twoFactorEnabled ? (
              <ShieldCheck className="h-5 w-5 text-success" />
            ) : (
              <ShieldOff className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div>
            <CardTitle>Two-Factor Authentication</CardTitle>
            <CardDescription>
              {twoFactorEnabled
                ? "Your account is protected with an authenticator app."
                : "Add an extra layer of security using a TOTP authenticator app."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Idle state: show current status + primary action */}
        {step === "idle" && !showDisableConfirm && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Status:{" "}
              <strong className={twoFactorEnabled ? "text-success" : ""}>
                {twoFactorEnabled ? "Enabled" : "Disabled"}
              </strong>
            </span>
            {twoFactorEnabled ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRegenerateBackupCodes}
                  loading={loading}
                  disabled={loading}
                >
                  Regenerate Backup Codes
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDisableConfirm(true)}
                >
                  Disable 2FA
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={handleStartEnrollment}
                loading={loading}
                disabled={loading}
              >
                Enable 2FA
              </Button>
            )}
          </div>
        )}

        {/* Disable confirmation */}
        {showDisableConfirm && (
          <form onSubmit={handleDisable} className="space-y-3">
            <p className="text-sm">
              Enter the current code from your authenticator app to disable
              two-factor authentication.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              placeholder="123456"
              aria-label="Current authenticator code"
              className="w-full px-4 py-2.5 bg-muted rounded-md text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowDisableConfirm(false);
                  setDisableCode("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                loading={loading}
                disabled={loading}
              >
                Confirm Disable
              </Button>
            </div>
          </form>
        )}

        {/* Enrolling: QR code + confirmation code input */}
        {step === "enrolling" && otpauthUrl && (
          <form onSubmit={handleConfirmCode} className="space-y-4">
            <div className="flex flex-col items-center gap-3 p-4 bg-muted/30 rounded-lg border">
              <QRCode value={otpauthUrl} size={180} />
              <p className="text-xs text-muted-foreground text-center">
                Scan this QR code with your authenticator app (e.g. Google
                Authenticator, Authy).
              </p>
              {secret && (
                <div className="flex items-center gap-2 text-xs">
                  <code className="px-2 py-1 bg-muted rounded font-mono">
                    {secret}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopySecret}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Copy secret key"
                  >
                    {copiedSecret ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="confirm-2fa-code"
                className="text-sm font-medium block mb-1.5"
              >
                Enter the 6-digit code to confirm
              </label>
              <input
                id="confirm-2fa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="123456"
                className="w-full px-4 py-2.5 bg-muted rounded-md text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetFlow}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={loading}
                disabled={loading}
              >
                Confirm & Activate
              </Button>
            </div>
          </form>
        )}

        {/* Backup codes: shown once after successful activation */}
        {step === "backup-codes" && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 text-sm">
              <KeyRound className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
              <p>
                Save these backup recovery codes somewhere safe. Each one can
                be used once to sign in if you lose access to your
                authenticator app. They will not be shown again.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((code) => (
                <code
                  key={code}
                  className="px-3 py-2 bg-muted rounded-md font-mono text-sm text-center"
                >
                  {code}
                </code>
              ))}
            </div>
            <div className="flex items-center justify-end">
              <Button type="button" variant="primary" onClick={handleFinishSetup}>
                I&apos;ve saved these codes
              </Button>
            </div>
          </div>
        )}

        {loading && step === "idle" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}
      </CardContent>
    </Card>
  );
}
