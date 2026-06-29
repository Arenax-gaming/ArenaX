import { ImageLoaderProps } from 'next/image';

/**
 * Custom image loader for CDN support and optimization
 * Supports multiple CDN providers and automatic format optimization
 */
export default function imageLoader({ src, width, quality }: ImageLoaderProps): string {
  // If it's already a full URL, return it as-is
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return addCDNParams(src, width, quality);
  }

  // For local images, return the path as-is (Next.js handles these)
  return src;
}

/**
 * Add CDN optimization parameters to image URLs
 */
function addCDNParams(url: string, width?: number, quality?: number): string {
  const parsedUrl = new URL(url);
  
  // Add width parameter for responsive sizing
  if (width) {
    parsedUrl.searchParams.set('w', width.toString());
  }
  
  // Add quality parameter
  if (quality) {
    parsedUrl.searchParams.set('q', quality.toString());
  }
  
  // Add format parameter for automatic WebP/AVIF conversion
  parsedUrl.searchParams.set('f', 'auto');
  
  // Add cache-busting for dynamic content
  parsedUrl.searchParams.set('cb', Date.now().toString());
  
  return parsedUrl.toString();
}

/**
 * Generate responsive image sizes for next/image
 */
export function generateImageSizes(
  breakpoints: number[] = [640, 768, 1024, 1280, 1536]
): string {
  return breakpoints
    .map((bp, index) => {
      const maxWidth = index === breakpoints.length - 1 ? '100vw' : `${bp}px`;
      return `(max-width: ${bp}px) ${maxWidth}`;
    })
    .join(', ');
}

/**
 * Generate srcset for responsive images
 */
export function generateSrcSet(
  baseUrl: string,
  sizes: number[],
  quality: number = 75
): string {
  return sizes
    .map((size) => {
      const url = new URL(baseUrl);
      url.searchParams.set('w', size.toString());
      url.searchParams.set('q', quality.toString());
      url.searchParams.set('f', 'auto');
      return `${url.toString()} ${size}w`;
    })
    .join(', ');
}
