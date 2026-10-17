"use client";

import { useEffect, useState } from "react";

export interface SponsorBrand {
  sponsor_id: string;
  asset_code: string;
  name: string;
  logo_url: string;
  color: string;
  pool: number;
}

function isBrand(value: unknown): value is SponsorBrand {
  if (!value || typeof value !== "object") return false;
  const brand = value as SponsorBrand;
  return (
    typeof brand.sponsor_id === "string" &&
    typeof brand.asset_code === "string" &&
    typeof brand.name === "string" &&
    typeof brand.logo_url === "string" &&
    brand.logo_url.startsWith("https://") &&
    typeof brand.color === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(brand.color)
  );
}

export function SponsorBrands() {
  const [brands, setBrands] = useState<SponsorBrand[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/sponsors", { credentials: "include" });
        if (!response.ok) return;
        const payload = (await response.json()) as unknown;
        if (!cancelled && Array.isArray(payload)) {
          setBrands(payload.filter(isBrand));
        }
      } catch {
        // The community page still renders when the sponsor API is down.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (brands.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="Sponsored tokens">
      <h2 className="text-sm font-semibold">Sponsored tokens</h2>
      <ul className="flex flex-wrap gap-3">
        {brands.map((brand) => (
          <li
            key={brand.sponsor_id}
            className="flex items-center gap-3 rounded-lg border px-3 py-2"
            style={{ borderColor: brand.color }}
          >
            <img
              src={brand.logo_url}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded"
            />
            <div>
              <div className="text-sm font-medium">{brand.name}</div>
              <div className="text-xs text-muted-foreground">
                {brand.asset_code} · {brand.pool.toLocaleString()} in pool
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
