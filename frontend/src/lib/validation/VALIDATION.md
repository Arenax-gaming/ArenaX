# ArenaX Request Validation System

Declarative, type-safe API request validation with automatic error messages, analytics, and governance.

---

## Overview

The validation system provides a **class-validator-style declarative API** built on top of Zod — no decorators, no `reflect-metadata`, fully compatible with Next.js + Babel.

```
Field.email()          ← declarative field builder
Validators.stellarAddress()  ← domain-specific custom validators
defineSchema(name, shape)    ← named, versioned schema builder
createValidationResolver()   ← instrumented RHF resolver (analytics)
validateRequest()            ← pre-flight API payload validation
```

---

## Files

| File | Purpose |
|---|---|
| `fields.ts` | `Field.*` builders — email, username, password, number, enum, etc. |
| `validators.ts` | `Validators.*` — domain validators (Stellar, ELO, game types, etc.) |
| `schema.ts` | `defineSchema` / `defineSchemaWithRefinements` — named schema builder |
| `resolver.ts` | `createValidationResolver`, `validateData`, `validateRequest` |
| `analytics.ts` | Event recording, field stats, governance policies |
| `schemas/` | All domain-specific request validation schemas |
| `index.ts` | Public barrel — import everything from `@/lib/validation` |

---

## Quick Start

### 1. Form validation (replaces `zodResolver`)

```tsx
import { useForm } from "react-hook-form";
import { createValidationResolver, loginRequestSchema } from "@/lib/validation";
import type { LoginRequest } from "@/lib/validation";

const form = useForm<LoginRequest>({
  resolver: createValidationResolver(
    loginRequestSchema.schema,
    loginRequestSchema.meta.name,
  ),
  defaultValues: { email: "", password: "" },
});
```

### 2. API request validation (pre-flight)

```ts
import { validateRequest, createTournamentSchema } from "@/lib/validation";

const payload = validateRequest(
  createTournamentSchema.schema,
  createTournamentSchema.meta.name,
  rawFormData,
);

await apiClient.post("/tournaments", payload);
```

If validation fails, `validateRequest` throws `RequestValidationError` with a `fieldErrors` map — no API round-trip needed.

### 3. Standalone validation

```ts
import { validateData } from "@/lib/validation";

const result = validateData(withdrawSchema.schema, "withdraw", userInput);
if (!result.success) {
  console.error(result.errors); // { amount: "Enter a valid amount greater than 0" }
}
```

---

## Field Builders (`Field.*`)

All builders return Zod schemas you can use directly in `z.object({})` or standalone.

```ts
import { Field } from "@/lib/validation";

const schema = z.object({
  email:       Field.email(),
  username:    Field.username({ min: 3, max: 20 }),
  password:    Field.password(),                    // strong requirements
  loginPwd:    Field.passwordLogin(),               // non-empty only (for login)
  bio:         Field.optionalText({ max: 280 }),
  age:         Field.integer({ min: 18, max: 120 }),
  fee:         Field.number({ min: 0 }),
  amount:      Field.positiveAmountString(),        // "0.001" → valid
  startDate:   Field.isoDate({ futureOnly: true }),
  websiteUrl:  Field.optionalUrl(),
  status:      Field.enum(["active", "inactive"] as const),
  agreedTerms: Field.mustBeTrue("You must accept the terms"),
  enabled:     Field.boolean(),
});
```

---

## Domain Validators (`Validators.*`)

```ts
import { Validators } from "@/lib/validation";

const schema = z.object({
  destination:    Validators.stellarAddress(),
  memo:           Validators.stellarMemo(),            // optional, ≤28 bytes
  entryFee:       Validators.entryFee({ maxFee: 500 }),
  prizePool:      Validators.prizePool(),
  participants:   Validators.maxParticipants(),        // must be power of 2
  eloRating:      Validators.eloRating(),
  discordHandle:  Validators.discordHandle({ optional: true }),
  twitter:        Validators.socialLink("twitter.com"),
  score:          Validators.matchScore(),
  matchId:        Validators.uuid(),
  contractArgs:   Validators.contractArgs(),
  page:           Validators.page(),                   // optional, ≥1
  limit:          Validators.limit({ max: 100 }),      // optional
});
```

---

## Cross-field Constraints

