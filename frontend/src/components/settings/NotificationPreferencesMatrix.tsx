"use client";

/**
 * Granular notification preferences (Issue #1396): every event × channel
 * (email, push, in-app) is a separate switch, saved via the API with toast
 * feedback.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Mail, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useNotifications } from "@/contexts/NotificationContext";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  defaultNotificationPreferences,
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationChannelKey,
  type NotificationEventKey,
  type NotificationPreferenceMatrix,
} from "@/api/profileSettings";

const QUERY_KEY = ["notificationPreferences"] as const;

const CHANNEL_META: Record<NotificationChannelKey, { label: string; icon: typeof Bell }> = {
  email: { label: "Email", icon: Mail },
  push: { label: "Push", icon: Smartphone },
  "in-app": { label: "In-app", icon: Bell },
};

function sameMatrix(a: NotificationPreferenceMatrix, b: NotificationPreferenceMatrix) {
  return NOTIFICATION_EVENTS.every(({ key }) =>
    NOTIFICATION_CHANNELS.every((channel) => a[key][channel] === b[key][channel])
  );
}

export function NotificationPreferencesMatrix() {
  const { addToast } = useNotifications();
  const queryClient = useQueryClient();
  const { data: saved, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getNotificationPreferences,
  });

  const [draft, setDraft] = useState<NotificationPreferenceMatrix>(defaultNotificationPreferences);
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);

  const isDirty = useMemo(() => (saved ? !sameMatrix(saved, draft) : false), [saved, draft]);

  const mutation = useMutation({
    mutationFn: saveNotificationPreferences,
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEY, result);
      addToast({
        type: "success",
        title: "Notification preferences saved",
        message: "We'll only notify you the way you chose.",
      });
    },
    onError: (error) => {
      addToast({
        type: "error",
        title: "Couldn't save preferences",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });

  const toggle = (event: NotificationEventKey, channel: NotificationChannelKey) =>
    setDraft((d) => ({ ...d, [event]: { ...d[event], [channel]: !d[event][channel] } }));

  const setChannel = (channel: NotificationChannelKey, enabled: boolean) =>
    setDraft((d) => {
      const next = { ...d };
      for (const { key } of NOTIFICATION_EVENTS) next[key] = { ...next[key], [channel]: enabled };
      return next;
    });

  if (isError) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">Couldn&apos;t load your notification preferences.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-busy={isLoading}>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Notification preferences by event and delivery channel
          </caption>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium text-foreground">
                Event
              </th>
              {NOTIFICATION_CHANNELS.map((channel) => {
                const { label, icon: Icon } = CHANNEL_META[channel];
                const allOn = NOTIFICATION_EVENTS.every(({ key }) => draft[key][channel]);
                return (
                  <th key={channel} scope="col" className="px-4 py-3 text-center font-medium">
                    <span className="flex items-center justify-center gap-1.5 text-foreground">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {label}
                    </span>
                    <button
                      type="button"
                      onClick={() => setChannel(channel, !allOn)}
                      disabled={isLoading}
                      className="mt-1 text-xs font-normal text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      {allOn ? `Turn off all ${label.toLowerCase()}` : `Turn on all ${label.toLowerCase()}`}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y">
            {NOTIFICATION_EVENTS.map(({ key, label, description }) => (
              <tr key={key}>
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <span className="block font-medium text-foreground">{label}</span>
                  <span className="block text-xs text-muted-foreground">{description}</span>
                </th>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const id = `pref-${key}-${channel}`;
                  return (
                    <td key={channel} className="px-4 py-3 text-center">
                      <input
                        id={id}
                        type="checkbox"
                        role="switch"
                        checked={draft[key][channel]}
                        onChange={() => toggle(key, channel)}
                        disabled={isLoading || mutation.isPending}
                        aria-label={`${label} via ${CHANNEL_META[channel].label}`}
                        className="h-4 w-4 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => saved && setDraft(saved)}
          disabled={!isDirty || mutation.isPending}
        >
          Discard changes
        </Button>
        <Button
          onClick={() => mutation.mutate(draft)}
          disabled={!isDirty || mutation.isPending}
          aria-busy={mutation.isPending}
        >
          {mutation.isPending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}

export default NotificationPreferencesMatrix;
