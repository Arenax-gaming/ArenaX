"use client";

/**
 * useStateMachine — lightweight finite state machine for complex UI flows.
 *
 * Prevents impossible state transitions (e.g., submitting → idle without
 * going through success/error), making async UI logic predictable.
 *
 * Features:
 *  - Type-safe transitions — TypeScript rejects invalid state/event combos
 *  - Transition guards — predicates that block transitions conditionally
 *  - Entry/exit actions — side effects run on enter/leave a state
 *  - History — last N state transitions recorded for debugging
 *  - Works with any discriminated union state type
 *
 * @example
 * const machine = useStateMachine(matchFlowConfig, "idle");
 * machine.send("START");     // idle → loading
 * machine.send("SUCCESS");   // loading → active
 * machine.send("DISPUTE");   // active → disputed
 */

import { useReducer, useCallback, useRef, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StateValue = string;
export type EventType = string;

export interface Transition<S extends StateValue, E extends EventType> {
  /** The state this transition leads to. */
  target: S;
  /** Optional guard — if it returns false the transition is blocked. */
  guard?: (context: unknown) => boolean;
  /** Called synchronously after the transition fires. */
  action?: (from: S, to: S, context: unknown) => void;
}

export type TransitionMap<S extends StateValue, E extends EventType> = {
  [state in S]?: {
    [event in E]?: Transition<S, E>;
  };
};

export interface StateConfig<S extends StateValue, E extends EventType> {
  /** All valid transitions indexed by [currentState][event]. */
  transitions: TransitionMap<S, E>;
  /** Called when any state is entered. */
  onEnter?: (state: S, context: unknown) => void;
  /** Called when any state is exited. */
  onExit?: (state: S, context: unknown) => void;
  /** Max history entries to keep (default 20). */
  historyLimit?: number;
}

export interface HistoryEntry<S extends StateValue, E extends EventType> {
  from: S;
  to: S;
  event: E;
  timestamp: number;
}

export interface UseStateMachineResult<S extends StateValue, E extends EventType> {
  /** Current state. */
  state: S;
  /** Send an event to the machine. Returns true if the transition fired. */
  send: (event: E, context?: unknown) => boolean;
  /** Returns true if the given event would trigger a transition from the current state. */
  can: (event: E, context?: unknown) => boolean;
  /** Returns true if the machine is in the given state. */
  is: (state: S) => boolean;
  /** All valid events from the current state. */
  availableEvents: E[];
  /** Last N transitions. */
  history: HistoryEntry<S, E>[];
  /** Reset the machine to the initial state. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

interface MachineState<S extends StateValue, E extends EventType> {
  current: S;
  history: HistoryEntry<S, E>[];
}

type MachineAction<S extends StateValue, E extends EventType> =
  | { type: "TRANSITION"; from: S; to: S; event: E }
  | { type: "RESET"; initial: S };

function machineReducer<S extends StateValue, E extends EventType>(
  state: MachineState<S, E>,
  action: MachineAction<S, E>,
  historyLimit: number
): MachineState<S, E> {
  switch (action.type) {
    case "TRANSITION": {
      const entry: HistoryEntry<S, E> = {
        from: action.from,
        to: action.to,
        event: action.event,
        timestamp: Date.now(),
      };
      return {
        current: action.to,
        history: [...state.history, entry].slice(-historyLimit),
      };
    }
    case "RESET":
      return { current: action.initial, history: [] };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStateMachine<S extends StateValue, E extends EventType>(
  config: StateConfig<S, E>,
  initialState: S
): UseStateMachineResult<S, E> {
  const historyLimit = config.historyLimit ?? 20;

  const [machineState, dispatch] = useReducer(
    (state: MachineState<S, E>, action: MachineAction<S, E>) =>
      machineReducer(state, action, historyLimit),
    { current: initialState, history: [] }
  );

  // Keep config in a ref so callbacks always get the latest version
  const configRef = useRef(config);
  configRef.current = config;

  const send = useCallback(
    (event: E, context?: unknown): boolean => {
      const { transitions, onEnter, onExit } = configRef.current;
      const from = machineState.current;
      const stateTransitions = transitions[from];
      if (!stateTransitions) return false;

      const transition = stateTransitions[event];
      if (!transition) return false;

      // Run guard
      if (transition.guard && !transition.guard(context ?? null)) return false;

      const to = transition.target;

      // Run exit action
      onExit?.(from, context ?? null);

      // Run transition action
      transition.action?.(from, to, context ?? null);

      // Dispatch state change
      dispatch({ type: "TRANSITION", from, to, event });

      // Run entry action
      onEnter?.(to, context ?? null);

      return true;
    },
    [machineState.current]
  );

  const can = useCallback(
    (event: E, context?: unknown): boolean => {
      const { transitions } = configRef.current;
      const stateTransitions = transitions[machineState.current];
      if (!stateTransitions) return false;
      const transition = stateTransitions[event];
      if (!transition) return false;
      if (transition.guard && !transition.guard(context ?? null)) return false;
      return true;
    },
    [machineState.current]
  );

  const is = useCallback(
    (state: S): boolean => machineState.current === state,
    [machineState.current]
  );

  const availableEvents = useMemo<E[]>(() => {
    const { transitions } = configRef.current;
    const stateTransitions = transitions[machineState.current];
    if (!stateTransitions) return [];
    return Object.keys(stateTransitions) as E[];
  }, [machineState.current]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET", initial: initialState });
  }, [initialState]);

  return {
    state: machineState.current,
    send,
    can,
    is,
    availableEvents,
    history: machineState.history,
    reset,
  };
}

// ---------------------------------------------------------------------------
// Pre-built match flow machine config (exported as a convenience)
// ---------------------------------------------------------------------------

export type MatchState =
  | "idle"
  | "loading"
  | "active"
  | "reporting"
  | "disputed"
  | "completed"
  | "error";

export type MatchEvent =
  | "LOAD"
  | "LOADED"
  | "LOAD_FAIL"
  | "REPORT"
  | "REPORT_SUBMITTED"
  | "DISPUTE"
  | "RESOLVE"
  | "COMPLETE"
  | "RETRY"
  | "RESET";

export const MATCH_FLOW_CONFIG: StateConfig<MatchState, MatchEvent> = {
  transitions: {
    idle: {
      LOAD: { target: "loading" },
    },
    loading: {
      LOADED: { target: "active" },
      LOAD_FAIL: { target: "error" },
    },
    active: {
      REPORT: { target: "reporting" },
      DISPUTE: { target: "disputed" },
      COMPLETE: { target: "completed" },
    },
    reporting: {
      REPORT_SUBMITTED: { target: "active" },
      DISPUTE: { target: "disputed" },
    },
    disputed: {
      RESOLVE: { target: "active" },
      COMPLETE: { target: "completed" },
    },
    completed: {},
    error: {
      RETRY: { target: "loading" },
      RESET: { target: "idle" },
    },
  },
};
