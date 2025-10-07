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
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "codmwstore.com", // Replace with the actual domain of your image source (e.g., 's3.amazonaws.com', 'images.unsplash.com')
        port: "", // Optional: Keep empty unless needed
        // pathname: "/images/**", // Optional: Specify a path if you want to limit access
      },
      {
        protocol: "https",
        hostname: "assets-prd.ignimgs.com", // Replace with the actual domain of your image source (e.g., 's3.amazonaws.com', 'images.unsplash.com')
        port: "", // Optional: Keep empty unless needed
        // pathname: "/images/**", // Optional: Specify a path if you want to limit access
      },
      {
        protocol: "https",
        hostname: "assets.goal.com", // Replace with the actual domain of your image source (e.g., 's3.amazonaws.com', 'images.unsplash.com')
        port: "", // Optional: Keep empty unless needed
        // pathname: "/images/**", // Optional: Specify a path if you want to limit access
      },
      // You can add more remote patterns here for different sources
    ],
  },
  reactStrictMode: true,
});

export default nextConfig;
