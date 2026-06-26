"use client";

import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { ReactNode } from "react";

interface SlideInProps {
  children: ReactNode;
  className?: string;
  direction?: "left" | "right" | "top" | "bottom";
  delay?: number;
  duration?: number;
  distance?: number;
  once?: boolean;
}

export function SlideIn({
  children,
  className,
  direction = "left",
  delay = 0,
  duration = 0.5,
  distance = 100,
  once = true,
}: SlideInProps) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  const getInitial = () => {
    switch (direction) {
      case "left": return { x: -distance, opacity: 0 };
      case "right": return { x: distance, opacity: 0 };
      case "top": return { y: -distance, opacity: 0 };
      case "bottom": return { y: distance, opacity: 0 };
    }
  };

  return (
    <motion.div
      className={className}
      initial={getInitial()}
      whileInView={{ x: 0, y: 0, opacity: 1 }}
      viewport={{ once }}
      transition={{ duration, delay, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  );
}
