import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
import { checkPasswordStrength } from "@/lib/validations/auth";

// Mock the auth hook
jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    login: jest.fn(),
    register: jest.fn(),
    loading: false,
    error: null,
    clearError: jest.fn(),
    user: null,
  }),
}));

// Mock the notifications context
jest.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({
    addToast: jest.fn(),
  }),
}));

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
}));

describe("Password Strength Validation", () => {
  it("should return weak for short password", () => {
    const result = checkPasswordStrength("abc");
    expect(result.score).toBe(1);
    expect(result.label).toBe("Weak");
    expect(result.requirements.hasMinLength).toBe(false);
  });

  it("should return strong for complete password", () => {
    const result = checkPasswordStrength("Str0ng!Pass");
    expect(result.score).toBe(5);
    expect(result.label).toBe("Strong");
    expect(result.requirements.hasMinLength).toBe(true);
    expect(result.requirements.hasUppercase).toBe(true);
    expect(result.requirements.hasLowercase).toBe(true);
    expect(result.requirements.hasNumber).toBe(true);
    expect(result.requirements.hasSpecialChar).toBe(true);
  });

  it("should check for uppercase letter", () => {
    const result = checkPasswordStrength("abcdefgh1!");
    expect(result.requirements.hasUppercase).toBe(false);
  });

  it("should check for lowercase letter", () => {
    const result = checkPasswordStrength("ABCDEFGH1!");
    expect(result.requirements.hasLowercase).toBe(false);
  });

  it("should check for number", () => {
    const result = checkPasswordStrength("Abcdefgh!");
    expect(result.requirements.hasNumber).toBe(false);
  });

  it("should check for special character", () => {
    const result = checkPasswordStrength("Abcdefgh1");
    expect(result.requirements.hasSpecialChar).toBe(false);
  });
});

describe("Login Page Validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render login form", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("should show validation error for invalid email", async () => {
    render(<LoginPage />);
    const emailInput = screen.getByLabelText(/email/i);
    
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: "invalid-email" } });
    });

    await waitFor(() => {
      expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    });
  });

  it("should show success indicator for valid email", async () => {
    render(<LoginPage />);
    const emailInput = screen.getByLabelText(/email/i);
    
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    });

    await waitFor(() => {
      expect(screen.getByText(/valid/i)).toBeInTheDocument();
    });
  });

  it("should show validation summary on submit with errors", async () => {
    render(<LoginPage />);
    const submitButton = screen.getByRole("button", { name: /sign in/i });
    
    await act(async () => {
      fireEvent.click(submitButton);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("should debounce validation while typing", async () => {
    render(<LoginPage />);
    const emailInput = screen.getByLabelText(/email/i);
    
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: "t" } });
    });

    // Should not show error immediately (debounced)
    expect(screen.queryByText(/valid email address/i)).not.toBeInTheDocument();

    // Wait for debounce
    await waitFor(() => {
      expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    }, { timeout: 500 });
  });

  it("should have proper ARIA attributes for accessibility", () => {
    render(<LoginPage />);
    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toHaveAttribute("aria-invalid", "false");
    expect(emailInput).toHaveAttribute("autoComplete", "email");
  });
});

describe("Register Page Validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render register form", () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("should show password strength indicator when typing password", async () => {
    render(<RegisterPage />);
    const passwordInput = screen.getByLabelText(/^password$/i);
    
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: "Test123!" } });
    });

    await waitFor(() => {
      expect(screen.getByText(/password strength/i)).toBeInTheDocument();
    });
  });

  it("should show password requirements list", async () => {
    render(<RegisterPage />);
    const passwordInput = screen.getByLabelText(/^password$/i);
    
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: "Test" } });
    });

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
      expect(screen.getByText(/one uppercase letter/i)).toBeInTheDocument();
      expect(screen.getByText(/one lowercase letter/i)).toBeInTheDocument();
      expect(screen.getByText(/one number/i)).toBeInTheDocument();
      expect(screen.getByText(/one special character/i)).toBeInTheDocument();
    });
  });

  it("should validate username requirements", async () => {
    render(<RegisterPage />);
    const usernameInput = screen.getByLabelText(/username/i);
    
    await act(async () => {
      fireEvent.change(usernameInput, { target: { value: "ab" } });
    });

    await waitFor(() => {
      expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument();
    });
  });

  it("should validate password match", async () => {
    render(<RegisterPage />);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
    
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: "Str0ng!Pass" } });
      fireEvent.change(confirmPasswordInput, { target: { value: "Different!123" } });
    });

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
  });

  it("should show validation summary with all errors on submit", async () => {
    render(<RegisterPage />);
    const submitButton = screen.getByRole("button", { name: /create account/i });
    
    await act(async () => {
      fireEvent.click(submitButton);
    });

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(screen.getAllByText(/•/).length).toBeGreaterThan(0);
    });
  });

  it("should debounce validation for all fields", async () => {
    render(<RegisterPage />);
    const emailInput = screen.getByLabelText(/email/i);
    
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: "invalid" } });
    });

    expect(screen.queryByText(/valid email address/i)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    }, { timeout: 500 });
  });

  it("should have proper ARIA attributes for accessibility", () => {
    render(<RegisterPage />);
    const inputs = [
      { label: /username/i, autoComplete: "username" },
      { label: /email/i, autoComplete: "email" },
      { label: /^password$/i, autoComplete: "new-password" },
      { label: /confirm password/i, autoComplete: "new-password" },
    ];

    inputs.forEach(({ label, autoComplete }) => {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("autoComplete", autoComplete);
    });
  });

  it("should show success indicators for valid fields", async () => {
    render(<RegisterPage />);
    const usernameInput = screen.getByLabelText(/username/i);
    const emailInput = screen.getByLabelText(/email/i);
    
    await act(async () => {
      fireEvent.change(usernameInput, { target: { value: "ValidUser123" } });
      fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    });

    await waitFor(() => {
      const validTexts = screen.getAllByText(/valid/i);
      expect(validTexts.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("Form Validation UX", () => {
  it("should not show errors before user interaction", () => {
    render(<LoginPage />);
    expect(screen.queryByText(/valid email address/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/required/i)).not.toBeInTheDocument();
  });

  it("should show errors on blur", async () => {
    render(<LoginPage />);
    const emailInput = screen.getByLabelText(/email/i);
    
    await act(async () => {
      fireEvent.focus(emailInput);
      fireEvent.change(emailInput, { target: { value: "invalid" } });
      fireEvent.blur(emailInput);
    });

    await waitFor(() => {
      expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    });
  });

  it("should update validation state in real-time after initial touch", async () => {
    render(<RegisterPage />);
    const usernameInput = screen.getByLabelText(/username/i);
    
    // First touch
    await act(async () => {
      fireEvent.focus(usernameInput);
      fireEvent.change(usernameInput, { target: { value: "ab" } });
      fireEvent.blur(usernameInput);
    });

    await waitFor(() => {
      expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument();
    });

    // Continue typing
    await act(async () => {
      fireEvent.change(usernameInput, { target: { value: "abc" } });
    });

    await waitFor(() => {
      expect(screen.queryByText(/at least 3 characters/i)).not.toBeInTheDocument();
    });
  });
});
