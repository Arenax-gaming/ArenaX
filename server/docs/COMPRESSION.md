# API Compression with Brotli

## Overview

The ArenaX API now supports Brotli compression (br) for API responses, providing 15-25% better compression ratios than gzip while maintaining backward compatibility with gzip-only clients.

## Features

- **Brotli Compression**: Modern compression algorithm with superior compression ratios
- **Automatic Fallback**: Gracefully falls back to gzip for clients that don't support Brotli
- **Content Negotiation**: Automatically selects the best compression method based on client's `Accept-Encoding` header
- **Configurable**: Fine-tune compression settings via environment variables
- **Metrics Tracking**: Separate metrics for Brotli, gzip, and uncompressed responses
- **Threshold-based**: Only compresses responses above a configurable size threshold
- **Content-Type Filtering**: Excludes already-compressed content types (images, videos, archives)

## Configuration

### Environment Variables

| Variable | Description | Default | Range |
|----------|-------------|---------|-------|
| `COMPRESSION_ENABLE_BROTLI` | Enable/disable Brotli compression | `true` | `true`, `false` |
| `COMPRESSION_BROTLI_QUALITY` | Brotli compression quality (0-11) | `4` | `0-11` |
| `COMPRESSION_BROTLI_MODE` | Brotli mode (0=generic, 1=text, 2=font) | `0` | `0-2` |
| `COMPRESSION_LEVEL` | Gzip compression level (1-9) | `6` | `1-9` |
| `COMPRESSION_THRESHOLD_BYTES` | Minimum response size for compression | `1024` | `0-1048576` |
| `COMPRESSION_EXCLUDED_TYPES` | Comma-separated content-type prefixes to exclude | `image/,video/,audio/,font/,application/zip,...` | - |

### Example Configuration

```bash
# Enable Brotli with high compression for text content
COMPRESSION_ENABLE_BROTLI=true
COMPRESSION_BROTLI_QUALITY=6
COMPRESSION_BROTLI_MODE=1

# Set gzip fallback compression level
COMPRESSION_LEVEL=6

# Only compress responses larger than 1KB
COMPRESSION_THRESHOLD_BYTES=1024

# Exclude already-compressed content types
COMPRESSION_EXCLUDED_TYPES=image/,video/,audio/,font/,application/zip
```

## Compression Strategy

### Content Negotiation

The middleware follows this priority order when selecting compression:

1. **Brotli (br)**: Preferred if client supports it and Brotli is enabled
2. **gzip**: Fallback for clients that support gzip but not Brotli
3. **deflate**: Secondary fallback if supported
4. **identity**: No compression (for clients that don't support any compression)

### Threshold Logic

Responses smaller than `COMPRESSION_THRESHOLD_BYTES` are not compressed, as the compression overhead would exceed the bandwidth savings.

### Content-Type Exclusions

The following content types are excluded from compression by default:

- `image/*` - Images (already compressed)
- `video/*` - Videos (already compressed)
- `audio/*` - Audio files (already compressed)
- `font/*` - Font files (already compressed)
- `application/zip` - ZIP archives
- `application/gzip` - GZIP archives
- `application/x-gzip` - GZIP archives
- `application/x-tar` - TAR archives
- `application/x-bzip2` - BZIP2 archives
- `application/x-xz` - XZ archives
- `application/octet-stream` - Binary data
- `application/pdf` - PDF files

## Performance Impact

### CPU Usage

- **Brotli Quality 4**: ~15-20% more CPU than gzip level 6
- **Brotli Quality 6**: ~25-30% more CPU than gzip level 6
- **Brotli Quality 11**: ~50-60% more CPU than gzip level 6

### Bandwidth Savings

- **Brotli Quality 4**: 15-20% better compression than gzip level 6
- **Brotli Quality 6**: 20-25% better compression than gzip level 6
- **Brotli Quality 11**: 25-30% better compression than gzip level 6

### Recommended Settings

- **Development**: Brotli quality 4 (fast compression, good savings)
- **Production**: Brotli quality 6 (balanced compression/speed)
- **High-Bandwidth**: Brotli quality 11 (maximum compression, slower)

## Monitoring

### Metrics

The compression middleware records the following metrics:

- `compression_encoding_total`: Total number of responses by encoding type (br, gzip, identity)
- `compression_uncompressed_bytes_total`: Total uncompressed bytes
- `compression_compressed_bytes_total`: Total compressed bytes by encoding type
- `compression_ratio`: Compression ratio by encoding type

### Health Check

The compression status can be monitored via the existing health check endpoint:

```bash
GET /health
```

## Testing

### Manual Testing

Test Brotli compression with curl:

```bash
# Request with Brotli support
curl -H "Accept-Encoding: br" -I http://localhost:3000/api/endpoint

# Request with gzip support (fallback)
curl -H "Accept-Encoding: gzip" -I http://localhost:3000/api/endpoint

# Request without compression
curl -H "Accept-Encoding: identity" -I http://localhost:3000/api/endpoint
```

### Automated Testing

Run the compression middleware tests:

```bash
npm test -- compression.middleware.test.js
```

## Troubleshooting

### Brotli Not Working

1. Check that `COMPRESSION_ENABLE_BROTLI` is not set to `false`
2. Verify the client sends `Accept-Encoding: br` header
3. Check server logs for compression errors
4. Ensure the response size exceeds `COMPRESSION_THRESHOLD_BYTES`

### High CPU Usage

1. Reduce `COMPRESSION_BROTLI_QUALITY` (try 3 or 4)
2. Increase `COMPRESSION_THRESHOLD_BYTES` to skip small responses
3. Disable Brotli temporarily with `COMPRESSION_ENABLE_BROTLI=false`

### Compression Not Applied

1. Check if content type is in the exclusion list
2. Verify response size exceeds threshold
3. Check for `x-no-compression` header in request
4. Review server logs for compression errors

## Security Considerations

- **CRIME/BREACH Attacks**: Not applicable to this implementation as we don't use TLS compression
- **Memory Usage**: Brotli compression uses slightly more memory than gzip
- **DoS Protection**: The threshold setting prevents compression of very small responses
- **Input Validation**: All configuration values are clamped to safe ranges

## Migration Guide

### From gzip-only

No code changes required. Simply set the environment variables:

```bash
COMPRESSION_ENABLE_BROTLI=true
COMPRESSION_BROTLI_QUALITY=4
```

The middleware will automatically:
- Serve Brotli to clients that support it
- Fall back to gzip for older clients
- Maintain existing gzip configuration

### Disabling Brotli

To disable Brotli and use only gzip:

```bash
COMPRESSION_ENABLE_BROTLI=false
```

## References

- [Brotli Specification](https://tools.ietf.org/html/rfc7932)
- [Compression Middleware Source](../src/middleware/compression.middleware.ts)
- [Compression Tests](../test/compression.middleware.test.js)
