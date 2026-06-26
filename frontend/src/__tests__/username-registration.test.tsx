/**
 * Tests for the username registration flow:
 * - registerSchema validation rules
 * - useUsernameAvailability hook
 * - RegisterPage form behavior (submission guard, availability feedback)
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { registerSchema } from '@/lib/validations/auth';

// ─── Schema tests ────────────────────────────────────────────────────────────

describe('registerSchema — username validation', () => {
  const base = {
    email: 'test@example.com',
    password: 'Password1!',
    confirmPassword: 'Password1!',
  };

  it('accepts a valid alphanumeric username', () => {
    expect(registerSchema.safeParse({ ...base, username: 'Arena123' }).success).toBe(true);
  });

  it('rejects username shorter than 3 characters', () => {
    const result = registerSchema.safeParse({ ...base, username: 'ab' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/at least 3/i);
    }
  });

  it('rejects username longer than 20 characters', () => {
    const result = registerSchema.safeParse({ ...base, username: 'a'.repeat(21) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/at most 20/i);
    }
  });

  it('rejects username with spaces', () => {
    const result = registerSchema.safeParse({ ...base, username: 'arena master' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/letters and numbers/i);
    }
  });

  it('rejects username with special characters', () => {
    const result = registerSchema.safeParse({ ...base, username: 'arena_master' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/letters and numbers/i);
    }
  });

  it('rejects username with hyphens', () => {
    const result = registerSchema.safeParse({ ...base, username: 'arena-master' });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 3 characters', () => {
    expect(registerSchema.safeParse({ ...base, username: 'abc' }).success).toBe(true);
  });

  it('accepts exactly 20 characters', () => {
    expect(registerSchema.safeParse({ ...base, username: 'a'.repeat(20) }).success).toBe(true);
  });

  it('rejects mismatched passwords', () => {
    const result = registerSchema.safeParse({
      ...base,
      username: 'Arena123',
      confirmPassword: 'different',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/do not match/i);
    }
  });
});

// ─── useUsernameAvailability hook tests ──────────────────────────────────────

jest.mock('@/lib/api', () => ({
  api: {
    checkUsernameAvailability: jest.fn(),
  },
}));

import { api } from '@/lib/api';

// Get the REAL hook implementation — bypasses the jest.mock hoisted below for RegisterPage tests
const { useUsernameAvailability: realUseUsernameAvailability } =
  jest.requireActual('@/hooks/useUsernameAvailability') as typeof import('@/hooks/useUsernameAvailability');

function HookHarness({ username }: { username: string }) {
  const status = realUseUsernameAvailability(username);
  return <div data-testid="status">{status}</div>;
}

describe('useUsernameAvailability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('returns idle for username shorter than 3 chars', () => {
    render(<HookHarness username="ab" />);
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
  });

  it('returns idle for username with invalid characters', () => {
    render(<HookHarness username="ab_c" />);
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
  });

  it('returns available when API returns available: true', async () => {
    (api.checkUsernameAvailability as jest.Mock).mockResolvedValue({ available: true });
    render(<HookHarness username="Arena123" />);
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('available'),
    { timeout: 3000 });
    expect(api.checkUsernameAvailability).toHaveBeenCalledWith('Arena123');
  });

  it('returns unavailable when API returns available: false', async () => {
    (api.checkUsernameAvailability as jest.Mock).mockResolvedValue({ available: false });
    render(<HookHarness username="TakenUser" />);
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unavailable'),
    { timeout: 3000 });
  });

  it('returns error when API throws', async () => {
    (api.checkUsernameAvailability as jest.Mock).mockRejectedValue(new Error('Network error'));
    render(<HookHarness username="Arena123" />);
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('error'),
    { timeout: 3000 });
  });
});

// ─── RegisterPage form behavior ───────────────────────────────────────────────

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    register: jest.fn(),
    loading: false,
    error: null,
    clearError: jest.fn(),
    user: null,
  }),
}));

jest.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({ addToast: jest.fn() }),
}));

// Mock the hook so we control availability status in form tests
jest.mock('@/hooks/useUsernameAvailability', () => ({
  useUsernameAvailability: jest.fn(() => 'idle'),
}));

import RegisterPage from '@/app/register/page';
import { useUsernameAvailability as mockUseAvailability } from '@/hooks/useUsernameAvailability';

describe('RegisterPage — form submission guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockUseAvailability as jest.Mock).mockReturnValue('idle');
  });

  it('renders the username field', () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  });

  it('shows hint text for username format', () => {
    render(<RegisterPage />);
    expect(screen.getByText(/3–20 characters/i)).toBeInTheDocument();
  });

  it('shows schema validation error for short username on submit', async () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'ab' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Password1!' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/at least 3/i)).toBeInTheDocument();
  });

  it('shows schema validation error for username with spaces', async () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'arena master' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Password1!' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    // Ensure the validation error (not the static hint) is shown
    expect(await screen.findByText(/letters and numbers \(no spaces/i)).toBeInTheDocument();
  });

  it('disables submit button when username is unavailable', () => {
    (mockUseAvailability as jest.Mock).mockReturnValue('unavailable');
    render(<RegisterPage />);
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
  });

  it('disables submit button while checking availability', () => {
    (mockUseAvailability as jest.Mock).mockReturnValue('checking');
    render(<RegisterPage />);
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
  });

  it('shows unavailable message when status is unavailable', () => {
    (mockUseAvailability as jest.Mock).mockReturnValue('unavailable');
    render(<RegisterPage />);
    expect(screen.getByText(/already taken/i)).toBeInTheDocument();
  });

  it('shows available message when status is available', () => {
    (mockUseAvailability as jest.Mock).mockReturnValue('available');
    render(<RegisterPage />);
    expect(screen.getByText(/username is available/i)).toBeInTheDocument();
  });

  it('shows error message when availability check fails', () => {
    (mockUseAvailability as jest.Mock).mockReturnValue('error');
    render(<RegisterPage />);
    expect(screen.getByText(/could not check availability/i)).toBeInTheDocument();
  });

  it('blocks submission when username is unavailable and shows field error', async () => {
    (mockUseAvailability as jest.Mock).mockReturnValue('unavailable');
    const { register } = require('@/hooks/useAuth').useAuth();
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'TakenUser' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Password1!' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    // register should not be called when username is unavailable
    expect(register).not.toHaveBeenCalled();
  });
});
