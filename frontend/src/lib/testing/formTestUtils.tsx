/**
 * Form testing utilities for React Hook Form + Zod forms.
 *
 * Provides helpers for rendering forms in tests, filling fields,
 * triggering submission, and asserting validation messages.
 *
 * Usage:
 *   import { renderForm, fillField, submitForm, expectFieldError } from '@/lib/testing/formTestUtils';
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RenderResult } from "@testing-library/react";

// ─── Render helper ────────────────────────────────────────────────────────────

/**
 * Renders a form component wrapped with any required providers.
 * Add global providers (QueryClient, ThemeProvider, etc.) here as needed.
 */
export function renderForm(ui: React.ReactElement): RenderResult {
  return render(ui);
}

// ─── Field helpers ─────────────────────────────────────────────────────────────

/**
 * Types into an input field found by its label text.
 */
export async function fillField(label: string, value: string): Promise<void> {
  const user = userEvent.setup();
  const input = screen.getByLabelText(new RegExp(label, "i"));
  await user.clear(input);
  await user.type(input, value);
}

/**
 * Clears an input field found by its label text.
 */
export async function clearField(label: string): Promise<void> {
  const user = userEvent.setup();
  const input = screen.getByLabelText(new RegExp(label, "i"));
  await user.clear(input);
}

/**
 * Checks or unchecks a checkbox found by its label text.
 */
export async function checkField(label: string, checked = true): Promise<void> {
  const user = userEvent.setup();
  const checkbox = screen.getByLabelText(new RegExp(label, "i")) as HTMLInputElement;
  if (checkbox.checked !== checked) {
    await user.click(checkbox);
  }
}

/**
 * Selects an option from a <select> element found by its label text.
 */
export async function selectOption(label: string, optionValue: string): Promise<void> {
  const select = screen.getByLabelText(new RegExp(label, "i"));
  fireEvent.change(select, { target: { value: optionValue } });
}

// ─── Submission helper ─────────────────────────────────────────────────────────

/**
 * Submits a form by clicking the button with the given text (default: "submit").
 */
export async function submitForm(buttonText = /submit/i): Promise<void> {
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: buttonText });
  await user.click(button);
}

// ─── Assertion helpers ─────────────────────────────────────────────────────────

/**
 * Asserts that a validation error message is present for a given message text.
 */
export async function expectFieldError(message: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByText(new RegExp(message, "i"))).toBeInTheDocument();
  });
}

/**
 * Asserts that a validation error message is NOT present.
 */
export async function expectNoFieldError(message: string): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText(new RegExp(message, "i"))).not.toBeInTheDocument();
  });
}

/**
 * Asserts that a submit button is disabled.
 */
export function expectSubmitDisabled(buttonText = /submit/i): void {
  const button = screen.getByRole("button", { name: buttonText });
  expect(button).toBeDisabled();
}

/**
 * Asserts that a submit button is enabled.
 */
export function expectSubmitEnabled(buttonText = /submit/i): void {
  const button = screen.getByRole("button", { name: buttonText });
  expect(button).not.toBeDisabled();
}

// ─── Zod schema test utilities ────────────────────────────────────────────────

import { type ZodSchema } from "zod";

/**
 * Tests a Zod schema against a set of valid and invalid inputs.
 *
 * @example
 * testSchema(loginSchema, {
 *   valid: [{ email: 'a@b.com', password: 'Password1!' }],
 *   invalid: [
 *     { input: { email: 'bad', password: 'pass' }, expectedErrors: ['email', 'password'] },
 *   ],
 * });
 */
export function testSchema<T>(
  schema: ZodSchema<T>,
  cases: {
    valid?: object[];
    invalid?: { input: object; expectedErrors?: string[] }[];
  }
) {
  if (cases.valid) {
    cases.valid.forEach((input, i) => {
      it(`accepts valid input #${i + 1}`, () => {
        const result = schema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });
  }

  if (cases.invalid) {
    cases.invalid.forEach(({ input, expectedErrors }, i) => {
      it(`rejects invalid input #${i + 1}`, () => {
        const result = schema.safeParse(input);
        expect(result.success).toBe(false);
        if (!result.success && expectedErrors) {
          const paths = result.error.issues.map((issue) =>
            issue.path.join(".")
          );
          expectedErrors.forEach((errorPath) => {
            expect(paths).toContain(errorPath);
          });
        }
      });
    });
  }
}
