/**
 * Tests for useInfiniteScroll hook (#524).
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';

// Minimal IntersectionObserver mock
class MockIO {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

let mockIO: MockIO;

beforeEach(() => {
  jest.resetAllMocks();
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = jest.fn(
    (cb: IntersectionObserverCallback) => {
      mockIO = new MockIO(cb);
      return mockIO;
    },
  );
});

function makeFetchPage(pages: Array<{ items: string[]; nextCursor: string | undefined }>) {
  let call = 0;
  return jest.fn(async (_cursor: string | undefined) => {
    const page = pages[call] ?? { items: [], nextCursor: undefined };
    call++;
    return page;
  });
}

describe('useInfiniteScroll', () => {
  it('fetches the first page on mount', async () => {
    const fetchPage = makeFetchPage([
      { items: ['a', 'b'], nextCursor: 'page2' },
    ]);
    const { result } = renderHook(() => useInfiniteScroll({ fetchPage }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual(['a', 'b']);
    expect(result.current.hasMore).toBe(true);
    expect(fetchPage).toHaveBeenCalledWith(undefined);
  });

  it('loads more when sentinel intersects', async () => {
    const fetchPage = makeFetchPage([
      { items: ['a'], nextCursor: 'page2' },
      { items: ['b'], nextCursor: undefined },
    ]);
    const { result } = renderHook(() => useInfiniteScroll({ fetchPage }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual(['a']);

    // Attach sentinel
    const sentinel = document.createElement('div');
    act(() => result.current.sentinelRef(sentinel));

    // Trigger intersection
    await act(async () => { mockIO.trigger(true); });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toEqual(['a', 'b']);
    expect(result.current.hasMore).toBe(false);
  });

  it('does not fire when sentinel leaves the viewport', async () => {
    const fetchPage = makeFetchPage([
      { items: ['a'], nextCursor: 'p2' },
    ]);
    const { result } = renderHook(() => useInfiniteScroll({ fetchPage }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const sentinel = document.createElement('div');
    act(() => result.current.sentinelRef(sentinel));

    act(() => { mockIO.trigger(false); });
    expect(fetchPage).toHaveBeenCalledTimes(1); // no extra call
  });

  it('captures fetch errors without crashing', async () => {
    const fetchPage = jest.fn().mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useInfiniteScroll({ fetchPage }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.items).toEqual([]);
  });

  it('resets state and restarts from the first page', async () => {
    const fetchPage = makeFetchPage([
      { items: ['a'], nextCursor: 'p2' },
      { items: ['b'], nextCursor: undefined },
    ]);
    const { result } = renderHook(() => useInfiniteScroll({ fetchPage }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual(['a']);

    act(() => result.current.reset());

    // After reset the state is cleared
    expect(result.current.items).toEqual([]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
