let withPWA = (config) => config;
try {
  withPWA = require("next-pwa")({
    dest: "public",
    register: true,
    skipWaiting: true,
    disable: process.env.NODE_ENV === "development",
  });
} catch {
  console.warn("[next.config] next-pwa unavailable, running without PWA");
}

/**
 * Content Security Policy
 * Restricts resource loading to authorized origins.
 * 'unsafe-inline' and 'unsafe-eval' are required by Next.js 14 for inline styles
 * and script evaluation. Tighten with nonces when upgrading to App Router RSC fully.
 */
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Stellar network endpoints + WebSocket for real-time features
  "connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org https://*.stellar.org wss: ws:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
]
  .join("; ")
  .concat(";");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Image optimization for mobile
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [320, 420, 768, 1024, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      { protocol: "https", hostname: "api.dicebear.com", pathname: "/**" },
      { protocol: "https", hostname: "**" },
    ],
    loader: "custom",
    loaderFile: "./src/lib/imageLoader.ts",
  },
  compress: true,
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion", "recharts", "@tanstack/react-query"],
  },
  
  // Webpack configuration for code splitting
  webpack: (config, { isServer }) => {
    // Split chunks for better caching
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            // Framework chunks
            framework: {
              name: 'framework',
              chunks: 'all',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 40,
              enforce: true,
            },
            // UI library chunks
            ui: {
              name: 'ui',
              chunks: 'all',
              test: /[\\/]node_modules[\\/](@radix-ui|lucide-react|framer-motion)[\\/]/,
              priority: 35,
              enforce: true,
            },
            // Data fetching chunks
            data: {
              name: 'data',
              chunks: 'all',
              test: /[\\/]node_modules[\\/](@tanstack|react-query)[\\/]/,
              priority: 34,
              enforce: true,
            },
            // Chart library chunks
            charts: {
              name: 'charts',
              chunks: 'all',
              test: /[\\/]node_modules[\\/](recharts|d3-)[\\/]/,
              priority: 33,
              enforce: true,
            },
            // Stellar SDK chunks
            stellar: {
              name: 'stellar',
              chunks: 'all',
              test: /[\\/]node_modules[\\/](@stellar)[\\/]/,
              priority: 32,
              enforce: true,
            },
            // Library chunks
            lib: {
              test: /[\\/]node_modules[\\/]/,
              name(module) {
                const packageName = module.context.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/)[1];
                return `lib.${packageName.replace('@', '')}`;
              },
              priority: 30,
              minChunks: 2,
              reuseExistingChunk: true,
            },
            // Common chunks
            commons: {
              name: 'commons',
              chunks: 'all',
              minChunks: 2,
              priority: 20,
            },
          },
        },
        // Module IDs for better long-term caching
        moduleIds: 'deterministic',
        // Runtime chunk for better caching
        runtimeChunk: 'single',
      };
    }
    return config;
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl) {
      return [
        {
          source: "/api/:path*",
          destination: `${apiUrl}/api/:path*`,
        },
      ];
    }
    return [];
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/:path*",
        headers: [
          // ── Security headers ───────────────────────────────────────────
          {
            key: "Content-Security-Policy",
            value: ContentSecurityPolicy,
          },
          {
            // Prevent the page from being embedded in a frame (clickjacking)
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            // Prevent MIME-type sniffing
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            // Control referrer information sent with requests
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // Disable unused device capabilities
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            // Legacy XSS filter for older browsers
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            // Enforce HTTPS (2 years, include subdomains, preload-ready)
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // ── Cache headers ──────────────────────────────────────────────
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
          {
            key: "X-Device-Type",
            value: "desktop",
          },
        ],
      },
      {
        source: "/icons/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=2592000, immutable" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

module.exports = withPWA(nextConfig);
