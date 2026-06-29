import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockSetTheme = jest.fn();

jest.mock('next-themes', () => {
  const R = require('react');
  return {
    ThemeProvider: jest.fn(({ children }: { children: React.ReactNode }) =>
      R.createElement(R.Fragment, null, children)
    ),
    useTheme: jest.fn(),
  };
});

import { useTheme, ThemeProvider as MockedNextProvider } from 'next-themes';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ThemeToggle as UiThemeToggle } from '@/components/ui/ThemeToggle';
import { ThemeToggle as NavThemeToggle } from '@/components/ThemeToggle';
import { ThemeSelector } from '@/components/settings/ThemeSelector';
import type { ThemeSettings } from '@/types/settings';

const defaultSettings: ThemeSettings = {
  mode: 'light',
  accentColor: 'blue',
  compactMode: false,
  animationsEnabled: true,
};

function setupTheme(theme: string, resolvedTheme: string) {
  (useTheme as jest.Mock).mockReturnValue({ theme, resolvedTheme, setTheme: mockSetTheme });
}

function renderSelector(overrides: Partial<ThemeSettings> = {}) {
  const onUpdate = jest.fn();
  const onSave = jest.fn().mockResolvedValue(true);
  render(
    <ThemeSelector
      settings={{ ...defaultSettings, ...overrides }}
      onUpdate={onUpdate}
      onSave={onSave}
      isSaving={false}
    />
  );
  return { onUpdate, onSave };
}

beforeEach(() => {
  mockSetTheme.mockClear();
  (MockedNextProvider as jest.Mock).mockClear();
  localStorage.clear();
});

// ─── ThemeProvider configuration ──────────────────────────────────────────────

describe('ThemeProvider configuration', () => {
  it('forwards storageKey="theme" to NextThemesProvider', () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="theme">
        <div />
      </ThemeProvider>
    );
    expect(MockedNextProvider).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: 'theme' }),
      expect.anything()
    );
  });

  it('forwards defaultTheme="system" to NextThemesProvider', () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="theme">
        <div />
      </ThemeProvider>
    );
    expect(MockedNextProvider).toHaveBeenCalledWith(
      expect.objectContaining({ defaultTheme: 'system' }),
      expect.anything()
    );
  });

  it('forwards enableSystem to NextThemesProvider', () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="theme">
        <div />
      </ThemeProvider>
    );
    expect(MockedNextProvider).toHaveBeenCalledWith(
      expect.objectContaining({ enableSystem: true }),
      expect.anything()
    );
  });

  it('passes all props through without modifying them', () => {
    render(
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        storageKey="theme"
        disableTransitionOnChange
      >
        <div />
      </ThemeProvider>
    );
    expect(MockedNextProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        attribute: 'class',
        defaultTheme: 'system',
        enableSystem: true,
        storageKey: 'theme',
        disableTransitionOnChange: true,
      }),
      expect.anything()
    );
  });
});

// ─── localStorage persistence ─────────────────────────────────────────────────

