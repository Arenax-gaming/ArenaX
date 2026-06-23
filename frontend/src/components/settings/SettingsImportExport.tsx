/**
 * Settings import/export (#299).
 *
 * Lets a player back up their preferences (game / notifications /
 * privacy / accessibility / keybindings / theme) to a JSON blob and
 * restore them later. Export is a download; import is a file picker
 * that parses + validates the JSON before handing it to the parent's
 * onApply.
 *
 * The component is intentionally generic over the settings shape —
 * the parent owns the schema and validation; this component owns the
 * file plumbing + UX (download, picker, error states).
 */

"use client";

import React, { useCallback, useRef, useState } from "react";
import { Download, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";

export interface SettingsBundle<T = Record<string, unknown>> {
    /** Version of the export format — bump when the shape changes. */
    version: number;
    /** ISO 8601 timestamp the export was produced. */
    exportedAt: string;
    /** The actual settings payload. Caller defines the shape. */
    payload: T;
}

export interface SettingsImportExportProps<T = Record<string, unknown>> {
    /** Current settings to export. Called when the user clicks Export. */
    getSettings: () => T;
    /**
     * Called once an import file has been parsed + (optionally) passed
     * `validate`. Apply the settings to the store; throw to bail out
     * of the apply.
     */
    onApply: (payload: T) => void | Promise<void>;
    /** Optional validator — reject the import with a string reason. */
    validate?: (payload: unknown) => payload is T;
    /** Filename used for the download (default `arenax-settings.json`). */
    filename?: string;
    /** Bundle version emitted on export (default `1`). */
    bundleVersion?: number;
    className?: string;
}

/** Pure helper: build the JSON blob for export. Exported for tests. */
export const buildSettingsBundle = <T,>(
    payload: T,
    version: number = 1,
    now: () => Date = () => new Date()
): SettingsBundle<T> => ({
    version,
    exportedAt: now().toISOString(),
    payload,
});

/** Pure helper: parse + sanity-check an imported file. */
export const parseSettingsBundle = (raw: string): SettingsBundle<unknown> => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("File is not valid JSON.");
    }
    if (!parsed || typeof parsed !== "object") {
        throw new Error("Settings bundle must be an object.");
    }
    const bundle = parsed as Partial<SettingsBundle<unknown>>;
    if (typeof bundle.version !== "number") {
        throw new Error("Settings bundle is missing a numeric `version`.");
    }
    if (typeof bundle.payload !== "object" || bundle.payload === null) {
        throw new Error("Settings bundle is missing a `payload` object.");
    }
    if (typeof bundle.exportedAt !== "string") {
        throw new Error("Settings bundle is missing `exportedAt`.");
    }
    return bundle as SettingsBundle<unknown>;
};

export function SettingsImportExport<T = Record<string, unknown>>({
    getSettings,
    onApply,
    validate,
    filename = "arenax-settings.json",
    bundleVersion = 1,
    className,
}: SettingsImportExportProps<T>) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [status, setStatus] = useState<
        | { kind: "idle" }
        | { kind: "applied" }
        | { kind: "error"; message: string }
    >({ kind: "idle" });

    const handleExport = useCallback(() => {
        const bundle = buildSettingsBundle(
            getSettings(),
            bundleVersion
        );
        const blob = new Blob([JSON.stringify(bundle, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }, [getSettings, bundleVersion, filename]);

    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const readFileAsText = (file: File): Promise<string> => {
        // Prefer the modern File.text(); fall back to FileReader for
        // older jsdom / IE-shaped environments that still see traffic.
        if (typeof file.text === "function") {
            return file.text();
        }
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
                resolve(typeof reader.result === "string" ? reader.result : "");
            reader.onerror = () =>
                reject(reader.error ?? new Error("FileReader failed"));
            reader.readAsText(file);
        });
    };

    const handleFile = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                const text = await readFileAsText(file);
                const bundle = parseSettingsBundle(text);
                if (validate && !validate(bundle.payload)) {
                    throw new Error(
                        "Settings shape does not match the current app version."
                    );
                }
                await onApply(bundle.payload as T);
                setStatus({ kind: "applied" });
            } catch (err) {
                setStatus({
                    kind: "error",
                    message: err instanceof Error ? err.message : String(err),
                });
            } finally {
                // Reset the input so the same file can be re-selected.
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        },
        [onApply, validate]
    );

    return (
        <div
            className={
                "flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4" +
                (className ? ` ${className}` : "")
            }
        >
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={handleExport}
                    className="inline-flex items-center gap-1.5 rounded-md bg-amber-400/85 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-amber-400"
                >
                    <Download className="size-4" aria-hidden="true" />
                    Export
                </button>
                <button
                    type="button"
                    onClick={handleImportClick}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white/85 hover:bg-white/10"
                >
                    <Upload className="size-4" aria-hidden="true" />
                    Import
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleFile}
                    data-testid="settings-import-input"
                />
            </div>
            {status.kind === "applied" && (
                <p
                    role="status"
                    aria-live="polite"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300"
                >
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    Settings imported successfully.
                </p>
            )}
            {status.kind === "error" && (
                <p
                    role="alert"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-red-300"
                >
                    <AlertTriangle className="size-4" aria-hidden="true" />
                    {status.message}
                </p>
            )}
        </div>
    );
}

export default SettingsImportExport;
