# Image Optimization Guide

This guide explains the image optimization implementation in ArenaX, which uses Next.js Image component with advanced features for performance.

## Features

### 1. Next/Image Integration
All images now use `next/image` component for automatic optimization:
- **WebP/AVIF Support**: Automatic format conversion to modern formats
- **Responsive Images**: Automatic generation of multiple sizes
- **Lazy Loading**: Images load only when needed
- **CDN Integration**: Custom loader for CDN optimization

### 2. Configuration

#### next.config.js
```javascript
images: {
  formats: ["image/avif", "image/webp"],
  deviceSizes: [320, 420, 768, 1024, 1200, 1920, 2048],
  imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  loader: "custom",
  loaderFile: "./src/lib/imageLoader.ts",
}
```

### 3. Usage Examples

#### Basic Image
```tsx
import Image from "next/image";

<Image
  src="/path/to/image.jpg"
  alt="Description"
  width={500}
  height={300}
  loading="lazy"
/>
```

#### Responsive Image with Sizes
```tsx
<Image
  src={avatarUrl}
  alt="User avatar"
  width={32}
  height={32}
  className="h-8 w-8 rounded-full"
  loading="lazy"
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
/>
```

#### Fill Container Image
```tsx
<div className="aspect-square relative">
  <Image
    src={imageUrl}
    alt="Description"
    fill
    className="object-cover"
    sizes="(max-width: 768px) 33vw, 25vw"
    loading="lazy"
  />
</div>
```

### 4. Custom Image Loader

The custom loader (`src/lib/imageLoader.ts`) adds CDN optimization:
- Automatic width/quality parameters
- Format conversion (auto WebP/AVIF)
- Cache-busting for dynamic content

### 5. Performance Benefits

- **Reduced Bandwidth**: Modern formats (WebP/AVIF) are 25-50% smaller
- **Faster Loading**: Lazy loading and responsive sizing
- **Better UX**: Images load progressively and adapt to screen size
- **CDN Caching**: 30-day cache TTL for optimized images

### 6. Best Practices

1. **Always use next/image** instead of `<img>` tags
2. **Specify width/height** or use `fill` with parent container
3. **Add appropriate alt text** for accessibility
4. **Use lazy loading** for below-fold images
5. **Provide sizes prop** for responsive images
6. **Use appropriate quality** (default 75, higher for photos)

### 7. Migration Checklist

- [x] Replace all `<img>` tags with `next/image`
- [x] Add responsive sizes where appropriate
- [x] Implement lazy loading
- [x] Configure WebP/AVIF support
- [x] Set up CDN loader
- [x] Add image testing
- [x] Document usage patterns

## Testing

Image optimization can be tested by:
1. Checking Network tab for WebP/AVIF responses
2. Verifying lazy loading with scroll
3. Testing responsive behavior across devices
4. Measuring LCP improvements in Lighthouse
