"use client";

import React, { useEffect } from "react";

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      const loadAxe();
    }
  }, []);

  async function loadAxe() {
    try {
      const ReactDOM = require("react-dom");
      const axe = require("@axe-core/react");
      await axe(React, ReactDOM, 1000);
    } catch (error) {
      console.error("Failed to load axe accessibility checker");
    }
  }

  return <>{children}</>;
}
