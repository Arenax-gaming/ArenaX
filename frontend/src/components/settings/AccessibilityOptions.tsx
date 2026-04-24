"use client";

import React, { useState } from "react";
import {
  Eye,
  Type,
  Layout,
  Monitor,
  Volume2,
  Keyboard,
  Check,
  Save,
  Accessibility,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { AccessibilityOptions as AccessibilityOptionsType } from "@/types/settings";
import { colorblindModes } from "@/data/settings";

interface AccessibilityOptionsProps {
  settings: AccessibilityOptionsType;
  onUpdate: (updates: Partial<AccessibilityOptionsType>) => void;
  onSave: () => Promise<boolean>;
  isSaving: boolean;
}

export function AccessibilityOptions({
  settings,
  onUpdate,
  onSave,
  isSaving,
}: AccessibilityOptionsProps) {
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = async () => {
    const success = await onSave();
    if (success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const handleSliderChange = (
    field: keyof AccessibilityOptionsType,
    value: number,
    min: number,
    max: number
  ) => {
    const clampedValue = Math.min(max, Math.max(min, value));
    onUpdate({ [field]: clampedValue } as Partial<AccessibilityOptionsType>);
  };

  return (
    <div className="space-y-6">
      {/* Visual Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Eye className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <CardTitle>Visual Settings</CardTitle>
              <CardDescription>Adjust visual elements for better visibility</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* High Contrast Mode */}
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Monitor className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">High Contrast Mode</p>
                <p className="text-xs text-muted-foreground">
                  Increase contrast for better visibility
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.highContrastMode}
                onChange={(e) => onUpdate({ highContrastMode: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* Colorblind Mode */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              Colorblind Mode
            </label>
            <select
              value={settings.colorblindMode}
              onChange={(e) =>
                onUpdate({
                  colorblindMode: e.target.value as AccessibilityOptionsType["colorblindMode"],
                })
              }
              className="w-full px-4 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {colorblindModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label} - {mode.description}
                </option>
              ))}
            </select>
          </div>

          {/* Text Scale */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-2">
                <Type className="h-4 w-4 text-muted-foreground" />
                Text Scale
              </label>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                {settings.textScale}%
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="200"
              value={settings.textScale}
              onChange={(e) => handleSliderChange("textScale", parseInt(e.target.value), 50, 200)}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>50%</span>
              <span>200%</span>
            </div>
          </div>

          {/* UI Scale */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-2">
                <Layout className="h-4 w-4 text-muted-foreground" />
                UI Scale
              </label>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                {settings.uiScale}%
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="150"
              value={settings.uiScale}
              onChange={(e) => handleSliderChange("uiScale", parseInt(e.target.value), 50, 150)}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>50%</span>
              <span>150%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audio & Caption Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Volume2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <CardTitle>Audio & Captions</CardTitle>
              <CardDescription>Subtitle and audio accessibility options</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Subtitles */}
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Volume2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Subtitles</p>
                <p className="text-xs text-muted-foreground">
                  Display subtitles for dialogue and audio
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.subtitlesEnabled}
                onChange={(e) => onUpdate({ subtitlesEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.subtitlesEnabled && (
            <div className="pl-4 border-l-2 border-muted">
              <div className="space-y-2">
                <label className="text-sm font-medium">Subtitle Size</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["small", "medium", "large"] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => onUpdate({ subtitleSize: size })}
                      className={`px-3 py-2 rounded-md text-sm font-medium capitalize transition-colors ${
                        settings.subtitleSize === size
                          ? "bg-blue-500 text-white"
                          : "bg-muted hover:bg-muted/80"
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Motor Accessibility */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-lg">
              <Keyboard className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <CardTitle>Motor Accessibility</CardTitle>
              <CardDescription>Controls and input accessibility options</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Keyboard className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Custom Key Bindings</p>
                <p className="text-xs text-muted-foreground">
                  Customize keyboard shortcuts
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.customKeybindings}
                onChange={(e) => onUpdate({ customKeybindings: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Accessibility className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Sticky Keys</p>
                <p className="text-xs text-muted-foreground">
                  Allow modifier keys to be pressed separately
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.stickyKeys}
                onChange={(e) => onUpdate({ stickyKeys: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Cognitive Accessibility */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Monitor className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <CardTitle>Cognitive Accessibility</CardTitle>
              <CardDescription>Options to reduce cognitive load</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Monitor className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Reduce Motion</p>
                <p className="text-xs text-muted-foreground">
                  Minimize animations and motion effects
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.reducedMotion}
                onChange={(e) => onUpdate({ reducedMotion: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Accessibility className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Screen Reader Support</p>
                <p className="text-xs text-muted-foreground">
                  Enable screen reader compatibility
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.screenReaderSupport}
                onChange={(e) => onUpdate({ screenReaderSupport: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
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