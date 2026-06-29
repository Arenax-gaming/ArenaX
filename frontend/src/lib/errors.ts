// Error Types
export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export enum ErrorCategory {
  NETWORK = "network",
  AUTHENTICATION = "authentication",
  VALIDATION = "validation",
  RUNTIME = "runtime",
  API = "api",
  UNKNOWN = "unknown",
}

export interface LoggedError {
  id: string;
  timestamp: number;
  message: string;
  stack?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  metadata?: Record<string, unknown>;
}

// Custom Error Class
export class ArenaXError extends Error {
  public category: ErrorCategory;
  public severity: ErrorSeverity;
  public metadata?: Record<string, unknown>;

  constructor(
    message: string,
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ArenaXError";
    this.category = category;
    this.severity = severity;
    this.metadata = metadata;

    // Maintain proper stack trace
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, ArenaXError);
    }
  }
}

// Error Utility Functions
export function determineErrorCategory(error: Error): ErrorCategory {
  const message = error.message.toLowerCase();
  
  if (error instanceof ArenaXError) {
    return error.category;
  }
  
  if (message.includes("network") || message.includes("fetch") || message.includes("timeout")) {
    return ErrorCategory.NETWORK;
  }
  
  if (message.includes("unauthorized") || message.includes("forbidden") || message.includes("authentication")) {
    return ErrorCategory.AUTHENTICATION;
  }
  
  if (message.includes("validation") || message.includes("invalid")) {
    return ErrorCategory.VALIDATION;
  }
  
  if (message.includes("api") || message.includes("server")) {
    return ErrorCategory.API;
  }
  
  return ErrorCategory.UNKNOWN;
}

export function determineErrorSeverity(error: Error): ErrorSeverity {
  if (error instanceof ArenaXError) {
    return error.severity;
  }
  
  const message = error.message.toLowerCase();
  
  if (message.includes("critical") || message.includes("fatal")) {
    return ErrorSeverity.CRITICAL;
  }
  
  if (message.includes("network") || message.includes("timeout")) {
    return ErrorSeverity.HIGH;
  }
  
  return ErrorSeverity.MEDIUM;
}

export function generateErrorId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
