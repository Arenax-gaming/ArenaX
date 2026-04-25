import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  score: number;
  color: string;
  isLocal: boolean;
}

export interface GameState {
  players: Player[];
  localPlayer: Player | null;
  gameStatus: 'waiting' | 'playing' | 'paused' | 'ended';
  gameTime: number;
  maxGameTime: number;
  chatMessages: ChatMessage[];
  settings: GameSettings;
  performance: PerformanceMetrics;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
  type: 'chat' | 'system' | 'command';
}

export interface GameSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  graphics: 'low' | 'medium' | 'high';
  showMinimap: boolean;
  showChat: boolean;
  showFPS: boolean;
  controls: {
    moveUp: string;
    moveDown: string;
    moveLeft: string;
    moveRight: string;
    action: string;
    chat: string;
    pause: string;
  };
}

export interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  memoryUsage: number;
  networkLatency: number;
}

export interface GameActions {
  // Player actions
  updateLocalPlayer: (updates: Partial<Player>) => void;
  addPlayer: (player: Player) => void;
  removePlayer: (playerId: string) => void;
  updatePlayer: (playerId: string, updates: Partial<Player>) => void;
  
  // Game state actions
  setGameStatus: (status: GameState['gameStatus']) => void;
  startGame: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  endGame: () => void;
  updateGameTime: (time: number) => void;
  
  // Chat actions
  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  clearChatMessages: () => void;
  
  // Settings actions
  updateSettings: (settings: Partial<GameSettings>) => void;
  resetSettings: () => void;
  
  // Performance actions
  updatePerformanceMetrics: (metrics: Partial<PerformanceMetrics>) => void;
}

const defaultSettings: GameSettings = {
  masterVolume: 80,
  sfxVolume: 100,
  musicVolume: 70,
  graphics: 'medium',
  showMinimap: true,
  showChat: true,
  showFPS: false,
  controls: {
    moveUp: 'w',
    moveDown: 's',
    moveLeft: 'a',
    moveRight: 'd',
    action: ' ',
    chat: 'Enter',
    pause: 'Escape',
  },
};

const defaultLocalPlayer: Player = {
  id: 'local',
  name: 'Player',
  x: 400,
  y: 300,
  health: 100,
  maxHealth: 100,
  score: 0,
  color: '#00ff00',
  isLocal: true,
};

export const useGameStore = create<GameState & GameActions>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    players: [],
    localPlayer: defaultLocalPlayer,
    gameStatus: 'waiting',
    gameTime: 0,
    maxGameTime: 300, // 5 minutes
    chatMessages: [],
    settings: defaultSettings,
    performance: {
      fps: 60,
      frameTime: 16.67,
      memoryUsage: 0,
      networkLatency: 0,
    },

    // Player actions
    updateLocalPlayer: (updates) =>
      set((state) => ({
        localPlayer: state.localPlayer
          ? { ...state.localPlayer, ...updates }
          : null,
      })),

    addPlayer: (player) =>
      set((state) => ({
        players: state.players.some((p) => p.id === player.id)
          ? state.players
          : [...state.players, player],
      })),

    removePlayer: (playerId) =>
      set((state) => ({
        players: state.players.filter((p) => p.id !== playerId),
      })),

    updatePlayer: (playerId, updates) =>
      set((state) => ({
        players: state.players.map((p) =>
          p.id === playerId ? { ...p, ...updates } : p
        ),
      })),

    // Game state actions
    setGameStatus: (status) => set({ gameStatus: status }),

    startGame: () =>
      set({
        gameStatus: 'playing',
        gameTime: 0,
        players: [],
        localPlayer: defaultLocalPlayer,
        chatMessages: [],
      }),

    pauseGame: () => set({ gameStatus: 'paused' }),

    resumeGame: () => set({ gameStatus: 'playing' }),

    endGame: () => set({ gameStatus: 'ended' }),

    updateGameTime: (time) => set({ gameTime: time }),

    // Chat actions
    addChatMessage: (message) =>
      set((state) => ({
        chatMessages: [
          ...state.chatMessages,
          {
            ...message,
            id: `${Date.now()}-${Math.random()}`,
            timestamp: Date.now(),
          },
        ].slice(-50), // Keep only last 50 messages
      })),

    clearChatMessages: () => set({ chatMessages: [] }),

    // Settings actions
    updateSettings: (newSettings) =>
      set((state) => ({
        settings: { ...state.settings, ...newSettings },
      })),

    resetSettings: () => set({ settings: defaultSettings }),

    // Performance actions
    updatePerformanceMetrics: (metrics) =>
      set((state) => ({
        performance: { ...state.performance, ...metrics },
      })),
  }))
);

// Selectors for optimized re-renders
export const useLocalPlayer = () => useGameStore((state) => state.localPlayer);
export const usePlayers = () => useGameStore((state) => state.players);
export const useGameStatus = () => useGameStore((state) => state.gameStatus);
export const useGameTime = () => useGameStore((state) => state.gameTime);
export const useChatMessages = () => useGameStore((state) => state.chatMessages);
export const useGameSettings = () => useGameStore((state) => state.settings);
export const usePerformanceMetrics = () => useGameStore((state) => state.performance);
