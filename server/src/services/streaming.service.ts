/**
 * @fileoverview Real-Time Gameplay Streaming Service (Issue #1265)
 * @description Manages real-time Twitch/YouTube Live stream embeds and WebSocket broadcasts for matches.
 */

export interface StreamEmbedConfig {
  matchId: string;
  provider: "twitch" | "youtube" | "custom";
  channelNameOrId: string;
  embedUrl: string;
  isLive: boolean;
}

/**
 * Generates an embeddable stream URL for Twitch or YouTube Live.
 */
export function generateStreamEmbedUrl(
  provider: "twitch" | "youtube" | "custom",
  channelNameOrId: string,
  parentDomain: string = "arenax.gg",
): StreamEmbedConfig {
  let embedUrl = "";
  if (provider === "twitch") {
    embedUrl = `https://player.twitch.tv/?channel=${encodeURIComponent(channelNameOrId)}&parent=${encodeURIComponent(parentDomain)}`;
  } else if (provider === "youtube") {
    embedUrl = `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelNameOrId)}`;
  } else {
    embedUrl = channelNameOrId;
  }

  return {
    matchId: "",
    provider,
    channelNameOrId,
    embedUrl,
    isLive: true,
  };
}

/**
 * Binds a gameplay stream to a match.
 */
export function bindStreamToMatch(matchId: string, streamConfig: StreamEmbedConfig): StreamEmbedConfig {
  return {
    ...streamConfig,
    matchId,
  };
}
