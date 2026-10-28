/**
 * Clipboard helpers (Issue #1336).
 *
 * `navigator.clipboard` only exists on secure origins (HTTPS / localhost) and
 * can still reject (permissions, unfocused document). `copyToClipboard` tries
 * it first and falls back to a hidden-textarea `execCommand("copy")`, so
 * copying keeps working on plain-HTTP preview deployments.
 */

export type CopyMethod = "clipboard-api" | "textarea-fallback";

export class ClipboardCopyError extends Error {
  constructor(message = "Clipboard copy failed") {
    super(message);
    this.name = "ClipboardCopyError";
  }
}

// Browsers only expose `navigator.clipboard` on secure contexts, so its
// absence is how an insecure origin shows up here.
function canUseClipboardApi(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function"
  );
}

function copyWithTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";

  // Restore focus afterwards so keyboard users don't lose their place.
  const previouslyFocused = document.activeElement as HTMLElement | null;
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
    previouslyFocused?.focus?.();
  }
  return ok;
}

/**
 * Copy `text` to the clipboard. Resolves with the method that worked. If both
 * paths fail it rejects with the Clipboard API's own error when there was one
 * (e.g. "Permission denied"), otherwise with `ClipboardCopyError`.
 */
export async function copyToClipboard(text: string): Promise<CopyMethod> {
  let apiError: unknown = null;
  if (canUseClipboardApi()) {
    try {
      await navigator.clipboard.writeText(text);
      return "clipboard-api";
    } catch (caught) {
      // Fall through to the legacy path.
      apiError = caught;
    }
  }

  if (copyWithTextarea(text)) return "textarea-fallback";
  throw apiError instanceof Error ? apiError : new ClipboardCopyError();
}
