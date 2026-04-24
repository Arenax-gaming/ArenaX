import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileEditPage from '@/app/profile/edit/page';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'TestUser', email: 'test@test.com' } }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

// CustomizationOptions uses lucide-react icons; mock to keep tests simple
jest.mock('@/components/profile/CustomizationOptions', () => ({
  CustomizationOptions: () => <div data-testid="customization-options" />,
}));

describe('ProfileEditPage', () => {
  it('disables submit button and shows error when bio exceeds 500 characters', () => {
    render(<ProfileEditPage />);

    const textarea = screen.getByRole('textbox', { name: /bio/i });
    const longBio = 'a'.repeat(501);

    fireEvent.change(textarea, { target: { value: longBio } });

    expect(screen.getByText('Bio must be 500 characters or less')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('shows avatar validation error when file exceeds 5MB', () => {
    render(<ProfileEditPage />);

    const input = screen.getByLabelText(/avatar/i);

    // Create a mock file larger than 5MB
    const oversizedFile = new File(['x'], 'avatar.jpg', { type: 'image/jpeg' });
    Object.defineProperty(oversizedFile, 'size', { value: 6 * 1024 * 1024 });

    fireEvent.change(input, { target: { files: [oversizedFile] } });

    expect(screen.getByText('File size must not exceed 5MB')).toBeInTheDocument();
  });
});
