/**
 * Unit tests for src/utils/sanitize.ts
 */
import {
  sanitizeHtml,
  sanitizeUrl,
  escapeHtml,
  sanitizeInput,
} from "../sanitize";

// ─── sanitizeHtml ─────────────────────────────────────────────────────────────
describe("sanitizeHtml", () => {
  it("returns plain text unchanged", () => {
    expect(sanitizeHtml("Hello, World!")).toBe("Hello, World!");
  });

  it("strips script tags", () => {
    const input = '<script>alert("xss")</script>Hello';
    expect(sanitizeHtml(input)).not.toContain("<script");
    expect(sanitizeHtml(input)).toContain("Hello");
  });

  it("strips script tags case-insensitively", () => {
    const input = '<SCRIPT>alert(1)</SCRIPT>';
    expect(sanitizeHtml(input)).not.toContain("<SCRIPT");
  });

  it("strips inline event handlers", () => {
    const input = '<div onclick="alert(1)">click me</div>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("onclick");
  });

  it("neutralises javascript: URIs", () => {
    const input = '<a href="javascript:alert(1)">link</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toMatch(/href="javascript:/i);
  });

  it("strips iframe tags", () => {
    const input = '<iframe src="https://evil.com"></iframe>';
    expect(sanitizeHtml(input)).not.toContain("<iframe");
  });

  it("strips embed and object tags", () => {
    expect(sanitizeHtml('<embed src="x">evil')).not.toContain("<embed");
    expect(sanitizeHtml('<object data="x">evil</object>')).not.toContain("<object");
  });

  it("returns empty string for non-string input", () => {
    expect(sanitizeHtml(null as unknown as string)).toBe("");
    expect(sanitizeHtml(undefined as unknown as string)).toBe("");
    expect(sanitizeHtml(42 as unknown as string)).toBe("");
  });

  it("returns empty string for an empty string", () => {
    expect(sanitizeHtml("")).toBe("");
  });

  it("preserves safe HTML tags", () => {
    const input = "<p>Hello <strong>World</strong></p>";
    const result = sanitizeHtml(input);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });
});

// ─── sanitizeUrl ─────────────────────────────────────────────────────────────
describe("sanitizeUrl", () => {
  it("allows https URLs", () => {
    expect(sanitizeUrl("https://arenax.gg/dashboard")).toBe("https://arenax.gg/dashboard");
  });

  it("allows http URLs", () => {
    expect(sanitizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("allows relative paths starting with /", () => {
    expect(sanitizeUrl("/tournaments")).toBe("/tournaments");
  });

  it("allows anchor-only URLs", () => {
    expect(sanitizeUrl("#section")).toBe("#section");
  });

  it("allows relative paths starting with .", () => {
    expect(sanitizeUrl("./profile")).toBe("./profile");
  });

  it("blocks javascript: URIs", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
  });

  it("blocks javascript: with mixed case", () => {
    expect(sanitizeUrl("JaVaScRiPt:alert(1)")).toBe("#");
  });

  it("blocks javascript: with whitespace", () => {
    expect(sanitizeUrl("  javascript:alert(1)")).toBe("#");
  });

  it("blocks vbscript: URIs", () => {
    expect(sanitizeUrl("vbscript:msgbox(1)")).toBe("#");
  });

  it("blocks data:text/html URIs", () => {
    expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
  });

  it("blocks data:application/ URIs", () => {
    expect(sanitizeUrl("data:application/javascript,alert(1)")).toBe("#");
  });

  it("returns '#' for empty string", () => {
    expect(sanitizeUrl("")).toBe("#");
  });

  it("returns '#' for non-string input", () => {
    expect(sanitizeUrl(null as unknown as string)).toBe("#");
    expect(sanitizeUrl(undefined as unknown as string)).toBe("#");
  });

  it("returns '#' for whitespace-only input", () => {
    expect(sanitizeUrl("   ")).toBe("#");
  });
});

// ─── escapeHtml ──────────────────────────────────────────────────────────────
describe("escapeHtml", () => {
  it("escapes &", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes <", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  it("escapes >", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });

  it("escapes backticks", () => {
    expect(escapeHtml("`code`")).toBe("&#x60;code&#x60;");
  });

  it("escapes equals signs", () => {
    expect(escapeHtml("a=b")).toBe("a&#x3D;b");
  });

  it("escapes a full XSS vector", () => {
    const xss = '<script>alert("xss")</script>';
    const escaped = escapeHtml(xss);
    expect(escaped).not.toContain("<script");
    expect(escaped).toContain("&lt;script&gt;");
  });

  it("returns empty string for non-string input", () => {
    expect(escapeHtml(null as unknown as string)).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("leaves plain text unchanged (no special chars)", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });
});

// ─── sanitizeInput ────────────────────────────────────────────────────────────
describe("sanitizeInput", () => {
  it("trims whitespace", () => {
    const result = sanitizeInput("  hello  ");
    // Trimmed then escaped — no leading/trailing spaces
    expect(result).not.toMatch(/^\s/);
    expect(result).not.toMatch(/\s$/);
  });

  it("truncates to default max length of 1000", () => {
    const long = "a".repeat(1100);
    const result = sanitizeInput(long);
    // After trimming and escaping 'a' (no special chars), length = 1000
    expect(result.length).toBeLessThanOrEqual(1000);
  });

  it("truncates to a custom max length", () => {
    const result = sanitizeInput("hello world", 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("escapes HTML entities in the input", () => {
    const result = sanitizeInput('<script>alert("xss")</script>');
    expect(result).not.toContain("<script");
    expect(result).toContain("&lt;");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeInput("")).toBe("");
  });

  it("returns empty string for non-string input", () => {
    expect(sanitizeInput(null as unknown as string)).toBe("");
  });

  it("handles a normal safe string without modification", () => {
    expect(sanitizeInput("ArenaX player")).toBe("ArenaX player");
  });
});
