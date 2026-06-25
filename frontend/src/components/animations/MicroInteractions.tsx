"use client";

import { motion } from "framer-motion";

export const hoverScale = {
  whileHover: { scale: 1.03 },
  whileTap: { scale: 0.97 },
  transition: { type: "spring", stiffness: 400, damping: 17 },
};

export const hoverLift = {
  whileHover: { y: -2, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" },
  whileTap: { y: 0 },
  transition: { type: "spring", stiffness: 400, damping: 17 },
};

export const tapFeedback = {
  whileTap: { scale: 0.95 },
  transition: { duration: 0.1 },
};

export const pulse = {
  animate: {
    scale: [1, 1.05, 1],
    transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" },
  },
};

export const shimmer = {
  animate: {
    backgroundPosition: ["200% 0", "-200% 0"],
    transition: { duration: 2, repeat: Infinity, ease: "linear" },
  },
};

interface MotionCardProps {
  children: React.ReactNode;
  className?: string;
}

export function MotionCard({ children, className }: MotionCardProps) {
  return (
    <motion.div
      className={className}
      whileHover={{ y: -2, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      {children}
    </motion.div>
  );
}

interface MotionButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function MotionButton({ children, className, onClick }: MotionButtonProps) {
  return (
    <motion.button
      className={className}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      onClick={onClick}
    >
      {children}
    </motion.button>
  );
}
