import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WinShareCard } from "@/components/match/WinShareCard";
import { generateWinShareCard } from "@/api/winShareCard";

jest.mock("@/api/winShareCard", () => ({
  generateWinShareCard: jest.fn(),
}));

const mockedGenerateCard = jest.mocked(generateWinShareCard);

function setNavigatorShare(
  share: (data: ShareData) => Promise<void>,
  canShare: (data: ShareData) => boolean,
) {
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: canShare });
}

afterEach(() => {
  jest.restoreAllMocks();
  mockedGenerateCard.mockReset();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "canShare");
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("WinShareCard", () => {
  beforeEach(() => {
    mockedGenerateCard.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  });

  it("shares the generated PNG with the Web Share API when supported", async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    setNavigatorShare(share, jest.fn().mockReturnValue(true));
    render(
      <WinShareCard
        playerName="Alpha"
        gameName="Arena"
        tournamentName="Finals"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share win card" }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    const shareData = share.mock.calls[0][0];
    expect(shareData.files?.[0]).toMatchObject({
      name: "alpha-arenax-win.png",
      type: "image/png",
    });
    expect(mockedGenerateCard).toHaveBeenCalledWith({
      playerName: "Alpha",
      gameName: "Arena",
      tournamentName: "Finals",
    });
  });

  it("downloads the PNG when file sharing is not supported", async () => {
    setNavigatorShare(jest.fn(), jest.fn().mockReturnValue(false));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn().mockReturnValue("blob:win-card"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(
      <WinShareCard
        playerName="Alpha"
        gameName="Arena"
        tournamentName="Finals"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Share win card" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Win card downloaded."));
    expect(click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });
});