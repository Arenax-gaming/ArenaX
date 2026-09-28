"use client";

/*
 * This component is a hand-rolled <picture> progressive loader (LQIP + blur-up +
 * WebP/fallback + IntersectionObserver lazy-loading). It intentionally uses raw
 * <img> elements — next/image cannot express the explicit <source> fallback and
 * blur-up sequence we need here — so the next/no-img-element rule is disabled.
 */
/* eslint-disable @next/next/no-img-element */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { generateImageSizes } from "@/lib/imageLoader";

/**
 * Progressive <Image /> — issue #927.
 *
 * Large images should never block page rendering. This component:
 *  - renders a Low Quality Image Placeholder (LQIP) first, then blurs-up to the
 *    full asset once it has decoded (see {@link LQIP_WIDTH} / {@link LQIP_QUALITY});
 *  - defers the real network request until the image scrolls near the viewport
 *    (IntersectionObserver based lazy-loading, bypassable with `priority`);
 *  - serves modern WebP with an automatic original-format fallback via <picture>;
 *  - reserves layout space (aspect-ratio / width+height) to avoid layout shift.
 *
 * The LQIP is requested at 32px / q20 which keeps it comfortably under the 50KB
 * budget from the acceptance criteria, and can be overridden with an explicit
 * `lqip` data URL when the caller already has one.
 */

/** Width (px) used to derive the LQIP from a remote source. */
export const LQIP_WIDTH = 32;
/** Quality (1-100) used to derive the LQIP from a remote source. */
export const LQIP_QUALITY = 20;
/** Default responsive widths generated for the srcset. */
const DEFAULT_WIDTHS = [320, 420, 768, 1024, 1280, 1536];

export interface ProgressiveImageProps
  extends Omit<
    React.ImgHTMLAttributes<HTMLImageElement>,
    "src" | "srcSet" | "placeholder" | "onLoad" | "loading"
  > {
  /** Image source. Remote (http/https) sources get responsive/WebP treatment. */
  src: string;
  /** Alternative text. Pass "" for decorative images. */
  alt: string;
  /** Explicit tiny placeholder (data URL or url). Overrides the derived LQIP. */
  lqip?: string;
  /** Shown if the main image fails to load. */
  fallbackSrc?: string;
  /** `sizes` attribute; defaults to a sensible responsive value. */
  sizes?: string;
  /** Quality for the full asset (1-100). Default 75. */
  quality?: number;
  /** Candidate widths for the generated srcset. */
  widths?: number[];
  /** Skip lazy-loading and fetch immediately (above-the-fold images). */
  priority?: boolean;
  /** IntersectionObserver rootMargin for lazy-loading. Default preloads 200px early. */
  rootMargin?: string;
  /** CSS aspect-ratio (e.g. "16 / 9") used to reserve space and prevent CLS. */
  aspectRatio?: string;
  /** object-fit for the rendered image. Default "cover". */
  objectFit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  /** Extra classes for the wrapper element. */
  wrapperClassName?: string;
  /** Called once the full image has loaded. */
  onLoad?: () => void;
}

const isRemote = (src: string) => /^https?:\/\//i.test(src);

// Literal class names so Tailwind's JIT scanner keeps them (dynamic
// `object-${fit}` strings would be purged from the production build).
const OBJECT_FIT_CLASS: Record<
  NonNullable<ProgressiveImageProps["objectFit"]>,
  string
> = {
  cover: "object-cover",
  contain: "object-contain",
  fill: "object-fill",
  none: "object-none",
  "scale-down": "object-scale-down",
};

/** Append CDN optimisation params to a remote URL. Mirrors lib/imageLoader. */
function withParams(
  url: string,
  { w, q, format }: { w?: number; q?: number; format?: "webp" | "auto" }
): string {
  try {
    const parsed = new URL(url);
    if (w) parsed.searchParams.set("w", String(w));
    if (q) parsed.searchParams.set("q", String(q));
    if (format) parsed.searchParams.set("f", format);
    return parsed.toString();
  } catch {
    return url;
  }
}

function buildSrcSet(
  src: string,
  widths: number[],
  quality: number,
  format: "webp" | "auto"
): string {
  return widths
    .map((w) => `${withParams(src, { w, q: quality, format })} ${w}w`)
    .join(", ");
}

