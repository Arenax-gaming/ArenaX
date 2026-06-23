/**
 * Tests for Tooltip and Popover components (#525).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';

// framer-motion: skip animations in tests
jest.mock('framer-motion', () => {
  const React = require('react');
  return {
    motion: {
      div: React.forwardRef(({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { exit?: unknown }, ref: React.Ref<HTMLDivElement>) => (
        <div ref={ref} {...props}>{children}</div>
      )),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

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
});

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
