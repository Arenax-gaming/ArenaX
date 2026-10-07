"use client";

/**
 * KeyboardShortcutsHelp — Issue #519
 *
 * Modal overlay listing all registered shortcuts grouped by category.
 * Opened via the `?` key or the `openHelp()` callback from useKeyboardShortcuts.
 * Accessibility: role="dialog", aria-modal, focus trapping, Escape / ? to close.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { Shortcut, ShortcutCategory } from "../../hooks/useKeyboardShortcuts";

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  global: "Global",
  navigation: "Navigation",
  game: "Game",
  tournament: "Tournament",
  profile: "Profile",
};

/** Built-in browser/form interactions surfaced for discoverability. */
const BUILT_IN_SHORTCUTS: Shortcut[] = [
  { id: "builtin_tab", description: "Move focus to next element", category: "navigation", key: "Tab" },
  { id: "builtin_shift_tab", description: "Move focus to previous element", category: "navigation", key: "Shift+Tab" },
  { id: "builtin_enter", description: "Join / submit focused action", category: "global", key: "Enter" },
];

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");

  const visibleShortcuts = useMemo(() => {
    const all = [...shortcuts, ...BUILT_IN_SHORTCUTS.filter((b) => !shortcuts.some((s) => s.id === b.id))];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) => {
      const key = (customBindings[s.id] ?? s.key).toLowerCase();
      return s.description.toLowerCase().includes(q) || key.includes(q);
    });
  }, [shortcuts, customBindings, query]);

  // Store the element that was focused before the modal opened
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    } else {
      setQuery("");
    }
  }, [isOpen]);

  // Focus the dialog container when it opens; restore focus when it closes
  useEffect(() => {
    if (!isOpen) {
      previousFocusRef.current?.focus();
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) return;

    // Move focus into the modal
    const firstFocusable = dialog.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();
  }, [isOpen]);

  // Focus trap + Escape / ? closes
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      // Close on Escape, or ? when not typing in the search field
      const typing = e.target instanceof HTMLInputElement;
      if (e.key === "Escape" || (e.key === "?" && !typing)) {
        e.preventDefault();
        onClose();
        return;
      }

      // Focus trap on Tab
      if (e.key === "Tab") {
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));

        if (focusable.length === 0) return;

        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Group shortcuts by category
  const grouped = visibleShortcuts.reduce<Record<ShortcutCategory, Shortcut[]>>(
    (acc, s) => {
      if (!acc[s.category]) acc[s.category] = [];
      acc[s.category]!.push(s);
      return acc;
    },
    {} as Record<ShortcutCategory, Shortcut[]>,
  );

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      {/* Backdrop — captures click-outside to close */}
      <button
        type="button"
        className="absolute inset-0 w-full h-full cursor-default focus:outline-none"
        aria-label="Close keyboard shortcuts"
        tabIndex={-1}
        onClick={onClose}
      />
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

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shortcuts…"
          aria-label="Search shortcuts"
          className="mb-4 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Shortcut groups */}
        <div className="max-h-[60vh] overflow-y-auto space-y-5 pr-1">
          {visibleShortcuts.length === 0 && (
            <p className="text-center text-sm text-gray-500">No shortcuts match “{query}”</p>
          )}
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
          Press <KeyCap combo="?" /> or <KeyCap combo="Escape" /> to close
        </p>
      </div>
    </div>
  );
}

