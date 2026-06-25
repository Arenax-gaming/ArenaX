import { routing, Locale } from "@/i18n/routing";

describe("i18n Routing", () => {
  it("should have correct locales", () => {
    expect(routing.locales).toEqual(["en", "es", "ar"]);
    expect(routing.defaultLocale).toBe("en");
  });

  it("should recognize RTL locales", () => {
    const rtlLocales: Locale[] = ["ar"];
    expect(rtlLocales.includes("ar")).toBe(true);
    expect(rtlLocales.includes("en")).toBe(false);
    expect(rtlLocales.includes("es")).toBe(false);
  });
});
