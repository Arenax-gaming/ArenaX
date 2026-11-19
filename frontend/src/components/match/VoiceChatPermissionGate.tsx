"use client";

/**
 * VoiceChatPermissionGate — microphone permission flow for the match lobby (#1564).
 *
 * Joining voice chat used to trigger the browser's native microphone prompt
 * with no context, and the lobby had no way to show whether access was
 * granted, denied, or still undecided. This component:
 *
 *  - Reads the current permission passively via the Permissions API on
 *    mount, so a grant (or denial) from a previous session is picked up
 *    without ever opening a prompt.
 *  - Only calls `getUserMedia` (which is what actually opens the browser's
 *    permission dialog) in direct response to the player clicking "Enable
 *    microphone" here — after the lobby has already explained why.
 *  - Always renders a Granted / Denied / Pending status indicator.
 *  - Shows a help tooltip with recovery instructions when access is denied.
 *  - Is a no-op (`required={false}`) for match types that don't use voice.
 */

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import { useVoiceChatPermission, type VoiceChatPermissionStatus } from "@/hooks/useMatches";

export interface VoiceChatPermissionGateProps {
  /**
   * Whether this match type uses voice chat at all. When `false`, the gate
   * renders nothing and immediately resolves — the step is skipped entirely.
   */
  required?: boolean;
  /**
   * Called exactly once the permission question is settled: either the
   * player granted or was denied access, or the step was skipped because
   * voice chat isn't required. The caller decides what to do with a
   * `"denied"` outcome (e.g. join the match without voice).
   */
  onResolved?: (status: VoiceChatPermissionStatus) => void;
  className?: string;
}

const STATUS_COPY: Record<
  VoiceChatPermissionStatus,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  granted: { label: "Granted", variant: "default" },
  denied: { label: "Denied", variant: "destructive" },
  prompt: { label: "Pending", variant: "secondary" },
};

export function VoiceChatPermissionGate({
  required = true,
  onResolved,
  className,
}: VoiceChatPermissionGateProps) {
  const { status, isSupported, requestPermission } = useVoiceChatPermission();
  const [requesting, setRequesting] = useState(false);
  // Guards against calling onResolved more than once across re-renders.
  const resolvedRef = useRef(false);

  const resolve = (value: VoiceChatPermissionStatus) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onResolved?.(value);
  };

  // Not required for this match type: the whole step is skippable.
  useEffect(() => {
    if (!required) resolve("granted");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required]);

  // Already decided — in this session or a previous one — via the
  // Permissions API. Nothing left to ask, so resolve without showing the
  // "Enable microphone" action.
  useEffect(() => {
    if (!required) return;
    if (status === "granted" || status === "denied") {
      resolve(status);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, status]);

  // This browser can't request microphone access in-page at all: treat it
  // the same as a denial rather than blocking the lobby forever.
  useEffect(() => {
    if (required && !isSupported) resolve("denied");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, isSupported]);

  if (!required) return null;

  const handleRequest = async () => {
    setRequesting(true);
    const result = await requestPermission();
    setRequesting(false);
    resolve(result);
  };

  const copy = STATUS_COPY[status];
  const indicator = <Badge variant={copy.variant}>{copy.label}</Badge>;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3",
        className
      )}
      role="group"
      aria-label="Voice chat microphone permission"
    >
      <div className="flex items-center gap-2">
        {status === "granted" ? (
          <Mic className="h-4 w-4 text-primary" aria-hidden="true" />
        ) : (
          <MicOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="text-sm font-medium">Voice chat microphone</span>
      </div>

      {status === "denied" ? (
        <Tooltip placement="top">
          <TooltipTrigger>{indicator}</TooltipTrigger>
          <TooltipContent className="max-w-[260px] whitespace-normal">
            Microphone access is blocked for this site. Click the lock or site-info
            icon in your browser&apos;s address bar, allow Microphone, then rejoin
            the match to use voice chat.
          </TooltipContent>
        </Tooltip>
      ) : (
        indicator
      )}

      {status === "prompt" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleRequest}
          loading={requesting}
          loadingLabel="Requesting…"
          disabled={!isSupported}
        >
          Enable microphone
        </Button>
      )}

      {!isSupported && status === "prompt" && (
        <span className="text-xs text-muted-foreground">
          This browser doesn&apos;t support in-page microphone requests.
        </span>
      )}
    </div>
  );
}

export default VoiceChatPermissionGate;
