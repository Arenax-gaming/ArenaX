/**
 * Tests for the admin chat-moderation UI on <ChatInterface /> (issue #890).
 *
 * Acceptance criteria covered:
 *  - flag / report a message
 *  - mute a user for 1 / 24 / 72 hours
 *  - ban a user
 *  - view a user's message history
 *  - undo any action within the (configurable) 5-minute window
 *  - report available to everyone, mute/ban/history gated behind `isAdmin`
 *  - fully backwards-compatible when no `moderation` config is supplied
 */
import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import {
  ChatInterface,
  MUTE_DURATIONS,
  type ChatModerationConfig,
} from "@/components/social/ChatInterface";

// The chat renders against a looser runtime shape than the exported types, so
// fixtures are built as plain objects and passed through `as any`.
const currentUser = {
  id: "me",
  username: "Me",
  elo: 1200,
  status: "online",
} as any;

// A party conversation keeps the header on the icon path (no next/image).
const conversation = {
  id: "c1",
  type: "party",
  participants: [
    { id: "u1", username: "Griefer", status: "online" },
    { id: "me", username: "Me", status: "online" },
  ],
} as any;

let msgSeq = 0;
function makeMessage(overrides: Record<string, unknown> = {}) {
  msgSeq += 1;
  return {
    id: `m${msgSeq}`,
    senderId: "u1",
    senderName: "Griefer",
    content: "you all suck",
    timestamp: "2026-08-25T10:00:00.000Z",
    status: "read",
    ...overrides,
  } as any;
}

function setup(
  moderation?: ChatModerationConfig,
  messages: any[] = [makeMessage()]
) {
  const props = {
    conversations: [conversation],
    activeConversation: conversation,
    messages,
    isTyping: false,
    currentUser,
    onSelectConversation: jest.fn(),
    onSendMessage: jest.fn(),
    moderation,
  };
  const utils = render(<ChatInterface {...(props as any)} />);
  return { ...utils, props };
}

function openMenu(index = 0) {
  const triggers = screen.getAllByLabelText(/^Moderate message from/);
  fireEvent.click(triggers[index]);
  return screen.getByRole("menu", { name: /Moderation actions for/ });
}

beforeEach(() => {
  msgSeq = 0;
  // jsdom has no layout engine; the chat auto-scrolls on mount.
  Element.prototype.scrollIntoView = jest.fn();
});

describe("ChatInterface moderation (#890)", () => {
  it("renders no moderation affordances without a moderation config", () => {
    setup(undefined);
    expect(
      screen.queryByLabelText(/^Moderate message from/)
    ).not.toBeInTheDocument();
  });

  it("does not show the trigger on the admin's own messages", () => {
    setup(
      { isAdmin: true },
      [makeMessage({ senderId: "me", senderName: "Me", content: "gg" })]
    );
    expect(
      screen.queryByLabelText(/^Moderate message from/)
    ).not.toBeInTheDocument();
  });

  it("reports a message and surfaces an undoable toast", () => {
    const onReportMessage = jest.fn();
    const onUndoReport = jest.fn();
    setup({ isAdmin: true, onReportMessage, onUndoReport });

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Report message" }));

    expect(onReportMessage).toHaveBeenCalledWith("m1", {
      senderId: "u1",
      content: "you all suck",
    });

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Message reported");

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(onUndoReport).toHaveBeenCalledWith("m1");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers all three mute presets and mutes for the chosen duration", () => {
    const onMuteUser = jest.fn();
    setup({ isAdmin: true, onMuteUser });

    openMenu();
    // 1 / 24 / 72 hours all present.
    MUTE_DURATIONS.forEach((h) => {
      const label = h === 1 ? "Mute for 1 hour" : `Mute for ${h} hours`;
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("menuitem", { name: "Mute for 24 hours" }));
    expect(onMuteUser).toHaveBeenCalledWith("u1", 24);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Muted Griefer for 24 hours"
    );
  });

  it("bans a user and can undo the ban within the window", () => {
    const onBanUser = jest.fn();
    const onUnbanUser = jest.fn();
    setup({ isAdmin: true, onBanUser, onUnbanUser });

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Ban user" }));
    expect(onBanUser).toHaveBeenCalledWith("u1");

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Banned Griefer");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(onUnbanUser).toHaveBeenCalledWith("u1");
  });

  it("lets non-admins report but hides mute / ban / history", () => {
    setup({ isAdmin: false });

    openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Report message" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Ban user" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Mute for 1 hour" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "View message history" })
    ).not.toBeInTheDocument();
  });

  it("hides the trigger entirely when reporting is disabled for a non-admin", () => {
    setup({ isAdmin: false, canReport: false });
    expect(
      screen.queryByLabelText(/^Moderate message from/)
    ).not.toBeInTheDocument();
  });

  it("opens message history and lists only that user's messages", () => {
    const onViewUserHistory = jest.fn();
    setup(
      { isAdmin: true, onViewUserHistory },
      [
        makeMessage({ content: "hello there" }),
        makeMessage({ senderId: "me", senderName: "Me", content: "be nice" }),
        makeMessage({ content: "spam spam spam" }),
      ]
    );

    openMenu(0); // first Griefer message
    fireEvent.click(
      screen.getByRole("menuitem", { name: "View message history" })
    );
    expect(onViewUserHistory).toHaveBeenCalledWith("u1");

    const dialog = screen.getByRole("dialog", {
      name: "Message history for Griefer",
    });
    const entries = within(dialog).getAllByTestId("history-message");
    expect(entries).toHaveLength(2);
    expect(dialog).toHaveTextContent("hello there");
    expect(dialog).toHaveTextContent("spam spam spam");
    expect(dialog).not.toHaveTextContent("be nice");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close message history" })
    );
    expect(
      screen.queryByRole("dialog", { name: "Message history for Griefer" })
    ).not.toBeInTheDocument();
  });

  it("reflects banned / muted status on the offending user's messages", () => {
    const { rerender } = setup({ isAdmin: true, bannedUserIds: ["u1"] });
    expect(screen.getByTestId("moderation-status")).toHaveTextContent("Banned");

    rerender(
      <ChatInterface
        {...({
          conversations: [conversation],
          activeConversation: conversation,
          messages: [makeMessage({ id: "m1" })],
          isTyping: false,
          currentUser,
          onSelectConversation: jest.fn(),
          onSendMessage: jest.fn(),
          moderation: { isAdmin: true, mutedUserIds: ["u1"] },
        } as any)}
      />
    );
    expect(screen.getByTestId("moderation-status")).toHaveTextContent("Muted");
  });

  it("auto-dismisses the undo toast after the undo window elapses", () => {
    jest.useFakeTimers();
    try {
      const onMuteUser = jest.fn();
      setup({ isAdmin: true, undoWindowMs: 1000, onMuteUser });

      openMenu();
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Mute for 1 hour" })
      );
      expect(screen.getByRole("status")).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
