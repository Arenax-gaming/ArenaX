"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import QRCodeLib from "qrcode";

interface QRCodeProps {
  value: string;
  size?: number;
}

export function QRCode({ value, size = 180 }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !value) return;

    QRCodeLib.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(() => undefined);
  }, [value, size]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    const showCopied = () => {
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(showCopied).catch(() => {
        fallbackCopy(value, showCopied);
      });
    } else {
      fallbackCopy(value, showCopied);
    }
  }, [value]);

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        aria-label={`QR code for ${value}`}
        className="rounded-md"
      />
      <button
        type="button"
        onClick={handleCopy}
        className="text-sm px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 transition-colors"
      >
        {copied ? "Copied!" : "Copy address"}
      </button>
    </div>
  );
}

function fallbackCopy(text: string, onSuccess: () => void) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
    onSuccess();
  } finally {
    document.body.removeChild(textarea);
  }
}
