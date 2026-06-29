"use client";

import { useLocale, useTranslations } from "next-intl";
import { routing, useRouter, usePathname } from "@/i18n/routing";
import { Button } from "./Button";
import { Languages } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const changeLanguage = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Languages className="h-4 w-4" />
          <span className="hidden md:inline">{locale.toUpperCase()}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-32 p-2">
        <div className="flex flex-col gap-1">
          {routing.locales.map((loc) => (
            <button
              key={loc}
              onClick={() => changeLanguage(loc)}
              className={`text-left px-2 py-1 rounded text-sm hover:bg-muted ${
                locale === loc ? "bg-muted font-medium" : ""
              }`}
            >
              {loc === "en" ? "English" : loc === "es" ? "Español" : "العربية"}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
