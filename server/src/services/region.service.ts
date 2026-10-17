/**
 * @fileoverview Multi-Region Service (Issue #1261)
 * @description Supports expanding ArenaX beyond Nigeria to Kenya, Ghana,
 * South Africa, United States, and Europe with local currencies and latency routing.
 */

export interface RegionConfig {
  code: string;
  name: string;
  currency: string;
  currencySymbol: string;
  serverEndpoint: string;
  isSupported: boolean;
}

export const SUPPORTED_REGIONS: Record<string, RegionConfig> = {
  NG: {
    code: "NG",
    name: "Nigeria",
    currency: "NGN",
    currencySymbol: "₦",
    serverEndpoint: "https://ng.arenax.gg",
    isSupported: true,
  },
  KE: {
    code: "KE",
    name: "Kenya",
    currency: "KES",
    currencySymbol: "KSh",
    serverEndpoint: "https://ke.arenax.gg",
    isSupported: true,
  },
  GH: {
    code: "GH",
    name: "Ghana",
    currency: "GHS",
    currencySymbol: "GH₵",
    serverEndpoint: "https://gh.arenax.gg",
    isSupported: true,
  },
  ZA: {
    code: "ZA",
    name: "South Africa",
    currency: "ZAR",
    currencySymbol: "R",
    serverEndpoint: "https://za.arenax.gg",
    isSupported: true,
  },
  US: {
    code: "US",
    name: "United States",
    currency: "USD",
    currencySymbol: "$",
    serverEndpoint: "https://us.arenax.gg",
    isSupported: true,
  },
  EU: {
    code: "EU",
    name: "Europe",
    currency: "EUR",
    currencySymbol: "€",
    serverEndpoint: "https://eu.arenax.gg",
    isSupported: true,
  },
};

/**
 * Resolves regional configuration for a user based on country code or IP geolocation.
 */
export function getRegionConfig(countryCode: string): RegionConfig {
  const code = countryCode.toUpperCase();
  return SUPPORTED_REGIONS[code] || SUPPORTED_REGIONS["US"]!;
}

/**
 * Validates if a given region code is supported.
 */
export function isRegionSupported(countryCode: string): boolean {
  const code = countryCode.toUpperCase();
  return Boolean(SUPPORTED_REGIONS[code]?.isSupported);
}
