"use client";

import { useEffect } from "react";

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      import("@axe-core/react").then((axe) => {
        const ReactDOM = require("react-dom");
        const React = require("react");
        axe.default(React, ReactDOM, 1000);
      }).catch(() => {});
    }
  }, []);

  return <>{children}</>;
}
