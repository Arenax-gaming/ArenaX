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

"use client";

import React, { useState } from "react";
import { ProfileCustomization } from "@/types/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Palette, Eye, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";

const AVAILABLE_BANNERS = [
  { key: "default", label: "Default", color: "#1e293b", gradient: "linear-gradient(135deg, #1e293b 0%, #334155 100%)" },
  { key: "sunset", label: "Sunset", color: "#f97316", gradient: "linear-gradient(135deg, #f97316 0%, #fb923c 50%, #fbbf24 100%)" },
  { key: "ocean", label: "Ocean", color: "#0ea5e9", gradient: "linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #0891b2 100%)" },
  { key: "forest", label: "Forest", color: "#22c55e", gradient: "linear-gradient(135deg, #22c55e 0%, #16a34a 50%, #15803d 100%)" },
  { key: "galaxy", label: "Galaxy", color: "#8b5cf6", gradient: "linear-gradient(135deg, #8b5cf6 0%, #a855f7 50%, #c084fc 100%)" },
  { key: "fire", label: "Fire", color: "#ef4444", gradient: "linear-gradient(135deg, #ef4444 0%, #f97316 50%, #fbbf24 100%)" },
  { key: "ice", label: "Ice", color: "#06b6d4", gradient: "linear-gradient(135deg, #06b6d4 0%, #0ea5e9 50%, #3b82f6 100%)" },
  { key: "neon", label: "Neon", color: "#10b981", gradient: "linear-gradient(135deg, #10b981 0%, #06d6a0 50%, #118ab2 100%)" },
];

const AVAILABLE_THEMES = [
  { key: "blue", label: "Blue", color: "#3b82f6", accent: "#1d4ed8" },
  { key: "purple", label: "Purple", color: "#8b5cf6", accent: "#7c3aed" },
  { key: "green", label: "Green", color: "#22c55e", accent: "#16a34a" },
  { key: "orange", label: "Orange", color: "#f97316", accent: "#ea580c" },
  { key: "red", label: "Red", color: "#ef4444", accent: "#dc2626" },
  { key: "pink", label: "Pink", color: "#ec4899", accent: "#db2777" },
  { key: "cyan", label: "Cyan", color: "#06b6d4", accent: "#0891b2" },
  { key: "yellow", label: "Yellow", color: "#eab308", accent: "#ca8a04" },
];

interface CustomizationOptionsProps {
  current: ProfileCustomization;
  onChange: (updated: ProfileCustomization) => void;
  onSave?: (customization: ProfileCustomization) => void;
  onReset?: () => void;
}

