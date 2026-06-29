import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AuditLogsPage from "@/app/[locale]/admin/audit-logs/page";
import { api } from "@/lib/api";

// ── Navigation mocks ───────────────────────────────────────────────────────

let mockSearchParamsData: Record<string, string> = {};
const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsData[key] ?? null,
  }),
  useRouter: () => ({ push: mockPush }),
}));

// ── API mock ───────────────────────────────────────────────────────────────

jest.mock("@/lib/api", () => ({
  api: { getAuditLogs: jest.fn() },
}));
const mockGetAuditLogs = api.getAuditLogs as jest.Mock;

// ── Component / lib mocks ──────────────────────────────────────────────────

jest.mock("@/components/navigation/ProtectedPage", () => ({
  ProtectedPage: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({ "error.title": "Something went wrong", "common.retry": "Try again" }[key] ?? key),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────

const sampleLogs = [
  {
    id: "log-1",
    actor: "admin@example.com",
    action: "USER_BANNED",
    resourceType: "User",
    resourceId: "u-001",
    createdAt: "2026-01-10T10:00:00Z",
  },
  {
    id: "log-2",
    actor: "system",
    action: "TOURNAMENT_CREATED",
    resourceType: "Tournament",
    resourceId: "t-001",
    createdAt: "2026-01-11T11:00:00Z",
  },
];

const makeResponse = (
  overrides: Partial<{ logs: typeof sampleLogs; total: number; page: number }> = {}
) => ({
  logs: sampleLogs,
  total: sampleLogs.length,
  page: 1,
  pageSize: 20,
  ...overrides,
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Wait for the initial page load to complete (loading → data). */
const waitForLogs = () =>
  waitFor(() => expect(screen.getByText("USER_BANNED")).toBeInTheDocument());

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AuditLogsPage", () => {
  beforeEach(() => {
    mockSearchParamsData = {};
    mockPush.mockClear();
    mockGetAuditLogs.mockClear();
    mockGetAuditLogs.mockResolvedValue(makeResponse());
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  it("renders the page heading", async () => {
    render(<AuditLogsPage />);
    expect(
      screen.getByRole("heading", { name: /audit logs/i })
    ).toBeInTheDocument();
  });

  it("shows a loading skeleton while the request is in progress", () => {
    mockGetAuditLogs.mockImplementation(() => new Promise(() => {}));
    render(<AuditLogsPage />);
    // Log data is absent while loading
    expect(screen.queryByText("USER_BANNED")).not.toBeInTheDocument();
  });

  it("renders log rows after a successful fetch", async () => {
    render(<AuditLogsPage />);
    await waitForLogs();
    expect(screen.getByText("TOURNAMENT_CREATED")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
  });

  // ── Error / empty states ──────────────────────────────────────────────────

  it("displays the error message when the api call fails", async () => {
    mockGetAuditLogs.mockRejectedValue(new Error("Internal server error"));
    render(<AuditLogsPage />);
    await waitFor(() =>
      expect(screen.getByText(/internal server error/i)).toBeInTheDocument()
    );
  });

  it("shows an empty-state heading when no logs are returned", async () => {
    mockGetAuditLogs.mockResolvedValue(makeResponse({ logs: [], total: 0 }));
    render(<AuditLogsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /no audit logs found/i })
      ).toBeInTheDocument()
    );
  });

  // ── Search filtering ──────────────────────────────────────────────────────

  it("passes the search term to the api after the debounce delay", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(/search by actor/i);
    fireEvent.change(input, { target: { value: "admin" } });

    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "admin" })
      )
    );
  });

  it("does not call the api immediately before the debounce delay elapses", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());
    mockGetAuditLogs.mockClear();

    const input = screen.getByPlaceholderText(/search by actor/i);
    fireEvent.change(input, { target: { value: "typing" } });

    // Synchronously after the event — debounce timer has not fired yet.
    expect(mockGetAuditLogs).not.toHaveBeenCalled();
  });

  it("debounces rapid input: triggers only one api call for consecutive keystrokes", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());
    mockGetAuditLogs.mockClear();

    const input = screen.getByPlaceholderText(/search by actor/i);
    fireEvent.change(input, { target: { value: "f" } });
    fireEvent.change(input, { target: { value: "fo" } });
    fireEvent.change(input, { target: { value: "foo" } });

    // Debounce settles once — the last value wins, not three separate calls.
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());
    expect(mockGetAuditLogs).toHaveBeenCalledTimes(1);
    expect(mockGetAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ search: "foo" })
    );
  });

  // ── Date-range filtering ──────────────────────────────────────────────────

  it("passes startDate to the api when the start-date input changes", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-01" },
    });

    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ startDate: "2026-01-01" })
      )
    );
  });

  it("passes endDate to the api when the end-date input changes", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: "2026-01-31" },
    });

    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ endDate: "2026-01-31" })
      )
    );
  });

  it("passes both dates simultaneously when a full date range is selected", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-02-01" },
    });
    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: "2026-02-28" },
    });

    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({
          startDate: "2026-02-01",
          endDate: "2026-02-28",
        })
      )
    );
  });

  // ── URL query-parameter synchronization ───────────────────────────────────

  it("pushes search term to the URL after the debounce delay", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/search by actor/i), {
      target: { value: "system" },
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining("search=system"),
        expect.objectContaining({ scroll: false })
      )
    );
  });

  it("pushes startDate to the URL when the start-date filter is set", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-03-01" },
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining("startDate=2026-03-01"),
        expect.objectContaining({ scroll: false })
      )
    );
  });

  it("uses router.push with scroll:false for client-side URL updates (no full reload)", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: "2026-06-30" },
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const [, options] = mockPush.mock.calls[mockPush.mock.calls.length - 1];
    expect(options).toEqual(expect.objectContaining({ scroll: false }));
  });

  it("removes filter params from the URL when filters are cleared", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-01" },
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    mockPush.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const [url] = mockPush.mock.calls[mockPush.mock.calls.length - 1];
    expect(url).not.toContain("startDate");
  });

  // ── Page-refresh persistence (URL → initial state) ────────────────────────

  it("pre-fills the search input from the URL search param on mount", () => {
    mockSearchParamsData = { search: "persisted-query" };
    render(<AuditLogsPage />);
    expect(screen.getByDisplayValue("persisted-query")).toBeInTheDocument();
  });

  it("calls the api with the URL search param on the initial load", async () => {
    mockSearchParamsData = { search: "url-search" };
    render(<AuditLogsPage />);
    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ search: "url-search" })
      )
    );
  });

  it("pre-fills date inputs from URL params on mount", () => {
    mockSearchParamsData = { startDate: "2026-04-01", endDate: "2026-04-30" };
    render(<AuditLogsPage />);
    expect(screen.getByDisplayValue("2026-04-01")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-04-30")).toBeInTheDocument();
  });

  it("calls the api with date params from the URL on the initial load", async () => {
    mockSearchParamsData = { startDate: "2026-04-01", endDate: "2026-04-30" };
    render(<AuditLogsPage />);
    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: "2026-04-01",
          endDate: "2026-04-30",
        })
      )
    );
  });

  it("fetches the correct page number from the URL on the initial load", async () => {
    mockSearchParamsData = { page: "3" };
    mockGetAuditLogs.mockResolvedValue(makeResponse({ total: 60 }));
    render(<AuditLogsPage />);
    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ page: "3" })
      )
    );
  });

  it("does not push a URL update on the initial mount", async () => {
    render(<AuditLogsPage />);
    await waitForLogs();
    expect(mockPush).not.toHaveBeenCalled();
  });

  // ── Client-side update (no full reload) ───────────────────────────────────

  it("does not call router.push on initial mount (existing URL is correct)", async () => {
    mockSearchParamsData = { search: "existing", startDate: "2026-01-01" };
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("calls router.push only after a filter change, not on initial load", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-05-01" },
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  it("disables the previous-page button on page 1", async () => {
    render(<AuditLogsPage />);
    await waitForLogs();
    expect(
      screen.getByRole("button", { name: /previous page/i })
    ).toBeDisabled();
  });

  it("disables the next-page button when on the last page", async () => {
    // total=2, pageSize=20 → only one page
    render(<AuditLogsPage />);
    await waitForLogs();
    expect(
      screen.getByRole("button", { name: /next page/i })
    ).toBeDisabled();
  });

  it("calls the api with page=2 when the next-page button is clicked", async () => {
    mockGetAuditLogs.mockResolvedValue(makeResponse({ total: 40 }));
    render(<AuditLogsPage />);
    await waitForLogs();

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: "2" })
      )
    );
  });

  it("pushes page=2 to the URL when the next-page button is clicked", async () => {
    mockGetAuditLogs.mockResolvedValue(makeResponse({ total: 40 }));
    render(<AuditLogsPage />);
    await waitForLogs();
    mockPush.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining("page=2"),
        expect.anything()
      )
    );
  });

  it("navigates back to page 1 when the previous-page button is clicked from page 2", async () => {
    mockSearchParamsData = { page: "2" };
    mockGetAuditLogs.mockResolvedValue(makeResponse({ total: 40 }));
    render(<AuditLogsPage />);
    await waitForLogs();

    fireEvent.click(screen.getByRole("button", { name: /previous page/i }));

    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: "1" })
      )
    );
  });

  it("omits page from URL when navigating back to page 1", async () => {
    mockSearchParamsData = { page: "2" };
    mockGetAuditLogs.mockResolvedValue(makeResponse({ total: 40 }));
    render(<AuditLogsPage />);
    await waitForLogs();
    mockPush.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /previous page/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const [url] = mockPush.mock.calls[mockPush.mock.calls.length - 1];
    expect(url).not.toContain("page=");
  });

  it("resets to page 1 when the search filter changes", async () => {
    mockSearchParamsData = { page: "3" };
    mockGetAuditLogs.mockResolvedValue(makeResponse({ total: 60 }));
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(/search by actor/i);
    fireEvent.change(input, { target: { value: "reset-test" } });

    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "reset-test", page: "1" })
      )
    );
  });

  it("resets to page 1 when the start-date filter changes", async () => {
    mockSearchParamsData = { page: "2" };
    mockGetAuditLogs.mockResolvedValue(makeResponse({ total: 40 }));
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-05-01" },
    });

    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ startDate: "2026-05-01", page: "1" })
      )
    );
  });

  // ── Combined filters ──────────────────────────────────────────────────────

  it("passes search + date range together to the api", async () => {
    render(<AuditLogsPage />);
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: "2026-01-31" },
    });
    const input = screen.getByPlaceholderText(/search by actor/i);
    fireEvent.change(input, { target: { value: "combo" } });

    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: "combo",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        })
      )
    );
  });

  it("carries all active URL params into the initial api call", async () => {
    mockSearchParamsData = {
      search: "initial",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      page: "2",
    };
    mockGetAuditLogs.mockResolvedValue(makeResponse({ total: 40 }));
    render(<AuditLogsPage />);
    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          search: "initial",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
          page: "2",
        })
      )
    );
  });

  it("includes active search and date params when navigating pages", async () => {
    mockSearchParamsData = { search: "nav-test", startDate: "2026-06-01" };
    mockGetAuditLogs.mockResolvedValue(makeResponse({ total: 40 }));
    render(<AuditLogsPage />);
    await waitForLogs();

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    await waitFor(() =>
      expect(mockGetAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: "nav-test",
          startDate: "2026-06-01",
          page: "2",
        })
      )
    );
  });
});
