import {
  blockedWord,
  directRoom,
  loadHistory,
  namedRoom,
  parseChatEvent,
  remember,
  tournamentRoom,
} from "@/lib/inAppChat";

describe("in-app chat", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("builds tournament rooms and order-independent direct rooms", () => {
    expect(tournamentRoom("t1")).toBe("tournament:t1");
    expect(directRoom("b", "a")).toBe(directRoom("a", "b"));
    expect(directRoom("b", "a")).toBe("dm:a:b");
    expect(namedRoom("party-session")).toBe("room:party-session");
  });

  it("blocks profanity as a whole word and keeps clean text", () => {
    expect(blockedWord("what the fuck")).toBe("fuck");
    expect(blockedWord("CLASS assignment")).toBeNull();
  });

  it("persists history and ignores a message for another room", () => {
    const room = directRoom("me", "friend");
    remember({
      id: "1",
      roomId: room,
      senderId: "me",
      body: "hello",
      createdAt: "2026-10-15T00:00:00.000Z",
    });
    expect(loadHistory(room).map((line) => line.body)).toEqual(["hello"]);

    const foreign = parseChatEvent(
      JSON.stringify({
        event: {
          type: "chat_message",
          room_id: "tournament:other",
          message_id: "9",
          sender_id: "x",
          body: "nope",
          timestamp: "2026-10-15T00:00:00.000Z",
        },
      }),
      room,
    );
    expect(foreign).toBeNull();

    const mine = parseChatEvent(
      JSON.stringify({
        event: {
          type: "chat_message",
          room_id: room,
          message_id: "2",
          sender_id: "friend",
          body: "hi",
          timestamp: "2026-10-15T00:00:01.000Z",
        },
      }),
      room,
    );
    expect(mine?.body).toBe("hi");
  });
});
