"use client";

import React, { useState } from "react";
import { Sun, Moon, Monitor, Check, Save, Palette, Layout, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { ThemeSettings as ThemeSettingsType, AccentColor } from "@/types/settings";
import { accentColors } from "@/data/settings";

interface ThemeSelectorProps {
  settings: ThemeSettingsType;
  onUpdate: (updates: Partial<ThemeSettingsType>) => void;
  onSave: () => Promise<boolean>;
  isSaving: boolean;
}

export function ThemeSelector({
  settings,
  onUpdate,
  onSave,
  isSaving,
}: ThemeSelectorProps) {
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = async () => {
    const success = await onSave();
    if (success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const getThemeModeIcon = (mode: ThemeSettingsType["mode"]) => {
    switch (mode) {
      case "light":
        return <Sun className="h-5 w-5" />;
      case "dark":
        return <Moon className="h-5 w-5" />;
      case "system":
        return <Monitor className="h-5 w-5" />;
    }
  };

  const getThemeModeLabel = (mode: ThemeSettingsType["mode"]) => {
    switch (mode) {
      case "light":
        return "Light";
      case "dark":
        return "Dark";
      case "system":
        return "System";
    }
  };

  const getAccentColorPreview = (color: AccentColor) => {
    const colorMap: Record<AccentColor, string> = {
      blue: "bg-blue-500",
      purple: "bg-purple-500",
      green: "bg-green-500",
      orange: "bg-orange-500",
      red: "bg-red-500",
      pink: "bg-pink-500",
    };
    return colorMap[color];
  };

  return (
    <div className="space-y-6">
      {/* Theme Mode */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Monitor className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <CardTitle>Theme Mode</CardTitle>
              <CardDescription>Choose your preferred color theme</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {(["light", "dark", "system"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => onUpdate({ mode })}
                className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all ${
                  settings.mode === mode
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <div
                  className={`p-3 rounded-full ${
                    settings.mode === mode ? "bg-blue-500 text-white" : "bg-muted"
                  }`}
                >
                  {getThemeModeIcon(mode)}
                </div>
                <span className="text-sm font-medium">{getThemeModeLabel(mode)}</span>
                {settings.mode === mode && (
                  <div className="absolute top-3 right-3">
                    <Check className="h-4 w-4 text-blue-500" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Accent Color */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Palette className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <CardTitle>Accent Color</CardTitle>
              <CardDescription>Personalize your interface with a custom color</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            {accentColors.map((color) => (
              <button
                key={color.value}
                onClick={() => onUpdate({ accentColor: color.value as AccentColor })}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  settings.accentColor === color.value
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full ${color.hex} shadow-lg ${
                    settings.accentColor === color.value ? "ring-2 ring-blue-500 ring-offset-2" : ""
                  }`}
                />
                <span className="text-xs font-medium">{color.label}</span>
                {settings.accentColor === color.value && (
                  <Check className="absolute top-2 right-2 h-4 w-4 text-blue-500" />
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Display Options */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Layout className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <CardTitle>Display Options</CardTitle>
              <CardDescription>Adjust interface layout and animations</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Layout className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Compact Mode</p>
                <p className="text-xs text-muted-foreground">
                  Reduce spacing for more content on screen
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.compactMode}
                onChange={(e) => onUpdate({ compactMode: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Animations</p>
                <p className="text-xs text-muted-foreground">
                  Enable smooth transitions and animations
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.animationsEnabled}
                onChange={(e) => onUpdate({ animationsEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Preview Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`p-6 rounded-lg border-2 ${
              settings.mode === "dark"
                ? "bg-gray-900 border-gray-700"
                : settings.mode === "light"
                ? "bg-gray-100 border-gray-300"
                : "bg-gradient-to-br from-gray-100 to-gray-900 border-gray-400"
            }`}
          >
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full ${accentColors.find(c => c.value === settings.accentColor)?.hex}`} />
                <div className="space-y-1">
                  <div className={`h-3 w-32 rounded ${settings.mode === "dark" ? "bg-gray-700" : "bg-gray-300"}`} />
                  <div className={`h-2 w-24 rounded ${settings.mode === "dark" ? "bg-gray-800" : "bg-gray-200"}`} />
                </div>
              </div>
              <div className={`h-2 w-full rounded ${settings.mode === "dark" ? "bg-gray-800" : "bg-gray-200"}`} />
              <div className={`h-2 w-3/4 rounded ${settings.mode === "dark" ? "bg-gray-800" : "bg-gray-200"}`} />
              <div className="flex gap-2">
                <div className={`h-8 w-24 rounded ${accentColors.find(c => c.value === settings.accentColor)?.hex}`} />
                <div className={`h-8 w-20 rounded ${settings.mode === "dark" ? "bg-gray-800" : "bg-gray-200"}`} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center justify-end gap-3">
        {saveSuccess && (
          <span className="text-sm text-green-500 flex items-center gap-1">
            <Check className="h-4 w-4" />
            Settings saved successfully
          </span>
        )}
        <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={isSaving}>
          <Save className="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>
    </div>
  );
}