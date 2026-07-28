/**
 * Tests for the validation resolver and standalone validateData / validateRequest.
 */

import { z } from "zod";
import {
  validateData,
  validateRequest,
  RequestValidationError,
} from "../resolver";
import { clearValidationAnalytics, getValidationEvents } from "../analytics";

beforeEach(() => {
  clearValidationAnalytics();
});

// ─── validateData ─────────────────────────────────────────────────────────────

describe("validateData()", () => {
  const schema = z.object({
    email: z.string().email("Invalid email"),
    age: z.number().min(18, "Must be 18+"),
  });

  it("returns success:true with data on valid input", () => {
    const result = validateData<{ email: string; age: number }>(
      schema,
      "test",
      { email: "a@b.com", age: 20 },
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("a@b.com");
      expect(result.data.age).toBe(20);
    }
  });

  it("returns success:false with errors on invalid input", () => {
    const result = validateData(schema, "test", { email: "bad", age: 10 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.email).toBe("Invalid email");
      expect(result.errors.age).toBe("Must be 18+");
    }
  });

  it("records a success analytics event", () => {
    validateData(schema, "analyticsTestSuccess", { email: "a@b.com", age: 25 });
    const events = getValidationEvents();
    const event = events.find((e) => e.schemaName === "analyticsTestSuccess");
    expect(event).toBeDefined();
    expect(event?.success).toBe(true);
    expect(event?.failedFields).toHaveLength(0);
  });

  it("records a failure analytics event with failedFields", () => {
    validateData(schema, "analyticsTestFail", { email: "bad", age: 5 });
    const events = getValidationEvents();
    const event = events.find((e) => e.schemaName === "analyticsTestFail");
    expect(event).toBeDefined();
    expect(event?.success).toBe(false);
    expect(event?.failedFields).toContain("email");
    expect(event?.failedFields).toContain("age");
  });

  it("records context when provided", () => {
    validateData(schema, "contextTest", { email: "a@b.com", age: 20 }, "api-request");
    const events = getValidationEvents();
    const event = events.find((e) => e.schemaName === "contextTest");
    expect(event?.context).toBe("api-request");
  });
});

// ─── validateRequest ──────────────────────────────────────────────────────────

describe("validateRequest()", () => {
  const schema = z.object({ name: z.string().min(1, "Name required") });

  it("returns validated data on success", () => {
    const data = validateRequest<{ name: string }>(schema, "test", { name: "Alice" });
    expect(data.name).toBe("Alice");
  });

  it("throws RequestValidationError on failure", () => {
    expect(() => validateRequest(schema, "test", { name: "" })).toThrow(
      RequestValidationError,
    );
  });

  it("includes fieldErrors in the thrown error", () => {
    try {
      validateRequest(schema, "test", { name: "" });
    } catch (err) {
      expect(err).toBeInstanceOf(RequestValidationError);
      if (err instanceof RequestValidationError) {
        expect(err.fieldErrors.name).toBe("Name required");
        expect(err.schemaName).toBe("test");
      }
    }
  });

  it("error message includes schema name and field details", () => {
    try {
      validateRequest(schema, "mySchema", { name: "" });
    } catch (err) {
      if (err instanceof RequestValidationError) {
        expect(err.message).toContain("mySchema");
        expect(err.message).toContain("name");
      }
    }
  });
});

// ─── RequestValidationError ───────────────────────────────────────────────────

describe("RequestValidationError", () => {
  it("is an instance of Error", () => {
    const err = new RequestValidationError("msg", {}, "schema");
    expect(err instanceof Error).toBe(true);
  });

  it("has the correct name", () => {
    const err = new RequestValidationError("msg", {}, "schema");
    expect(err.name).toBe("RequestValidationError");
  });
});
