/**
 * Tests for Tooltip and Popover components (#525, #551).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';

// framer-motion: skip animations in tests
jest.mock('framer-motion', () => {
  const React = require('react');
  const MotionDiv = React.forwardRef(({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { exit?: unknown }, ref: React.Ref<HTMLDivElement>) => (
    <div ref={ref} {...props}>{children}</div>
  ));
  MotionDiv.displayName = 'MotionDiv';
  return {
    motion: {
      div: MotionDiv,
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderTooltip(delayMs = 0) {
  return render(
    <Tooltip delayMs={delayMs}>
      <TooltipTrigger>
        <button type="button">Trigger</button>
      </TooltipTrigger>
      <TooltipContent>Tip text</TooltipContent>
    </Tooltip>,
  );
}

// ---------------------------------------------------------------------------
// Existing hover tests
// ---------------------------------------------------------------------------

describe('Tooltip', () => {
  it('renders trigger without content visible initially', () => {
    render(
      <Tooltip>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tip text</TooltipContent>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows content after mouseenter', async () => {
    jest.useFakeTimers();
    render(
      <Tooltip delayMs={0}>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tip text</TooltipContent>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Hover me'));
    jest.runAllTimers();
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tip text');
    jest.useRealTimers();
  });

  it('hides content after mouseleave', async () => {
    jest.useFakeTimers();
    render(
      <Tooltip delayMs={0}>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tip text</TooltipContent>
      </Tooltip>,
    );
    const trigger = screen.getByText('Hover me');
    fireEvent.mouseEnter(trigger);
    jest.runAllTimers();
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
    fireEvent.mouseLeave(trigger);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Keyboard accessibility tests — issue #551
  // -------------------------------------------------------------------------

  describe('keyboard accessibility (#551)', () => {
    it('shows tooltip on focus', async () => {
      jest.useFakeTimers();
      renderTooltip();
      fireEvent.focus(screen.getByRole('button', { name: 'Trigger' }).parentElement!);
      jest.runAllTimers();
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      jest.useRealTimers();
    });

    it('hides tooltip on blur', async () => {
      jest.useFakeTimers();
      renderTooltip();
      const triggerSpan = screen.getByRole('button', { name: 'Trigger' }).parentElement!;
      fireEvent.focus(triggerSpan);
      jest.runAllTimers();
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      fireEvent.blur(triggerSpan);
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
      jest.useRealTimers();
    });

    it('dismisses tooltip with Escape key without moving focus', async () => {
      jest.useFakeTimers();
      renderTooltip();
      const triggerSpan = screen.getByRole('button', { name: 'Trigger' }).parentElement!;

      // Show via focus
      fireEvent.focus(triggerSpan);
      jest.runAllTimers();
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());

      // Dismiss with Escape
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

      // Focus must remain on the trigger element (not moved away)
      expect(document.activeElement).not.toBe(document.body);
      jest.useRealTimers();
    });

    it('does not close on other keys', async () => {
      jest.useFakeTimers();
      renderTooltip();
      const triggerSpan = screen.getByRole('button', { name: 'Trigger' }).parentElement!;
      fireEvent.focus(triggerSpan);
      jest.runAllTimers();
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      fireEvent.keyDown(document, { key: 'Enter' });
      // Tooltip should still be visible
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      jest.useRealTimers();
    });

    it('trigger has aria-describedby pointing to tooltip id when open', async () => {
      jest.useFakeTimers();
      renderTooltip();
      const triggerSpan = screen.getByRole('button', { name: 'Trigger' }).parentElement!;
      fireEvent.focus(triggerSpan);
      jest.runAllTimers();
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());

      const tooltip = screen.getByRole('tooltip');
      const tooltipId = tooltip.getAttribute('id');
      expect(tooltipId).toBeTruthy();
      expect(triggerSpan).toHaveAttribute('aria-describedby', tooltipId);
      jest.useRealTimers();
    });

    it('trigger has no aria-describedby when tooltip is closed', () => {
      renderTooltip();
      const triggerSpan = screen.getByRole('button', { name: 'Trigger' }).parentElement!;
      expect(triggerSpan).not.toHaveAttribute('aria-describedby');
    });

    it('tooltip content has role="tooltip"', async () => {
      jest.useFakeTimers();
      renderTooltip();
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Trigger' }).parentElement!);
      jest.runAllTimers();
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      jest.useRealTimers();
    });
  });
});

// ---------------------------------------------------------------------------
// Popover tests (unchanged)
// ---------------------------------------------------------------------------

describe('Popover', () => {
  it('renders trigger without dialog initially', () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows dialog on click', async () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>,
    );
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toHaveTextContent('Popover body');
  });

  it('toggles closed on second click', async () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByText('Open');
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on Escape key', async () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>,
    );
    fireEvent.click(screen.getByText('Open'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
