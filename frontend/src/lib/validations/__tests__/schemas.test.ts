/**
 * Unit tests for all Zod validation schemas.
 * Run with: npm test -- schemas.test.ts
 */

import { loginSchema, registerSchema, passwordResetRequestSchema, passwordResetSchema, accountSettingsSchema } from "../auth";
import { profileEditSchema, profileBioSchema } from "../profile";
import { contactSchema } from "../contact";
import { withdrawSchema, depositSchema } from "../wallet";
import { tournamentRegistrationSchema } from "../tournament";

// ─── Auth schemas ─────────────────────────────────────────────────────────────

describe("loginSchema", () => {
  it("accepts valid credentials", () => {
    const result = loginSchema.safeParse({ email: "user@example.com", password: "secret" });
    expect(result.success).toBe(true);
  });

  it("rejects missing email", () => {
    const result = loginSchema.safeParse({ email: "", password: "secret" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "email")).toBe(true);
    }
  });

  it("rejects invalid email format", () => {
    const result = loginSchema.safeParse({ email: "notanemail", password: "secret" });
    expect(result.success).toBe(false);
  });

  it("rejects missing password", () => {
    const result = loginSchema.safeParse({ email: "user@example.com", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "password")).toBe(true);
    }
  });
});

describe("registerSchema", () => {
  const validData = {
    username: "TestUser1",
    email: "user@example.com",
    password: "Password1!",
    confirmPassword: "Password1!",
    agreeToTerms: true,
  };

  it("accepts valid registration data", () => {
    expect(registerSchema.safeParse(validData).success).toBe(true);
  });

  it("rejects username shorter than 3 chars", () => {
    const result = registerSchema.safeParse({ ...validData, username: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects username longer than 20 chars", () => {
    const result = registerSchema.safeParse({ ...validData, username: "a".repeat(21) });
    expect(result.success).toBe(false);
  });

  it("rejects username with special characters", () => {
    const result = registerSchema.safeParse({ ...validData, username: "user@name" });
    expect(result.success).toBe(false);
  });

  it("rejects password without uppercase letter", () => {
    const result = registerSchema.safeParse({ ...validData, password: "password1!", confirmPassword: "password1!" });
    expect(result.success).toBe(false);
  });

  it("rejects password without number", () => {
    const result = registerSchema.safeParse({ ...validData, password: "Password!", confirmPassword: "Password!" });
    expect(result.success).toBe(false);
  });

  it("rejects password without special character", () => {
    const result = registerSchema.safeParse({ ...validData, password: "Password1", confirmPassword: "Password1" });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched passwords", () => {
    const result = registerSchema.safeParse({ ...validData, confirmPassword: "Different1!" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "confirmPassword")).toBe(true);
    }
  });

  it("rejects when terms not agreed to", () => {
    const result = registerSchema.safeParse({ ...validData, agreeToTerms: false });
    expect(result.success).toBe(false);
  });
});

describe("passwordResetRequestSchema", () => {
  it("accepts valid email", () => {
    expect(passwordResetRequestSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });

  it("rejects invalid email", () => {
    expect(passwordResetRequestSchema.safeParse({ email: "notvalid" }).success).toBe(false);
  });
});

describe("passwordResetSchema", () => {
  it("accepts matching valid passwords", () => {
    const result = passwordResetSchema.safeParse({ password: "Password1!", confirmPassword: "Password1!" });
    expect(result.success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = passwordResetSchema.safeParse({ password: "Password1!", confirmPassword: "Different1!" });
    expect(result.success).toBe(false);
  });
});

// ─── Profile schemas ──────────────────────────────────────────────────────────

describe("profileBioSchema", () => {
  it("accepts empty bio", () => {
    expect(profileBioSchema.safeParse({ bio: "" }).success).toBe(true);
  });

  it("accepts bio within limit", () => {
    expect(profileBioSchema.safeParse({ bio: "Hello!" }).success).toBe(true);
  });

  it("rejects bio over 280 characters", () => {
    const result = profileBioSchema.safeParse({ bio: "a".repeat(281) });
    expect(result.success).toBe(false);
  });
});

describe("profileEditSchema", () => {
  const validData = {
    username: "ValidUser",
    bio: "Hello!",
    twitter: "https://twitter.com/user",
    discord: "user#0000",
    twitch: "https://twitch.tv/user",
    github: "https://github.com/user",
  };

  it("accepts valid profile data", () => {
    expect(profileEditSchema.safeParse(validData).success).toBe(true);
  });

  it("rejects invalid twitter URL", () => {
    const result = profileEditSchema.safeParse({ ...validData, twitter: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("accepts empty optional fields", () => {
    const result = profileEditSchema.safeParse({ username: "User1" });
    expect(result.success).toBe(true);
  });
});

// ─── Contact schema ───────────────────────────────────────────────────────────

describe("contactSchema", () => {
  const validData = {
    name: "Jane Doe",
    email: "jane@example.com",
    category: "issue" as const,
    message: "This is a test message with enough characters.",
  };

  it("accepts valid contact form data", () => {
    expect(contactSchema.safeParse(validData).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(contactSchema.safeParse({ ...validData, name: "" }).success).toBe(false);
  });

  it("rejects message shorter than 10 chars", () => {
    expect(contactSchema.safeParse({ ...validData, message: "Short" }).success).toBe(false);
  });

  it("rejects invalid category", () => {
    expect(contactSchema.safeParse({ ...validData, category: "invalid" }).success).toBe(false);
  });
});

// ─── Wallet schemas ───────────────────────────────────────────────────────────

describe("withdrawSchema", () => {
  const validData = {
    asset: "XLM" as const,
    amount: "10",
    destination: "G" + "A".repeat(55), // 56 chars total
    memo: "",
  };

  it("accepts valid withdrawal", () => {
    expect(withdrawSchema.safeParse(validData).success).toBe(true);
  });

  it("rejects zero amount", () => {
    expect(withdrawSchema.safeParse({ ...validData, amount: "0" }).success).toBe(false);
  });

  it("rejects negative amount", () => {
    expect(withdrawSchema.safeParse({ ...validData, amount: "-5" }).success).toBe(false);
  });

  it("rejects invalid stellar address", () => {
    expect(withdrawSchema.safeParse({ ...validData, destination: "NOTASTELLARADDRESS" }).success).toBe(false);
  });

  it("rejects memo longer than 28 chars", () => {
    expect(withdrawSchema.safeParse({ ...validData, memo: "a".repeat(29) }).success).toBe(false);
  });
});

// ─── Tournament schema ────────────────────────────────────────────────────────

describe("tournamentRegistrationSchema", () => {
  const validData = {
    username: "ProGamer",
    email: "pro@example.com",
    discordHandle: "pro#1234",
    agreedToRules: true,
  };

  it("accepts valid registration", () => {
    expect(tournamentRegistrationSchema.safeParse(validData).success).toBe(true);
  });

  it("rejects empty username", () => {
    expect(tournamentRegistrationSchema.safeParse({ ...validData, username: "" }).success).toBe(false);
  });

  it("rejects invalid email", () => {
    expect(tournamentRegistrationSchema.safeParse({ ...validData, email: "bad" }).success).toBe(false);
  });

  it("rejects when rules not agreed to", () => {
    expect(tournamentRegistrationSchema.safeParse({ ...validData, agreedToRules: false }).success).toBe(false);
  });

  it("accepts missing optional discord handle", () => {
    const { discordHandle: _, ...rest } = validData;
    expect(tournamentRegistrationSchema.safeParse(rest).success).toBe(true);
  });
});
