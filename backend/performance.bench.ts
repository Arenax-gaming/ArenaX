import { performance } from 'perf_hooks';

/**
 * Performance benchmarking utility for critical functions
 */
export async function benchmark(name: string, fn: () => Promise<void> | void) {
  const start = performance.now();
  await fn();
  const end = performance.now();
  const duration = end - start;

  console.log(`[BENCHMARK] ${name}: ${duration.toFixed(3)}ms`);
  
  // Validate SLA (e.g., ELO calculation must be < 5ms)
  if (name.includes('ELO') && duration > 5) {
    throw new Error(`Performance SLA Violation: ${name} took ${duration}ms`);
  }
  
  return duration;
}

// Usage in tests:
// it('should calculate ELO within SLA', async () => {
//   await benchmark('ELO_Calculation', () => calculateElo(1200, 1500, 1));
// });