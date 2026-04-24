"use client";

import React from "react";
import { ProfileCustomization } from "@/types/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";

const AVAILABLE_BANNERS = [
  { key: "default", label: "Default", color: "#1e293b" },
  { key: "sunset", label: "Sunset", color: "#f97316" },
  { key: "ocean", label: "Ocean", color: "#0ea5e9" },
  { key: "forest", label: "Forest", color: "#22c55e" },
  { key: "galaxy", label: "Galaxy", color: "#8b5cf6" },
];

const AVAILABLE_THEMES = [
  { key: "blue", label: "Blue", color: "#3b82f6" },
  { key: "purple", label: "Purple", color: "#8b5cf6" },
  { key: "green", label: "Green", color: "#22c55e" },
  { key: "orange", label: "Orange", color: "#f97316" },
  { key: "red", label: "Red", color: "#ef4444" },
];

interface CustomizationOptionsProps {
  current: ProfileCustomization;
  onChange: (updated: ProfileCustomization) => void;
}

export function CustomizationOptions({ current, onChange }: CustomizationOptionsProps) {
  const selectedBanner = AVAILABLE_BANNERS.find((b) => b.key === current.banner) ?? AVAILABLE_BANNERS[0];
  const selectedTheme = AVAILABLE_THEMES.find((t) => t.key === current.colorTheme) ?? AVAILABLE_THEMES[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Customization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Live Preview */}
        <div>
          <p className="text-sm font-medium mb-2">Preview</p>
          <div className="rounded-lg overflow-hidden border">
            {/* Banner strip */}
            <div
              data-testid="preview-banner"
              className="h-16 w-full transition-colors duration-200"
              style={{ backgroundColor: selectedBanner.color }}
            />
            {/* Accent bar */}
            <div
              data-testid="preview-theme"
              className="h-2 w-full transition-colors duration-200"
              style={{ backgroundColor: selectedTheme.color }}
            />
            <div className="p-3 bg-muted/30 text-xs text-muted-foreground">
              {selectedBanner.label} banner · {selectedTheme.label} theme
            </div>
          </div>
        </div>

        {/* Banner Selection */}
        <div>
          <p className="text-sm font-medium mb-3">Profile Banner</p>
          <div className="grid grid-cols-5 gap-2">
            {AVAILABLE_BANNERS.map((banner) => (
              <button
                key={banner.key}
                type="button"
                aria-label={banner.label}
                aria-pressed={current.banner === banner.key}
                onClick={() => onChange({ ...current, banner: banner.key })}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-1.5 rounded-lg border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  current.banner === banner.key
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-transparent hover:border-muted-foreground/30"
                )}
              >
                <div
                  className="w-full h-10 rounded"
                  style={{ backgroundColor: banner.color }}
                />
                <span className="text-xs text-muted-foreground">{banner.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Theme Selection */}
        <div>
          <p className="text-sm font-medium mb-3">Color Theme</p>
          <div className="flex gap-4 flex-wrap">
            {AVAILABLE_THEMES.map((theme) => (
              <button
                key={theme.key}
                type="button"
                aria-label={theme.label}
                aria-pressed={current.colorTheme === theme.key}
                onClick={() => onChange({ ...current, colorTheme: theme.key })}
                className={cn(
                  "flex flex-col items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
                )}
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-full border-4 transition-all",
                    current.colorTheme === theme.key
                      ? "border-primary scale-110 shadow-md"
                      : "border-transparent hover:border-muted-foreground/30"
                  )}
                  style={{ backgroundColor: theme.color }}
                />
                <span className="text-xs text-muted-foreground">{theme.label}</span>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