export function CustomizationOptions({ 
  current, 
  onChange, 
  onSave, 
  onReset 
}: CustomizationOptionsProps) {
  const [previewMode, setPreviewMode] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const selectedBanner = AVAILABLE_BANNERS.find((b) => b.key === current.banner) ?? AVAILABLE_BANNERS[0];
  const selectedTheme = AVAILABLE_THEMES.find((t) => t.key === current.colorTheme) ?? AVAILABLE_THEMES[0];

  const handleChange = (updated: ProfileCustomization) => {
    onChange(updated);
    setHasChanges(true);
  };

  const handleSave = () => {
    onSave?.(current);
    setHasChanges(false);
  };

  const handleReset = () => {
    onReset?.();
    setHasChanges(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Customization
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPreviewMode(!previewMode)}
            >
              <Eye className="h-4 w-4 mr-1" />
              {previewMode ? "Exit Preview" : "Preview"}
            </Button>
            {hasChanges && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReset}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                >
                  <Save className="h-4 w-4 mr-1" />
                  Save
                </Button>
              </>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Live Preview */}
        <div>
          <p className="text-sm font-medium mb-3">Live Preview</p>
          <div className={cn(
            "rounded-lg overflow-hidden border transition-all duration-300",
            previewMode && "scale-105 shadow-lg"
          )}>
            {/* Banner strip */}
            <div
              data-testid="preview-banner"
              className="h-20 w-full transition-all duration-300 relative overflow-hidden"
              style={{ background: selectedBanner.gradient }}
            >
              {/* Overlay pattern for texture */}
              <div className="absolute inset-0 opacity-20 bg-gradient-to-br from-white/10 to-transparent" />
              
              {/* Sample profile elements */}
              <div className="absolute bottom-2 left-4 flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/30" />
                <div className="text-white">
                  <div className="text-sm font-semibold">Player Name</div>
                  <div className="text-xs opacity-80">1,234 ELO</div>
                </div>
              </div>
            </div>
            
            {/* Theme accent bar */}
            <div
              data-testid="preview-theme"
              className="h-3 w-full transition-all duration-300"
              style={{ 
                background: `linear-gradient(90deg, ${selectedTheme.color} 0%, ${selectedTheme.accent} 100%)` 
              }}
            />
            
            {/* Content preview */}
            <div className="p-4 bg-muted/30">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium">Profile Stats</div>
                <div 
                  className="text-xs px-2 py-1 rounded-full text-white"
                  style={{ backgroundColor: selectedTheme.color }}
                >
                  Active Theme
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center p-2 rounded bg-background/50">
                  <div className="font-medium">Wins</div>
                  <div className="text-muted-foreground">42</div>
                </div>
                <div className="text-center p-2 rounded bg-background/50">
                  <div className="font-medium">Rank</div>
                  <div className="text-muted-foreground">#123</div>
                </div>
                <div className="text-center p-2 rounded bg-background/50">
                  <div className="font-medium">Streak</div>
                  <div className="text-muted-foreground">5</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-muted-foreground text-center">
                {selectedBanner.label} banner • {selectedTheme.label} theme
              </div>
            </div>
          </div>
        </div>

        {/* Banner Selection */}
        <div>
          <p className="text-sm font-medium mb-3">Profile Banner</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {AVAILABLE_BANNERS.map((banner) => (
              <button
                key={banner.key}
                type="button"
                aria-label={banner.label}
                aria-pressed={current.banner === banner.key}
                onClick={() => handleChange({ ...current, banner: banner.key })}
                className={cn(
                  "flex flex-col items-center gap-2 p-2 rounded-lg border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:scale-105",
                  current.banner === banner.key
                    ? "border-primary ring-2 ring-primary/30 shadow-md"
                    : "border-transparent hover:border-muted-foreground/30"
                )}
              >
                <div
                  className="w-full h-12 rounded overflow-hidden relative"
                  style={{ background: banner.gradient }}
                >
                  <div className="absolute inset-0 opacity-20 bg-gradient-to-br from-white/10 to-transparent" />
                </div>
                <span className="text-xs font-medium">{banner.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Theme Selection */}
        <div>
          <p className="text-sm font-medium mb-3">Accent Color</p>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
            {AVAILABLE_THEMES.map((theme) => (
              <button
                key={theme.key}
                type="button"
                aria-label={theme.label}
                aria-pressed={current.colorTheme === theme.key}
                onClick={() => handleChange({ ...current, colorTheme: theme.key })}
                className={cn(
                  "flex flex-col items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg p-2 transition-all hover:scale-110",
                  current.colorTheme === theme.key && "scale-110"
                )}
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-full border-4 transition-all relative overflow-hidden",
                    current.colorTheme === theme.key
                      ? "border-primary shadow-lg"
                      : "border-transparent hover:border-muted-foreground/30"
                  )}
                  style={{ 
                    background: `linear-gradient(135deg, ${theme.color} 0%, ${theme.accent} 100%)` 
                  }}
                >
                  {current.colorTheme === theme.key && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-3 h-3 rounded-full bg-white shadow-sm" />
                    </div>
                  )}
                </div>
                <span className="text-xs font-medium">{theme.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Customization Tips */}
        <div className="bg-muted/50 rounded-lg p-4">
          <h4 className="text-sm font-medium mb-2">Customization Tips</h4>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Choose a banner that reflects your gaming style</li>
            <li>• Accent colors appear in buttons, progress bars, and highlights</li>
            <li>• Use preview mode to see how your profile will look to others</li>
            <li>• Changes are saved automatically when you click Save</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