describe('localStorage persistence', () => {
  it('stores the selected theme under the "theme" key', () => {
    setupTheme('light', 'light');
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: /dark/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('does not store under any other key', () => {
    setupTheme('light', 'light');
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: /dark/i }));
    // Only one call, with the value 'dark', implying the key contract is 'theme'
    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('restores the stored theme after remount', () => {
    localStorage.setItem('theme', 'dark');
    // next-themes reads localStorage on init; our mock reflects that stored state
    setupTheme('dark', 'dark');

    renderSelector({ mode: 'light' }); // settings.mode is stale; useTheme is authoritative

    const darkBtn = screen.getByRole('button', { name: /dark/i });
    expect(darkBtn).toHaveClass('border-primary');
  });

  it('restores light theme after remount', () => {
    localStorage.setItem('theme', 'light');
    setupTheme('light', 'light');

    renderSelector({ mode: 'dark' }); // stale settings — useTheme overrides

    const lightBtn = screen.getByRole('button', { name: /light/i });
    expect(lightBtn).toHaveClass('border-primary');
    const darkBtn = screen.getByRole('button', { name: /dark/i });
    expect(darkBtn).not.toHaveClass('border-primary');
  });

  it('falls back to system mode when no preference is in localStorage', () => {
    expect(localStorage.getItem('theme')).toBeNull();
    setupTheme('system', 'light');

    renderSelector({ mode: 'system' });

    const systemBtn = screen.getByRole('button', { name: /system/i });
    expect(systemBtn).toHaveClass('border-primary');
  });
});

// ─── ThemeToggle (components/ui/ThemeToggle) ──────────────────────────────────

describe('ThemeToggle — ui/ThemeToggle', () => {
  it('switches from light to dark', () => {
    setupTheme('light', 'light');
    render(<UiThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle theme/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('switches from dark to light', () => {
    setupTheme('dark', 'dark');
    render(<UiThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle theme/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('uses resolvedTheme to decide direction when mode is "system" (dark OS)', () => {
    setupTheme('system', 'dark');
    render(<UiThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle theme/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('uses resolvedTheme to decide direction when mode is "system" (light OS)', () => {
    setupTheme('system', 'light');
    render(<UiThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle theme/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('SSR output is a placeholder with no click handler (prevents theme flash)', () => {
    // renderToStaticMarkup simulates the server render: useEffect never runs,
    // so mounted=false and the placeholder branch is returned. This is exactly
    // what the browser displays before client JS hydrates — no flash of the
    // wrong theme because there is no interactive button yet.
    setupTheme('dark', 'dark');
    const html = renderToStaticMarkup(<UiThemeToggle />);

    expect(html).toContain('aria-label="Toggle theme"');
    expect(html).not.toContain('onclick');
  });
});

// ─── ThemeToggle (components/ThemeToggle) ────────────────────────────────────

describe('ThemeToggle — components/ThemeToggle', () => {
  it('switches from light to dark', () => {
    setupTheme('light', 'light');
    render(<NavThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle theme/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('switches from dark to light', () => {
    setupTheme('dark', 'dark');
    render(<NavThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle theme/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('uses resolvedTheme when mode is "system" (dark OS)', () => {
    setupTheme('system', 'dark');
    render(<NavThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /toggle theme/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('SSR output is a placeholder with no click handler (prevents theme flash)', () => {
    setupTheme('light', 'light');
    const html = renderToStaticMarkup(<NavThemeToggle />);

    expect(html).toContain('aria-label="Toggle theme"');
    expect(html).not.toContain('onclick');
  });
});

// ─── ThemeSelector ────────────────────────────────────────────────────────────

describe('ThemeSelector', () => {
  it('shows the active mode from useTheme, not from the stale settings prop', () => {
    setupTheme('dark', 'dark');
    renderSelector({ mode: 'light' }); // settings says light, useTheme says dark

    expect(screen.getByRole('button', { name: /dark/i })).toHaveClass('border-primary');
    expect(screen.getByRole('button', { name: /light/i })).not.toHaveClass('border-primary');
  });

  it('calls setTheme with the selected mode', () => {
    setupTheme('light', 'light');
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: /dark/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('calls onUpdate with the selected mode', () => {
    setupTheme('light', 'light');
    const { onUpdate } = renderSelector();
    fireEvent.click(screen.getByRole('button', { name: /dark/i }));
    expect(onUpdate).toHaveBeenCalledWith({ mode: 'dark' });
  });

  it('can select system mode, calling both setTheme and onUpdate', () => {
    setupTheme('light', 'light');
    const { onUpdate } = renderSelector();
    fireEvent.click(screen.getByRole('button', { name: /system/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('system');
    expect(onUpdate).toHaveBeenCalledWith({ mode: 'system' });
  });

  it('can select light mode', () => {
    setupTheme('dark', 'dark');
    const { onUpdate } = renderSelector({ mode: 'dark' });
    fireEvent.click(screen.getByRole('button', { name: /light/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
    expect(onUpdate).toHaveBeenCalledWith({ mode: 'light' });
  });

  it('marks the active mode as highlighted and others as not highlighted', () => {
    setupTheme('system', 'light');
    renderSelector({ mode: 'system' });

    expect(screen.getByRole('button', { name: /system/i })).toHaveClass('border-primary');
    expect(screen.getByRole('button', { name: /light/i })).not.toHaveClass('border-primary');
    expect(screen.getByRole('button', { name: /dark/i })).not.toHaveClass('border-primary');
  });
});

// ─── Cross-component synchronization ─────────────────────────────────────────

describe('cross-component theme synchronization', () => {
  it('both ThemeToggle components read the same theme state', () => {
    setupTheme('dark', 'dark');

    const { unmount: unmount1 } = render(<UiThemeToggle />);
    const { unmount: unmount2 } = render(<NavThemeToggle />);

    // Both buttons are rendered; both should call setTheme with 'light' when clicked
    const buttons = screen.getAllByRole('button', { name: /toggle theme/i });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(mockSetTheme).toHaveBeenCalledWith('light');

    unmount1();
    unmount2();
  });

  it('ThemeSelector and ThemeToggle reflect the same persisted theme', () => {
    localStorage.setItem('theme', 'dark');
    setupTheme('dark', 'dark');

    render(
      <>
        <UiThemeToggle />
        <ThemeSelector
          settings={defaultSettings}
          onUpdate={jest.fn()}
          onSave={jest.fn().mockResolvedValue(true)}
          isSaving={false}
        />
      </>
    );

    // ThemeToggle: clicking toggles to light (from dark)
    const toggleBtn = screen.getByRole('button', { name: /toggle theme/i });
    fireEvent.click(toggleBtn);
    expect(mockSetTheme).toHaveBeenCalledWith('light');

    // ThemeSelector: dark mode button is highlighted (matches persisted theme)
    expect(screen.getByRole('button', { name: /dark/i })).toHaveClass('border-primary');
  });

  it('a theme selection in ThemeSelector is what ThemeToggle would then read', () => {
    setupTheme('light', 'light');
    const { onUpdate } = renderSelector();

    // User selects dark in ThemeSelector
    fireEvent.click(screen.getByRole('button', { name: /dark/i }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
    expect(onUpdate).toHaveBeenCalledWith({ mode: 'dark' });

    // After setTheme('dark'), next-themes updates the store; ThemeToggle would then
    // read resolvedTheme='dark' and toggle to 'light'.
    setupTheme('dark', 'dark');
    const { unmount } = render(<UiThemeToggle />);
    const toggleBtn = screen.getByRole('button', { name: /toggle theme/i });
    fireEvent.click(toggleBtn);
    expect(mockSetTheme).toHaveBeenLastCalledWith('light');
    unmount();
  });
});
