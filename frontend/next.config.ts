import withPWA, { type PWAConfig } from "next-pwa";

const pwaConfig = {
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  buildExcludes: [/app-build-manifest\.json$/],
  sw: "sw.js",
  fallbacks: {
    document: "/offline",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
};

const nextConfig = withPWA(pwaConfig)({
  // ...other Next.js config options
  reactStrictMode: true,
});

export default nextConfig;