export function ProgressiveImage({
  src,
  alt,
  lqip,
  fallbackSrc,
  sizes,
  quality = 75,
  widths = DEFAULT_WIDTHS,
  priority = false,
  rootMargin = "200px",
  aspectRatio,
  objectFit = "cover",
  className,
  wrapperClassName,
  onLoad,
  style,
  width,
  height,
  ...imgProps
}: ProgressiveImageProps) {
  const prefersReducedMotion = useReducedMotion();
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Start "in view" for priority images, or when IntersectionObserver is
  // unavailable (SSR / old browsers) so the image always eventually loads.
  const [inView, setInView] = useState(priority);
  const [loaded, setLoaded] = useState(false);
  // The currently-rendered source. Starts at `src`, may fall back once.
  const [currentSrc, setCurrentSrc] = useState(src);
  const [broken, setBroken] = useState(false);

  // Reset transient state whenever the caller swaps the source.
  useEffect(() => {
    setCurrentSrc(src);
    setLoaded(false);
    setBroken(false);
  }, [src]);

  const activeRemote = isRemote(currentSrc);

  // Derived LQIP: explicit prop wins, otherwise a tiny remote variant.
  const lqipSrc =
    lqip ??
    (activeRemote && !broken
      ? withParams(currentSrc, { w: LQIP_WIDTH, q: LQIP_QUALITY, format: "webp" })
      : undefined);

  const resolvedSizes = sizes ?? generateImageSizes();
  const webpSrcSet = activeRemote
    ? buildSrcSet(currentSrc, widths, quality, "webp")
    : undefined;
  const fallbackSrcSet = activeRemote
    ? buildSrcSet(currentSrc, widths, quality, "auto")
    : undefined;
  const fullSrc = activeRemote
    ? withParams(currentSrc, { q: quality, format: "auto" })
    : currentSrc;

  // Lazy-load: reveal the real <img> once the wrapper nears the viewport.
  useEffect(() => {
    if (inView) return;
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  const handleLoad = useCallback(() => {
    setLoaded(true);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    // Try the fallback once; if that also fails, show the broken state.
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
      setLoaded(false);
    } else {
      setBroken(true);
    }
  }, [fallbackSrc, currentSrc]);

  const showBrokenState = broken;
  const transitionClass = prefersReducedMotion
    ? ""
    : "transition-opacity duration-500 ease-out";

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative overflow-hidden bg-muted/40",
        wrapperClassName
      )}
      style={{
        aspectRatio,
        width,
        height,
        ...style,
      }}
      aria-busy={!loaded && !showBrokenState}
    >
      {/* LQIP / skeleton layer */}
      {!showBrokenState &&
        (lqipSrc ? (
          <img
            src={lqipSrc}
            alt=""
            aria-hidden="true"
            draggable={false}
            className={cn(
              "absolute inset-0 h-full w-full scale-110 blur-lg",
              OBJECT_FIT_CLASS[objectFit],
              transitionClass,
              loaded ? "opacity-0" : "opacity-100"
            )}
          />
        ) : (
          <div
            aria-hidden="true"
            className={cn(
              "absolute inset-0 h-full w-full",
              !loaded && !prefersReducedMotion && "animate-pulse",
              transitionClass,
              loaded ? "opacity-0" : "opacity-100"
            )}
          />
        ))}

      {/* Full image — only mounted once in view (lazy) */}
      {inView && !showBrokenState && (
        <picture>
          {webpSrcSet && (
            <source type="image/webp" srcSet={webpSrcSet} sizes={resolvedSizes} />
          )}
          {fallbackSrcSet && (
            <source srcSet={fallbackSrcSet} sizes={resolvedSizes} />
          )}
          <img
            {...imgProps}
            key={currentSrc}
            src={fullSrc}
            alt={alt}
            decoding="async"
            loading={priority ? "eager" : "lazy"}
            onLoad={handleLoad}
            onError={handleError}
            className={cn(
              "absolute inset-0 h-full w-full",
              OBJECT_FIT_CLASS[objectFit],
              transitionClass,
              loaded ? "opacity-100" : "opacity-0",
              className
            )}
          />
        </picture>
      )}

      {/* Broken-image state */}
      {showBrokenState && (
        <div
          role="img"
          aria-label={alt || "Image failed to load"}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground"
        >
          <ImageOff className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs">Image unavailable</span>
        </div>
      )}

      {/* No-JS fallback so the asset still renders without hydration. */}
      <noscript>
        <img
          src={fullSrc}
          alt={alt}
          className={cn("absolute inset-0 h-full w-full", OBJECT_FIT_CLASS[objectFit])}
        />
      </noscript>
    </div>
  );
}

/** Alias export — some call sites prefer the shorter name. */
export { ProgressiveImage as Image };

export default ProgressiveImage;
