/**
 * ArenaX Real-Time Messages — public barrel
 *
 * Import from "@/messages" for WebSocket management and message hooks.
 */

export { WebSocketManager, getWsEvents, clearWsEvents } from "./wsManager";
export type { ConnectionStatus, WsMessage, WsConnectionConfig, ConnectionMetrics, WsAnalyticsEvent } from "./wsManager";

export {
  MessageStore,
  messageStore,
  getMessageAnalytics,
  getMessageDeliveryStats,
} from "./messageStore";
export type {
  ChatMessage,
  MessageStatus,
  Conversation,
  QueuedMessage,
  MessageAnalyticsEvent,
} from "./messageStore";

export {
  useRealtimeMessages,
  useWsStatus,
  useTotalUnread,
} from "./useRealtimeMessages";
export type { UseRealtimeMessagesOptions, UseRealtimeMessagesReturn } from "./useRealtimeMessages";
