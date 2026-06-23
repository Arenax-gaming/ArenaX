/**
 * Tests for #299 SettingsImportExport + the pure bundle helpers.
 * Also counts as testing-coverage work for #302.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsImportExport, {
  buildSettingsBundle,
  parseSettingsBundle,
} from '@/components/settings/SettingsImportExport';

interface DemoSettings {
  theme: 'light' | 'dark';
  highContrast: boolean;
}

describe('buildSettingsBundle', () => {
  it('wraps the payload with version + ISO timestamp', () => {
    const bundle = buildSettingsBundle<DemoSettings>(
      { theme: 'dark', highContrast: true },
      2,
      () => new Date('2026-05-28T12:00:00Z')
    );
    expect(bundle.version).toBe(2);
    expect(bundle.exportedAt).toBe('2026-05-28T12:00:00.000Z');
    expect(bundle.payload).toEqual({ theme: 'dark', highContrast: true });
  });

  it('defaults to version 1 when not specified', () => {
    const bundle = buildSettingsBundle({ a: 1 });
    expect(bundle.version).toBe(1);
  });
});

describe('parseSettingsBundle', () => {
  const validBundle = JSON.stringify({
    version: 1,
    exportedAt: '2026-05-28T00:00:00Z',
    payload: { theme: 'dark' },
  });

  it('round-trips a valid bundle', () => {
    const parsed = parseSettingsBundle(validBundle);
    expect(parsed.version).toBe(1);
    expect(parsed.payload).toEqual({ theme: 'dark' });
  });

  it('rejects invalid JSON with a clear error', () => {
    expect(() => parseSettingsBundle('not json')).toThrow(/not valid JSON/);
  });

  it('rejects non-object roots', () => {
    expect(() => parseSettingsBundle(JSON.stringify(42))).toThrow(/must be an object/);
  });

  it('requires a numeric version', () => {
    expect(() =>
      parseSettingsBundle(JSON.stringify({ payload: {}, exportedAt: 'x' }))
    ).toThrow(/numeric `version`/);
  });

  it('requires a payload object', () => {
    expect(() =>
      parseSettingsBundle(
        JSON.stringify({ version: 1, exportedAt: 'x', payload: null })
      )
    ).toThrow(/`payload` object/);
  });

  it('requires an exportedAt string', () => {
    expect(() =>
      parseSettingsBundle(JSON.stringify({ version: 1, payload: {} }))
    ).toThrow(/exportedAt/);
  });
});

describe('<SettingsImportExport />', () => {
  it('renders Export and Import buttons', () => {
    render(
      <SettingsImportExport
        getSettings={() => ({ theme: 'dark' })}
        onApply={() => undefined}
      />
    );
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import/i })).toBeInTheDocument();
  });

  it('calls onApply with the parsed payload on a valid file', async () => {
    const onApply = jest.fn();
    render(
      <SettingsImportExport<DemoSettings>
        getSettings={() => ({ theme: 'dark', highContrast: false })}
        onApply={onApply}
      />
    );
    const payloadText = JSON.stringify({
      version: 1,
      exportedAt: '2026-05-28T00:00:00Z',
      payload: { theme: 'light', highContrast: true },
    });
    const file = new File([payloadText], 'settings.json', {
      type: 'application/json',
    });
    // jsdom's File.text() resolver varies by version; pin the result
    // to the literal payload so the component sees the expected bytes.
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: () => Promise.resolve(payloadText),
    });
    const input = screen.getByTestId('settings-import-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenCalledWith({ theme: 'light', highContrast: true });
    expect(
      await screen.findByText('Settings imported successfully.')
    ).toBeInTheDocument();
  });

  it('surfaces a clear error for an invalid bundle without calling onApply', async () => {
    const onApply = jest.fn();
    render(
      <SettingsImportExport
        getSettings={() => ({ x: 1 })}
        onApply={onApply}
      />
    );
    const invalid = '{"bogus": true}';
    const file = new File([invalid], 'settings.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: () => Promise.resolve(invalid),
    });
    fireEvent.change(screen.getByTestId('settings-import-input'), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  it('rejects payloads that fail the validator', async () => {
    const onApply = jest.fn();
    const validate = (p: unknown): p is DemoSettings =>
      typeof p === 'object' && p !== null && 'theme' in p;

    render(
      <SettingsImportExport<DemoSettings>
        getSettings={() => ({ theme: 'dark', highContrast: false })}
        onApply={onApply}
        validate={validate}
      />
    );
    const badText = JSON.stringify({
      version: 1,
      exportedAt: '2026-05-28T00:00:00Z',
      payload: { unrelated: true },
    });
    const badFile = new File([badText], 'settings.json', {
      type: 'application/json',
    });
    Object.defineProperty(badFile, 'text', {
      configurable: true,
      value: () => Promise.resolve(badText),
    });
    fireEvent.change(screen.getByTestId('settings-import-input'), {
      target: { files: [badFile] },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    );
    expect(onApply).not.toHaveBeenCalled();
  });
});
