export interface WinShareCardData {
  playerName: string;
  gameName: string;
  tournamentName: string;
}

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

function drawLabel(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  let text = value.trim() || "Unknown";
  while (context.measureText(text).width > maxWidth && text.length > 3) {
    text = `${text.slice(0, -4)}...`;
  }
  context.fillText(text, x, y, maxWidth);
}

export function generateWinShareCard({
  playerName,
  gameName,
  tournamentName,
}: WinShareCardData): Promise<Blob> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Win cards can only be generated in a browser."));
  }

  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Canvas is unavailable."));

  const background = context.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  background.addColorStop(0, "#111827");
  background.addColorStop(0.58, "#1e3a5f");
  background.addColorStop(1, "#2563eb");
  context.fillStyle = background;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  context.fillStyle = "rgba(16, 185, 129, 0.16)";
  context.beginPath();
  context.arc(1080, 90, 210, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#10b981";
  context.fillRect(72, 76, 8, 478);

  context.textAlign = "left";
  context.fillStyle = "#ffffff";
  context.font = "700 30px Arial, sans-serif";
  context.fillText("ArenaX", 112, 112);

  context.fillStyle = "#6ee7b7";
  context.font = "700 20px Arial, sans-serif";
  context.fillText("MATCH VICTORY", 112, 218);

  context.fillStyle = "#ffffff";
  context.font = "700 76px Arial, sans-serif";
  drawLabel(context, playerName, 108, 316, 980);

  context.fillStyle = "#d1d5db";
  context.font = "400 30px Arial, sans-serif";
  context.fillText("Tournament champion", 112, 370);

  context.fillStyle = "#ffffff";
  context.font = "600 26px Arial, sans-serif";
  drawLabel(context, tournamentName, 112, 472, 900);

  context.fillStyle = "#bfdbfe";
  context.font = "500 22px Arial, sans-serif";
  drawLabel(context, gameName, 112, 520, 900);

  context.textAlign = "right";
  context.fillStyle = "rgba(255, 255, 255, 0.76)";
  context.font = "600 18px Arial, sans-serif";
  context.fillText("ARENAX.GG", 1120, 560);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The win card could not be exported."));
    }, "image/png");
  });
}