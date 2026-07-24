"use client";

import React, { useState } from "react";
import { Keyboard, RotateCcw, Check, Save, Sparkles, Sliders } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { KeyBinding } from "@/types/settings";
import { keybindingPresets } from "@/data/settings";

interface KeyBindingsProps {
  controls: KeyBinding[];
  onUpdateKey: (action: string, key: string, isPrimary?: boolean, modifier?: "Ctrl" | "Shift" | "Alt" | "None") => void;
  onResetKey: (action: string) => void;
  onSave: () => Promise<boolean>;
  onApplyPreset?: (presetKey: string) => void;
  isSaving: boolean;
}

export function KeyBindings({
  controls,
  onUpdateKey,
  onResetKey,
  onSave,
  onApplyPreset,
  isSaving,
}: KeyBindingsProps) {
  const [listeningFor, setListeningFor] = useState<{
    action: string;
    isPrimary: boolean;
  } | null>(null);
  const [activePreset, setActivePreset] = useState<string>("qwerty");
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = async () => {
    const success = await onSave();
    if (success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const handleApplyPreset = (presetKey: string) => {
    setActivePreset(presetKey);
    const preset = keybindingPresets[presetKey];
    if (!preset) return;

    for (const [action, binding] of Object.entries(preset.bindings)) {
      if (binding) {
        onUpdateKey(action, binding.primaryKey, true, binding.modifier || "None");
      }
    }

    if (onApplyPreset) {
      onApplyPreset(presetKey);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: string, isPrimary: boolean) => {
    e.preventDefault();
    const key = e.key.toUpperCase();

    // Check if user pressed modifier key alone
    if (["CONTROL", "ALT", "SHIFT", "META", "CAPSLOCK"].includes(key)) {
      return;
    }

    let modifier: "Ctrl" | "Shift" | "Alt" | "None" = "None";
    if (e.ctrlKey) modifier = "Ctrl";
    else if (e.shiftKey) modifier = "Shift";
    else if (e.altKey) modifier = "Alt";

    onUpdateKey(action, key, isPrimary, modifier);
    setListeningFor(null);
  };

  const handleModifierChange = (action: string, modifier: "Ctrl" | "Shift" | "Alt" | "None", currentKey: string) => {
    onUpdateKey(action, currentKey, true, modifier);
  };

  const formatKey = (key: string) => {
    const keyMap: Record<string, string> = {
      " ": "SPACE",
      ESCAPE: "ESC",
      ARROWUP: "↑",
      ARROWDOWN: "↓",
      ARROWLEFT: "←",
      ARROWRIGHT: "→",
      ENTER: "↵",
      BACKSPACE: "⌫",
      DELETE: "DEL",
      TAB: "TAB",
    };
    return keyMap[key] || key;
  };

  const getActionIcon = (action: string) => {
    const actionIcons: Record<string, string> = {
      "Move Forward": "W",
      "Move Back": "S",
      "Move Left": "A",
      "Move Right": "D",
      Jump: "␣",
      Crouch: "Ctrl",
      Interact: "E",
      Reload: "R",
      "Use Ability 1": "Q",
      "Use Ability 2": "Shift",
      "Use Ultimate": "F",
      "Skill 1 (Primary)": "1",
      "Skill 2 (Secondary)": "2",
      "Skill 3 (Utility)": "3",
      "Skill 4 (Ultimate)": "4",
      "Skill Quick Boost": "Q",
      "Skill Quick Shield": "E",
      "Open Menu": "Esc",
      "Open Map": "M",
      "Open Scoreboard": "Tab",
      "Voice Chat": "V",
      Ping: "G",
    };
    return actionIcons[action] || "⌨";
  };

  const movementKeys = controls.filter((c) =>
    ["Move Forward", "Move Back", "Move Left", "Move Right"].includes(c.action)
  );

  const skillKeys = controls.filter((c) =>
    c.action.startsWith("Skill ") || c.action.startsWith("Use Ability") || c.action.includes("Ultimate")
  );

  const actionKeys = controls.filter(
    (c) =>
      !["Move Forward", "Move Back", "Move Left", "Move Right"].includes(c.action) &&
      !c.action.startsWith("Skill ") &&
      !c.action.startsWith("Use Ability") &&
      !c.action.includes("Ultimate") &&
      !["Open Menu", "Open Map", "Open Scoreboard"].includes(c.action)
  );

  const menuKeys = controls.filter((c) =>
    ["Open Menu", "Open Map", "Open Scoreboard"].includes(c.action)
  );

  const KeyBindingRow = ({ binding }: { binding: KeyBinding }) => (
    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors gap-3 flex-wrap sm:flex-nowrap">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 flex items-center justify-center bg-muted rounded-lg shrink-0">
          <span className="text-sm font-bold">{getActionIcon(binding.action)}</span>
        </div>
        <span className="text-sm font-medium">{binding.action}</span>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Modifier Selector */}
        <select
          value={binding.modifier || "None"}
          onChange={(e) =>
            handleModifierChange(
              binding.action,
              e.target.value as "Ctrl" | "Shift" | "Alt" | "None",
              binding.primaryKey
            )
          }
          className="text-xs bg-muted border border-border rounded px-2 py-1 focus:ring-1 focus:ring-primary min-h-[36px]"
          aria-label={`Modifier key for ${binding.action}`}
        >
          <option value="None">None</option>
          <option value="Shift">Shift +</option>
          <option value="Ctrl">Ctrl +</option>
          <option value="Alt">Alt +</option>
        </select>

        {/* Primary Key Button */}
        <div className="flex items-center gap-1">
          {listeningFor?.action === binding.action && listeningFor?.isPrimary ? (
            <input
              type="text"
              autoFocus
              onKeyDown={(e) => handleKeyDown(e, binding.action, true)}
              onBlur={() => setListeningFor(null)}
              className="w-20 px-2 py-1 text-center text-sm bg-primary/20 border-2 border-primary rounded-md focus:outline-none min-h-[36px]"
              placeholder="Press key..."
            />
          ) : (
            <button
              onClick={() => setListeningFor({ action: binding.action, isPrimary: true })}
              className="w-20 px-2 py-1 text-sm font-mono bg-muted hover:bg-muted-foreground/20 border rounded-md transition-colors min-h-[36px]"
            >
              {binding.modifier && binding.modifier !== "None" ? `${binding.modifier}+` : ""}
              {formatKey(binding.primaryKey)}
            </button>
          )}
        </div>

        <button
          onClick={() => onResetKey(binding.action)}
          className="p-2 hover:bg-muted rounded transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
          title="Reset to default"
          aria-label={`Reset keybinding for ${binding.action}`}
        >
          <RotateCcw className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Preset Selector Header */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-lg text-primary">
                <Sliders className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Keybinding Presets</CardTitle>
                <CardDescription>Select a layout profile suitable for your hardware</CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {Object.entries(keybindingPresets).map(([key, preset]) => (
                <Button
                  key={key}
                  variant={activePreset === key ? "primary" : "outline"}
                  size="sm"
                  onClick={() => handleApplyPreset(key)}
                  className="text-xs"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Skill Quick-Access Keybindings */}
      <Card className="border-amber-500/30">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Skill Quick-Access Bar</CardTitle>
              <CardDescription>Configure keybindings and modifiers for active skills</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {skillKeys.map((binding) => (
            <KeyBindingRow key={binding.action} binding={binding} />
          ))}
        </CardContent>
      </Card>

      {/* Movement Keys */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Keyboard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Movement</CardTitle>
              <CardDescription>Keys for character movement</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {movementKeys.map((binding) => (
            <KeyBindingRow key={binding.action} binding={binding} />
          ))}
        </CardContent>
      </Card>

      {/* Action Keys */}
      {actionKeys.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                <Keyboard className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>General Actions</CardTitle>
                <CardDescription>Keys for interactions and combat</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {actionKeys.map((binding) => (
              <KeyBindingRow key={binding.action} binding={binding} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Menu Keys */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Keyboard className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <CardTitle>Menu & Interface</CardTitle>
              <CardDescription>Keys for accessing menus and information</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {menuKeys.map((binding) => (
            <KeyBindingRow key={binding.action} binding={binding} />
          ))}
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center justify-end gap-3 pt-4">
        {saveSuccess && (
          <span className="text-sm text-emerald-400 flex items-center gap-1 font-medium">
            <Check className="h-4 w-4" />
            Keybindings saved successfully
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

export default KeyBindings;