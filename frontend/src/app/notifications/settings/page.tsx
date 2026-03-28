"use client";

import type { ComponentType } from "react";
import { useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/contexts/NotificationContext";
import { NotificationType } from "@/types/notification";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

const preferenceConfig: Array<{
  type: NotificationType;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    type: "match",
    label: "Match updates",
    description: "Found matches, score changes, and dispute alerts.",
    icon: Trophy,
  },
  {
    type: "success",
    label: "Success",
    description: "Confirmed actions and positive outcomes.",
    icon: CheckCircle,
  },
  {
    type: "info",
    label: "Info",
    description: "General platform updates and helpful tips.",
    icon: Info,
  },
  {
    type: "warning",
    label: "Warnings",
    description: "Potential issues that might need attention.",
    icon: AlertTriangle,
  },
  {
    type: "error",
    label: "Errors",
    description: "Critical failures or blocked actions.",
    icon: AlertCircle,
  },
];

function PreferenceToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
        checked
          ? "bg-primary border-primary/60"
          : "bg-muted border-border"
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

export default function NotificationSettingsPage() {
  const { preferences, updatePreference, setAllPreferences } = useNotifications();

  const enabledCount = useMemo(
    () => preferenceConfig.filter((item) => preferences[item.type]).length,
    [preferences]
  );

  return (
    <div className="py-8 max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Card>
        <CardHeader>
          <CardTitle>Notification Settings</CardTitle>
          <CardDescription>
            Choose which alerts you want to receive in real time. These settings
            apply to new notifications only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {preferenceConfig.map((item) => {
            const Icon = item.icon;
            const enabled = preferences[item.type];
            return (
              <div
                key={item.type}
                className={cn(
                  "flex items-center justify-between gap-4 rounded-lg border px-4 py-3 transition-colors",
                  enabled ? "bg-card" : "bg-muted/40"
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 flex h-9 w-9 items-center justify-center rounded-md border",
                      enabled ? "border-primary/30 bg-primary/10" : "border-border"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", enabled ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
                <PreferenceToggle
                  checked={enabled}
                  onChange={(next) => updatePreference(item.type, next)}
                />
              </div>
            );
          })}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {enabledCount} of {preferenceConfig.length} categories enabled.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAllPreferences(false)}
            >
              Mute all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAllPreferences(true)}
            >
              Enable all
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
