"use client";

import React from "react";
import { Monitor, Zap, Volume2, Crosshair, MousePointer, Check, Settings } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { GamePreferences as GamePreferencesType } from "@/types/settings";
import {
  qualityPresets,
  frameRateOptions,
  resolutionOptions,
} from "@/data/settings";

interface GamePreferencesProps {
  settings: GamePreferencesType;
  onUpdate: (updates: Partial<GamePreferencesType>) => void;
  onSave: () => Promise<boolean>;
  isSaving: boolean;
}

export function GamePreferences({
  settings,
  onUpdate,
  onSave,
  isSaving,
}: GamePreferencesProps) {
  const [saveSuccess, setSaveSuccess] = React.useState(false);

  const handleSave = async () => {
    const success = await onSave();
    if (success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const handleSliderChange = (
    field: keyof GamePreferencesType,
    value: number,
    min: number,
    max: number
  ) => {
    const clampedValue = Math.min(max, Math.max(min, value));
    onUpdate({ [field]: clampedValue } as Partial<GamePreferencesType>);
  };

  return (
    <div className="space-y-6">
      {/* Graphics Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Monitor className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <CardTitle>Graphics</CardTitle>
              <CardDescription>Visual quality and display settings</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Quality Preset */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Quality Preset</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(Object.keys(qualityPresets) as Array<keyof typeof qualityPresets>).map((preset) => (
                <button
                  key={preset}
                  onClick={() => onUpdate({ quality: preset })}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    settings.quality === preset
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-muted hover:border-muted-foreground/50"
                  }`}
                >
                  <div className="text-xl mb-1">{qualityPresets[preset].icon}</div>
                  <div className="text-sm font-medium">{qualityPresets[preset].label}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {qualityPresets[preset].description}
                  </div>
                  {settings.quality === preset && (
                    <Check className="absolute top-2 right-2 h-4 w-4 text-blue-500" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              Resolution
            </label>
            <select
              value={settings.resolution}
              onChange={(e) => onUpdate({ resolution: e.target.value as GamePreferencesType["resolution"] })}
              className="w-full px-4 py-2.5 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {resolutionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Frame Rate */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              Frame Rate Limit
            </label>
            <div className="grid grid-cols-5 gap-2">
              {frameRateOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onUpdate({ frameRate: option.value as GamePreferencesType["frameRate"] })}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    settings.frameRate === option.value
                      ? "bg-blue-500 text-white"
                      : "bg-muted hover:bg-muted/80"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Fullscreen & VSync */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <p className="text-sm font-medium">Fullscreen</p>
                <p className="text-xs text-muted-foreground">Play in fullscreen mode</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.fullscreen}
                  onChange={(e) => onUpdate({ fullscreen: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <p className="text-sm font-medium">V-Sync</p>
                <p className="text-xs text-muted-foreground">Reduce screen tearing</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.vsync}
                  onChange={(e) => onUpdate({ vsync: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>

          {/* FOV Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-muted-foreground" />
                Field of View
              </label>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{settings.fov}°</span>
            </div>
            <input
              type="range"
              min="60"
              max="120"
              value={settings.fov}
              onChange={(e) => handleSliderChange("fov", parseInt(e.target.value), 60, 120)}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>60°</span>
              <span>120°</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audio Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Volume2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <CardTitle>Audio</CardTitle>
              <CardDescription>Volume and sound settings</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Master Volume */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Master Volume</label>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{settings.masterVolume}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.masterVolume}
              onChange={(e) => handleSliderChange("masterVolume", parseInt(e.target.value), 0, 100)}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>

          {/* Music Volume */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Music Volume</label>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{settings.musicVolume}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.musicVolume}
              onChange={(e) => handleSliderChange("musicVolume", parseInt(e.target.value), 0, 100)}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>

          {/* SFX Volume */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Sound Effects</label>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{settings.sfxVolume}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.sfxVolume}
              onChange={(e) => handleSliderChange("sfxVolume", parseInt(e.target.value), 0, 100)}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>

          {/* Voice Volume */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Voice Chat</label>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{settings.voiceVolume}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.voiceVolume}
              onChange={(e) => handleSliderChange("voiceVolume", parseInt(e.target.value), 0, 100)}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </CardContent>
      </Card>

      {/* Gameplay Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-lg">
              <MousePointer className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <CardTitle>Gameplay</CardTitle>
              <CardDescription>Controls and sensitivity settings</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Sensitivity */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-2">
                <MousePointer className="h-4 w-4 text-muted-foreground" />
                Mouse Sensitivity
              </label>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{settings.sensitivity}</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              value={settings.sensitivity}
              onChange={(e) => handleSliderChange("sensitivity", parseInt(e.target.value), 1, 100)}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Slow</span>
              <span>Fast</span>
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
          <Settings className="h-4 w-4 mr-2" />
          Save Changes
        </Button>
      </div>
    </div>
  );
}