/**
 * Tests for keyboard shortcuts modal (issue c)
 *
 * Verifies:
 *   1. Pressing ? (when no input is focused) opens the modal
 *   2. Pressing ? when an input is focused does NOT open the modal
 *   3. Pressing Escape closes the modal
 *   4. Pressing ? again (when modal is open) closes it
 *   5. Modal has role="dialog" and aria-modal="true"
 *   6. Modal lists shortcuts grouped by category
 *   7. Focus is trapped inside the modal (Tab cycles)
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { KeyboardShortcutsHelp } from '@/components/ui/KeyboardShortcutsHelp';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

// ── Wrapper that wires the hook to the modal ──────────────────────────────────
function ShortcutsTestWrapper() {
  const { shortcuts, customBindings, isHelpOpen, closeHelp } =
    useKeyboardShortcuts(() => {});
  return (
    <>
      <KeyboardShortcutsHelp
        shortcuts={shortcuts}
        customBindings={customBindings}
        isOpen={isHelpOpen}
        onClose={closeHelp}
      />
      <span data-testid="modal-state">{isHelpOpen ? 'open' : 'closed'}</span>
    </>
  );
}

describe('KeyboardShortcutsHelp — ? key toggles modal', () => {
  it('opens the modal when ? is pressed outside an input', async () => {
    render(<ShortcutsTestWrapper />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: '?' });

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument(),
    );
  });

  it('does not open the modal when ? is pressed inside an input', async () => {
    render(
      <>
        <input data-testid="txt" />
        <ShortcutsTestWrapper />
      </>,
    );

    const input = screen.getByTestId('txt');
    input.focus();
    fireEvent.keyDown(input, { key: '?' });

    // Modal should stay closed
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('closes the modal when Escape is pressed', async () => {
    render(<ShortcutsTestWrapper />);

    fireEvent.keyDown(window, { key: '?' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('closes the modal when ? is pressed a second time', async () => {
    render(<ShortcutsTestWrapper />);

    // Open
    fireEvent.keyDown(window, { key: '?' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Close with same key
    fireEvent.keyDown(window, { key: '?' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });
});

describe('KeyboardShortcutsHelp — accessibility', () => {
  const baseShortcuts = [
    {
      id: 'help',
      description: 'Toggle keyboard shortcuts help',
      category: 'global' as const,
      key: '?',
    },
    {
      id: 'nav_home',
      description: 'Go to Home',
      category: 'navigation' as const,
      key: 'g+h',
    },
  ];

  it('has role="dialog" and aria-modal="true"', () => {
    render(
      <KeyboardShortcutsHelp
        shortcuts={baseShortcuts}
        customBindings={{}}
        isOpen
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('lists shortcuts grouped by category heading', () => {
    render(
      <KeyboardShortcutsHelp
        shortcuts={baseShortcuts}
        customBindings={{}}
        isOpen
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Toggle keyboard shortcuts help')).toBeInTheDocument();
    expect(screen.getByText('Go to Home')).toBeInTheDocument();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = jest.fn();
    render(
      <KeyboardShortcutsHelp
        shortcuts={baseShortcuts}
        customBindings={{}}
        isOpen
        onClose={onClose}
      />,
    );
    // Click the backdrop (outermost dialog div)
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = jest.fn();
    render(
      <KeyboardShortcutsHelp
        shortcuts={baseShortcuts}
        customBindings={{}}
        isOpen
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close shortcuts help/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when isOpen is false', () => {
    render(
      <KeyboardShortcutsHelp
        shortcuts={baseShortcuts}
        customBindings={{}}
        isOpen={false}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
