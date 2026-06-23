"use client";

/**
 * KeyboardShortcutsHelp — Issue #519
 *
 * Modal overlay listing all registered shortcuts grouped by category.
 * Opened via the `?` key or the `openHelp()` callback from useKeyboardShortcuts.
 */

import React, { useEffect } from "react";
import { cn } from "../../lib/utils";
import type { Shortcut, ShortcutCategory } from "../../hooks/useKeyboardShortcuts";

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  global: "Global",
  navigation: "Navigation",
  game: "Game",
  tournament: "Tournament",
  profile: "Profile",
};

interface KeyCapProps {
  combo: string;
}

function KeyCap({ combo }: KeyCapProps) {
  const parts = combo.split("+");
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-xs text-gray-400">+</span>}
          <kbd
            className={cn(
              "inline-flex items-center justify-center rounded border border-gray-600",
              "bg-gray-800 px-1.5 py-0.5 font-mono text-xs text-gray-200 shadow-sm",
            )}
          >
            {part}
          </kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

interface KeyboardShortcutsHelpProps {
  shortcuts: Shortcut[];
  customBindings: Record<string, string>;
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsHelp({
  shortcuts,
  customBindings,
  isOpen,
  onClose,
}: KeyboardShortcutsHelpProps) {
  // Close on backdrop click or Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Group shortcuts by category
  const grouped = shortcuts.reduce<Record<ShortcutCategory, Shortcut[]>>(
    (acc, s) => {
      if (!acc[s.category]) acc[s.category] = [];
      acc[s.category]!.push(s);
      return acc;
    },
    {} as Record<ShortcutCategory, Shortcut[]>,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Close shortcuts help"
          >
            ✕
          </button>
        </div>

        {/* Shortcut groups */}
        <div className="max-h-[60vh] overflow-y-auto space-y-5 pr-1">
          {(Object.keys(CATEGORY_LABELS) as ShortcutCategory[]).map((category) => {
            const items = grouped[category];
            if (!items || items.length === 0) return null;
            return (
              <section key={category}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-blue-400">
                  {CATEGORY_LABELS[category]}
                </h3>
                <ul className="space-y-1.5">
                  {items.map((s) => {
                    const effectiveKey = customBindings[s.id] ?? s.key;
                    const isCustom = Boolean(customBindings[s.id]);
                    return (
                      <li
                        key={s.id}
                        className="flex items-center justify-between gap-4 rounded px-2 py-1 hover:bg-gray-800"
                      >
                        <span className="text-sm text-gray-300">{s.description}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <KeyCap combo={effectiveKey} />
                          {isCustom && (
                            <span className="rounded bg-blue-900/50 px-1 py-0.5 text-xs text-blue-300">
                              custom
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Footer hint */}
        <p className="mt-4 text-center text-xs text-gray-500">
          Press <KeyCap combo="?" /> to toggle this panel
        </p>
      </div>
    </div>
  );
}
