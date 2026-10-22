/**
 * Profile settings helpers (Issue #1396): avatar validation, CDN
 * cache-busting, crop geometry, and notification preference merging.
 */

import {
  AVATAR_MAX_BYTES,
  cdnAvatarUrl,
  defaultNotificationPreferences,
  mergeWithDefaults,
  validateAvatarFile,
} from "@/api/profileSettings";
import {
  clampOffset,
  initialCrop,
  pan,
  sourceRect,
  zoomAroundCenter,
} from "@/lib/avatarCrop";

describe("validateAvatarFile", () => {
  it("rejects types other than JPG/PNG", async () => {
    const gif = new Blob(["GIF89a"], { type: "image/gif" });
    await expect(validateAvatarFile(gif)).resolves.toBe("unsupported-type");
  });

  it("rejects files over 2 MB", async () => {
    const big = new Blob([new Uint8Array(AVATAR_MAX_BYTES + 1)], { type: "image/png" });
    await expect(validateAvatarFile(big)).resolves.toBe("too-large");
  });

  it("rejects empty files", async () => {
    await expect(validateAvatarFile(new Blob([], { type: "image/jpeg" }))).resolves.toBe("empty");
  });
});

describe("cdnAvatarUrl", () => {
  it("prefixes relative paths with the CDN and adds a version", () => {
    expect(cdnAvatarUrl("/avatars/u1.png", "abc123", "https://cdn.arenax.gg/")).toBe(
      "https://cdn.arenax.gg/avatars/u1.png?v=abc123"
    );
  });

  it("replaces an existing version and keeps other params", () => {
    expect(
      cdnAvatarUrl("https://cdn.arenax.gg/a.png?w=128&v=old", "new", undefined)
    ).toBe("https://cdn.arenax.gg/a.png?w=128&v=new");
  });

  it("leaves relative URLs relative without a CDN base", () => {
    expect(cdnAvatarUrl("/avatars/u1.png", "v2", undefined)).toBe("/avatars/u1.png?v=v2");
  });
});

describe("avatar crop geometry", () => {
  const V = 256;

  it("covers the viewport and centres a landscape image", () => {
    const crop = initialCrop(1000, 500, V);
    expect(crop.offsetY).toBe(0);
    expect(crop.offsetX).toBeCloseTo((V - 512) / 2);
    const rect = sourceRect(crop, 1000, 500, V);
    expect(rect.size).toBeCloseTo(500);
    expect(rect.sx).toBeCloseTo(250);
    expect(rect.sy).toBeCloseTo(0);
  });

  it("never pans past the image edge", () => {
    expect(clampOffset(50, 512, V)).toBe(0);
    expect(clampOffset(-1000, 512, V)).toBe(V - 512);
    const moved = pan(initialCrop(1000, 500, V), 10_000, 10_000, 1000, 500, V);
    expect(moved.offsetX).toBe(0);
    expect(moved.offsetY).toBe(0);
  });

  it("zooms around the centre and halves the crop size at 2x", () => {
    const start = initialCrop(800, 800, V);
    const zoomed = zoomAroundCenter(start, 2, 800, 800, V);
    const rect = sourceRect(zoomed, 800, 800, V);
    expect(rect.size).toBeCloseTo(400);
    expect(rect.sx).toBeCloseTo(200);
    expect(rect.sy).toBeCloseTo(200);
  });
});

describe("notification preferences", () => {
  it("fills missing events/channels with defaults", () => {
    const merged = mergeWithDefaults({ match_found: { email: true } });
    expect(merged.match_found.email).toBe(true);
    expect(merged.match_found.push).toBe(defaultNotificationPreferences().match_found.push);
    expect(merged.security["in-app"]).toBe(true);
  });

  it("ignores non-boolean values", () => {
    const merged = mergeWithDefaults({
      reward: { push: "yes" as unknown as boolean },
    });
    expect(merged.reward.push).toBe(defaultNotificationPreferences().reward.push);
  });
});
