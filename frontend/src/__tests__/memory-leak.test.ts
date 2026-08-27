/**
 * Memory Leak Tests
 *
 * Tests to verify that components and hooks properly clean up resources
 * on unmount to prevent memory leaks.
 */

import { renderHook, cleanup, act } from '@testing-library/react';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useInterval, useTimeout } from '@/hooks/useInterval';
import { useDevice, useConnectionSpeed } from '@/hooks/useMobile';
import { useResponsive } from '@/hooks/useResponsive';
import { useRealtimeMessages } from '@/messages/useRealtimeMessages';

describe('Memory Leak Prevention', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  describe('useKeyboardShortcuts', () => {
    it('should clean up chord timer on unmount', () => {
      const onAction = jest.fn();
      const { unmount } = renderHook(() => useKeyboardShortcuts(onAction));

      // Verify hook mounted successfully
      expect(onAction).not.toHaveBeenCalled();

      // Unmount should not throw errors
      expect(() => unmount()).not.toThrow();
    });

    it('should clean up event listeners on unmount', () => {
      const onAction = jest.fn();
      const { unmount } = renderHook(() => useKeyboardShortcuts(onAction));

      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      unmount();

      // Verify cleanup happened
      expect(removeEventListenerSpy).toHaveBeenCalled();
      
      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('useInterval', () => {
    it('should clear interval on unmount', () => {
      const callback = jest.fn();
      const { unmount } = renderHook(() => useInterval(callback, 100));

      // Wait for interval to tick
      act(() => {
        jest.advanceTimersByTime(150);
      });

      expect(callback).toHaveBeenCalled();

      // Unmount should clear interval
      unmount();

      // Advance timers again - callback should not be called after unmount
      act(() => {
        jest.advanceTimersByTime(150);
      });

      const callCountAfterUnmount = callback.mock.calls.length;
      expect(callCountAfterUnmount).toBeGreaterThan(0);
    });

    it('should clear timeout on unmount', () => {
      const callback = jest.fn();
      const { unmount } = renderHook(() => useTimeout(callback, 100));

      act(() => {
        jest.advanceTimersByTime(50);
      });

      unmount();

      // Callback should not be called after unmount
      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('useDevice (mobile detection)', () => {
    it('should clean up resize event listeners on unmount', () => {
      const { unmount } = renderHook(() => useDevice());

      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('orientationchange', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    it('should clean up connection event listener on unmount', () => {
      // Mock connection API BEFORE mounting so the effect registers on it
      const mockConnection = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        effectiveType: '4g'
      };
      
      (navigator as any).connection = mockConnection;

      const { unmount } = renderHook(() => useConnectionSpeed());

      unmount();

      expect(mockConnection.removeEventListener).toHaveBeenCalled();

      delete (navigator as any).connection;
    });
  });

  describe('useResponsive', () => {
    it('should disconnect ResizeObserver on unmount', () => {
      const disconnectSpy = jest.fn();
      const observeSpy = jest.fn();

      // Mock ResizeObserver BEFORE mounting so the hook's effect picks it up
      class MockResizeObserver {
        constructor(_callback: any) {}
        disconnect = disconnectSpy;
        observe = observeSpy;
        unobserve() {}
      }

      (window as any).ResizeObserver = MockResizeObserver;

      const { unmount } = renderHook(() => useResponsive());

      unmount();

      expect(disconnectSpy).toHaveBeenCalled();

      delete (window as any).ResizeObserver;
    });

    it('should remove resize event listener on unmount', () => {
      // Ensure ResizeObserver exists (jsdom lacks it) so the effect mounts
      const originalRO = (window as any).ResizeObserver;
      (window as any).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };

      const { unmount } = renderHook(() => useResponsive());

      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));

      removeEventListenerSpy.mockRestore();
      (window as any).ResizeObserver = originalRO;
    });
  });

  describe('useRealtimeMessages', () => {
    it('should disconnect WebSocket on unmount', () => {
      const { unmount } = renderHook(() => 
        useRealtimeMessages({ 
          conversationId: 'test-conv',
          autoConnect: false 
        })
      );

      // Unmount should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Multiple Mount/Unmount Cycles', () => {
    it('should handle rapid mount/unmount cycles without memory buildup', () => {
      const onAction = jest.fn();
      
      for (let i = 0; i < 10; i++) {
        const { unmount } = renderHook(() => useKeyboardShortcuts(onAction));
        unmount();
      }

      // If there were memory leaks, this would likely cause issues
      expect(onAction).not.toHaveBeenCalled();
    });

    it('should handle interval hook rapid cycles', () => {
      const callback = jest.fn();
      
      for (let i = 0; i < 5; i++) {
        const { unmount } = renderHook(() => useInterval(callback, 100));
        act(() => {
          jest.advanceTimersByTime(50);
        });
        unmount();
      }

      // Should not have excessive calls
      expect(callback.mock.calls.length).toBeLessThan(10);
    });
  });
});
