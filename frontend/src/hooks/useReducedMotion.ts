import { useReducedMotion as useFramerReducedMotion } from "framer-motion";

/**
 * Hook to detect if the user prefers reduced motion
 * Returns true if the user has enabled "Reduce Motion" in their OS settings
 */
export function useReducedMotion() {
  return useFramerReducedMotion();
}

/**
 * Helper to get animation props that respect reduced motion preferences
 * When reduced motion is enabled, animations are disabled or made instant
 */
export function useMotionProps(isEnabled: boolean = true) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion || !isEnabled) {
    return {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      transition: { duration: 0 },
    };
  }

  return {};
}
