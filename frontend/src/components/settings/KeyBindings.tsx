"use client";

import React, { useState } from "react";
import { Keyboard, RotateCcw, Check, Save, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { KeyBinding } from "@/types/settings";

interface KeyBindingsProps {
  controls: KeyBinding[];
  onUpdateKey: (action: string, key: string, isPrimary: boolean) => void;
  onResetKey: (action: string) => void;
  onSave: () => Promise<boolean>;
  isSaving: boolean;
}

export function KeyBindings({
  controls,
  onUpdateKey,
  onResetKey,
  onSave,
  isSaving,
}: KeyBindingsProps) {
  const [listeningFor, setListeningFor] = useState<{
    action: string;
    isPrimary: boolean;
  } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = async () => {
    const success = await onSave();
    if (success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: string, isPrimary: boolean) => {
    e.preventDefault();
    const key = e.key.toUpperCase();

    // Don't allow certain keys
    if (["CONTROL", "ALT", "SHIFT", "META", "CAPSLOCK"].includes(key)) {
      return;
    }

    onUpdateKey(action, key, isPrimary);
    setListeningFor(null);
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
  const actionKeys = controls.filter(
    (c) =>
      !["Move Forward", "Move Back", "Move Left", "Move Right"].includes(c.action) &&
      !["Open Menu", "Open Map", "Open Scoreboard"].includes(c.action)
  );
  const menuKeys = controls.filter((c) =>
    ["Open Menu", "Open Map", "Open Scoreboard"].includes(c.action)
  );

  const KeyBindingRow = ({ binding }: { binding: KeyBinding }) => (
    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 flex items-center justify-center bg-muted rounded-lg">
          <span className="text-sm font-bold">{getActionIcon(binding.action)}</span>
        </div>
        <span className="text-sm font-medium">{binding.action}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {listeningFor?.action === binding.action && listeningFor?.isPrimary ? (
            <input
              type="text"
              autoFocus
              onKeyDown={(e) => handleKeyDown(e, binding.action, true)}
              onBlur={() => setListeningFor(null)}
              className="w-20 px-2 py-1 text-center text-sm bg-blue-500/20 border-2 border-blue-500 rounded-md focus:outline-none"
              placeholder="..."
            />
          ) : (
            <button
              onClick={() => setListeningFor({ action: binding.action, isPrimary: true })}
              className="w-20 px-2 py-1 text-sm font-mono bg-muted hover:bg-muted-foreground/20 border rounded-md transition-colors"
            >
              {formatKey(binding.primaryKey)}
            </button>
          )}
          <span className="text-xs text-muted-foreground">Primary</span>
        </div>

        {binding.secondaryKey && (
          <div className="flex items-center gap-1">
            {listeningFor?.action === binding.action && !listeningFor?.isPrimary ? (
              <input
                type="text"
                autoFocus
                onKeyDown={(e) => handleKeyDown(e, binding.action, false)}
                onBlur={() => setListeningFor(null)}
                className="w-20 px-2 py-1 text-center text-sm bg-blue-500/20 border-2 border-blue-500 rounded-md focus:outline-none"
                placeholder="..."
              />
            ) : (
              <button
                onClick={() => setListeningFor({ action: binding.action, isPrimary: false })}
                className="w-20 px-2 py-1 text-sm font-mono bg-muted hover:bg-muted-foreground/20 border rounded-md transition-colors"
              >
                {formatKey(binding.secondaryKey)}
              </button>
            )}
            <span className="text-xs text-muted-foreground">Alt</span>
          </div>
        )}

        <button
          onClick={() => onResetKey(binding.action)}
          className="p-1.5 hover:bg-muted rounded transition-colors"
          title="Reset to default"
        >
          <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Movement Keys */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Keyboard className="h-5 w-5 text-blue-500" />
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
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Keyboard className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <CardTitle>Actions</CardTitle>
              <CardDescription>Keys for in-game actions and abilities</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {actionKeys.map((binding) => (
            <KeyBindingRow key={binding.action} binding={binding} />
          ))}
        </CardContent>
      </Card>

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

      {/* Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tips</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Click on a key binding to change it, then press your desired key</li>
            <li>• You can set a secondary (alt) key for most actions</li>
            <li>• Use the reset button to restore default bindings</li>
            <li>• Avoid using modifier keys (Ctrl, Alt, Shift) as primary keys</li>
          </ul>
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