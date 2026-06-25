"use client";

import { useLocale } from "next-intl";

export function useLocalization() {
  const locale = useLocale();

  const formatDate = (
    date: Date | string | number,
    options?: Intl.DateTimeFormatOptions
  ) => {
    const d = new Date(date);
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      ...options,
    }).format(d);
  };

  const formatTime = (
    date: Date | string | number,
    options?: Intl.DateTimeFormatOptions
  ) => {
    const d = new Date(date);
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "numeric",
      ...options,
    }).format(d);
  };

  const formatNumber = (
    num: number,
    options?: Intl.NumberFormatOptions
  ) => {
    return new Intl.NumberFormat(locale, options).format(num);
  };

  const formatCurrency = (
    amount: number,
    currency = "USD"
  ) => {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amount);
  };

  return {
    formatDate,
    formatTime,
    formatNumber,
    formatCurrency,
  };
}
