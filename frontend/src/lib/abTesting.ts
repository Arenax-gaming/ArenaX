"use client";

import type { ABAssignment, ABExperiment, ABVariant } from "@/types/analytics";

const AB_STORAGE_KEY = "arenax:ab:assignments";

function loadAssignments(): Record<string, ABAssignment> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(AB_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ABAssignment>) : {};
  } catch {
    return {};
  }
}

function saveAssignments(assignments: Record<string, ABAssignment>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AB_STORAGE_KEY, JSON.stringify(assignments));
}

/**
 * Deterministically assign a user to a variant for a given experiment.
 * Uses a simple hash of userId + experimentId so the assignment is stable
 * across page loads before being persisted.
 */
function deterministicVariant(
  userId: string,
  experimentId: string,
  splitRatio: number
): ABVariant {
  const str = `${userId}:${experimentId}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  // Normalize to 0–1
  const normalized = (hash % 1000) / 1000;
  return normalized < splitRatio ? "variant" : "control";
}

export class ABTestingService {
  private assignments: Record<string, ABAssignment>;

  constructor() {
    this.assignments = loadAssignments();
  }

  /**
   * Get (or create and persist) the variant assignment for a user/experiment pair.
   */
  getVariant(experiment: ABExperiment, userId: string): ABVariant {
    const existing = this.assignments[experiment.id];
    if (existing) return existing.variant;

    const variant = deterministicVariant(userId, experiment.id, experiment.splitRatio);
    const assignment: ABAssignment = {
      experimentId: experiment.id,
      variant,
      assignedAt: Date.now(),
    };

    this.assignments[experiment.id] = assignment;
    saveAssignments(this.assignments);
    return variant;
  }

  getAssignment(experimentId: string): ABAssignment | null {
    return this.assignments[experimentId] ?? null;
  }

  getAllAssignments(): ABAssignment[] {
    return Object.values(this.assignments);
  }

  /** Clear all stored assignments (e.g., on logout). */
  clearAssignments(): void {
    this.assignments = {};
    if (typeof window !== "undefined") {
      localStorage.removeItem(AB_STORAGE_KEY);
    }
  }
}

let _abInstance: ABTestingService | null = null;

export function getABTestingService(): ABTestingService {
  if (!_abInstance) _abInstance = new ABTestingService();
  return _abInstance;
}
