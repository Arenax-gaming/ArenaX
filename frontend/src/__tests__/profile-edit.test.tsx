import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileEditPage from '@/app/[locale]/profile/edit/page';
import { MAX_BIO_LENGTH } from '@/lib/validations/profile';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'TestUser', email: 'test@test.com' } }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// CustomizationOptions uses lucide-react icons; mock to keep tests simple
jest.mock('@/components/profile/CustomizationOptions', () => ({
  CustomizationOptions: () => <div data-testid="customization-options" />,
}));

describe('ProfileEditPage', () => {
  it('disables submit button and shows error when bio exceeds MAX_BIO_LENGTH', () => {
    render(<ProfileEditPage />);

    const textarea = screen.getByRole('textbox', { name: /bio/i });
    const longBio = 'a'.repeat(MAX_BIO_LENGTH + 1);

    fireEvent.change(textarea, { target: { value: longBio } });

    expect(
      screen.getByText(`Bio must be ${MAX_BIO_LENGTH} characters or less`)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('shows avatar validation error when file exceeds 5MB', async () => {
    render(<ProfileEditPage />);

    const input = screen.getByLabelText(/avatar/i);

    // Create a mock file larger than 5MB
    const oversizedFile = new File(['x'], 'avatar.jpg', { type: 'image/jpeg' });
    Object.defineProperty(oversizedFile, 'size', { value: 6 * 1024 * 1024 });

    fireEvent.change(input, { target: { files: [oversizedFile] } });

    // File processing (read → optional compression) is async, so wait for it.
    // The message renders both as the visible alert and inside the sr-only
    // live region, so match on the collection.
    const alerts = await screen.findAllByText('File size must not exceed 5MB');
    expect(alerts.length).toBeGreaterThan(0);
  });
});
