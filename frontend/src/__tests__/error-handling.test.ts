import {
  ArenaXError,
  ErrorCategory,
  ErrorSeverity,
  determineErrorCategory,
  determineErrorSeverity,
  generateErrorId,
} from "@/lib/errors";

describe("Error Types and Utilities", () => {
  describe("ArenaXError", () => {
    it("should create an instance with default values", () => {
      const error = new ArenaXError("Test error");
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("ArenaXError");
      expect(error.message).toBe("Test error");
      expect(error.category).toBe(ErrorCategory.UNKNOWN);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it("should create an instance with custom values", () => {
      const error = new ArenaXError(
        "Network error",
        ErrorCategory.NETWORK,
        ErrorSeverity.HIGH,
        { url: "https://example.com" }
      );
      expect(error.category).toBe(ErrorCategory.NETWORK);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.metadata).toEqual({ url: "https://example.com" });
    });
  });

  describe("determineErrorCategory", () => {
    it("should determine network error", () => {
      const error = new Error("Network error occurred");
      expect(determineErrorCategory(error)).toBe(ErrorCategory.NETWORK);
    });

    it("should determine authentication error", () => {
      const error = new Error("Unauthorized access");
      expect(determineErrorCategory(error)).toBe(ErrorCategory.AUTHENTICATION);
    });

    it("should determine validation error", () => {
      const error = new Error("Invalid input");
      expect(determineErrorCategory(error)).toBe(ErrorCategory.VALIDATION);
    });

    it("should determine API error", () => {
      const error = new Error("API server error");
      expect(determineErrorCategory(error)).toBe(ErrorCategory.API);
    });

    it("should use category from ArenaXError", () => {
      const error = new ArenaXError("Test", ErrorCategory.RUNTIME);
      expect(determineErrorCategory(error)).toBe(ErrorCategory.RUNTIME);
    });
  });

  describe("determineErrorSeverity", () => {
    it("should determine critical error", () => {
      const error = new Error("Critical failure");
      expect(determineErrorSeverity(error)).toBe(ErrorSeverity.CRITICAL);
    });

    it("should determine high severity for network errors", () => {
      const error = new Error("Network timeout");
      expect(determineErrorSeverity(error)).toBe(ErrorSeverity.HIGH);
    });

    it("should use severity from ArenaXError", () => {
      const error = new ArenaXError("Test", ErrorCategory.UNKNOWN, ErrorSeverity.LOW);
      expect(determineErrorSeverity(error)).toBe(ErrorSeverity.LOW);
    });
  });

  describe("generateErrorId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateErrorId();
      const id2 = generateErrorId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^\d+-[a-z0-9]+$/);
    });
  });
});
