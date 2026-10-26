import { generateWinShareCard } from "@/api/winShareCard";

describe("generateWinShareCard", () => {
  it("renders the match details and exports a PNG blob", async () => {
    const labels: string[] = [];
    const gradient = { addColorStop: jest.fn() };
    const context = {
      fillStyle: "",
      font: "",
      textAlign: "",
      measureText: jest.fn((text: string) => ({ width: text.length * 10 })),
      fillText: jest.fn((text: string) => labels.push(text)),
      createLinearGradient: jest.fn(() => gradient),
      fillRect: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    const png = new Blob(["png"], { type: "image/png" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => context),
      toBlob: jest.fn((callback: BlobCallback) => callback(png)),
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation(((tagName: string) =>
      tagName === "canvas" ? canvas : createElement(tagName)) as typeof document.createElement);

    const result = await generateWinShareCard({
      playerName: "Alpha",
      gameName: "Arena",
      tournamentName: "Winter Finals",
    });

    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBe(630);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    expect(result.type).toBe("image/png");
    expect(labels).toEqual(
      expect.arrayContaining(["ArenaX", "MATCH VICTORY", "Alpha", "Winter Finals", "Arena"]),
    );
  });
});