```ts
import { mustMatch, requiredWhen } from "@/lib/validation";

const schema = z.object({
  password: Field.password(),
  confirmPassword: z.string(),
  currentPassword: z.string().optional(),
  newPassword: Field.password().optional(),
})
  .superRefine(mustMatch("password", "confirmPassword", "Passwords do not match"))
  .superRefine(
    requiredWhen(
      (d) => !!d.newPassword,
      "currentPassword",
      "Current password is required to change your password",
    )
  );
```

---

## Named Schemas

`defineSchema` registers the schema in a global registry and attaches metadata used by analytics and governance.

```ts
import { defineSchema, defineSchemaWithRefinements } from "@/lib/validation";

// Simple schema
const loginSchema = defineSchema("login", {
  email: Field.email(),
  password: Field.passwordLogin(),
}, { description: "Login form", tags: ["auth"] });

type LoginData = z.infer<typeof loginSchema.schema>;

// Schema with refinements (cross-field checks)
const registerSchema = defineSchemaWithRefinements(
  "register",
  { password: Field.password(), confirmPassword: z.string() },
  (s) => s.superRefine(mustMatch("password", "confirmPassword")),
);
```

---

## Pre-built Request Schemas

All request schemas live in `schemas/` and are exported from `@/lib/validation`:

| Schema | Name | Tags |
|---|---|---|
| `loginRequestSchema` | `loginRequest` | auth |
| `registerRequestSchema` | `registerRequest` | auth |
| `passwordResetRequestSchema` | `passwordResetRequest` | auth |
| `profileUpdateSchema` | `profileUpdate` | auth, profile |
| `createTournamentSchema` | `createTournament` | tournament |
| `tournamentRegistrationSchema` | `tournamentRegistration` | tournament |
| `reportScoreSchema` | `reportScore` | match |
| `withdrawSchema` | `withdraw` | wallet, payment |
| `stakeSchema` | `stake` | wallet, staking |
| `resolveDisputeSchema` | `resolveDispute` | admin, dispute |
| `processKycSchema` | `processKyc` | admin, kyc |
| `createProposalSchema` | `createProposal` | governance |
| `voteOnProposalSchema` | `voteOnProposal` | governance |

---

## Analytics

Every `createValidationResolver` and `validateData` / `validateRequest` call automatically records a `ValidationAttemptEvent`.

```ts
import { getValidationSnapshot, getSchemaStats } from "@/lib/validation";

const snap = getValidationSnapshot();
console.log(snap.globalSuccessRate);     // 0.87
console.log(snap.topFailingFields);      // [{ field: "email", failureCount: 42 }]

const loginStats = getSchemaStats("login");
console.log(loginStats.successRate);     // 0.95
console.log(loginStats.fieldStats);      // per-field error breakdown
```

### React hook

```tsx
import { useValidationMonitor } from "@/hooks/useValidationMonitor";

function DevOverlay() {
  const { snapshot, violations, rateViolations, refresh } =
    useValidationMonitor({ autoStart: true, pollIntervalMs: 3_000 });

  return (
    <div>
      <p>Validation success rate: {(snapshot.globalSuccessRate * 100).toFixed(1)}%</p>
      <p>Active governance violations: {violations.length}</p>
    </div>
  );
}
```

---

## Governance Policies

Built-in policies run on every validation event:

| Policy | Trigger | Severity |
|---|---|---|
| `slow-validation` | `durationMs > 100ms` | warn |
| `low-success-rate` | Schema success rate < 30% (≥5 attempts) | warn |

Add custom policies:

```ts
import { registerGovernancePolicy } from "@/lib/validation";

registerGovernancePolicy({
  name: "no-test-emails",
  description: "Blocks test@ addresses in production",
  severity: "warn",
  check(event) {
    if (event.failedFields.length === 0) return null;
    return null; // return a message string to trigger a violation
  },
});
```

---

## Error Utilities

```ts
import { flattenZodErrors, getFieldError, groupZodErrors } from "@/lib/validation";

const result = schema.safeParse(data);
if (!result.success) {
  // { email: "Enter a valid email", age: "Must be 18+" }
  const flat = flattenZodErrors(result.error);

  // "Enter a valid email"
  const emailMsg = getFieldError(result.error, "email");

  // { email: ["Enter a valid email"], age: ["Must be 18+", "..."] }
  const grouped = groupZodErrors(result.error);
}
```
