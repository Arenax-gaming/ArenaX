// Main game components
export { Game } from './Game';
export { GameCanvas } from './GameCanvas';
export { GameHUD } from './GameHUD';
export { PlayerControls } from './PlayerControls';
export { ScoreBoard } from './ScoreBoard';
export { GameTimer } from './GameTimer';
export { Minimap } from './Minimap';
export { ChatOverlay } from './ChatOverlay';
export { SettingsOverlay } from './SettingsOverlay';

// Game store
export { useGameStore } from '@/stores/gameStore';
export type { 
  Player, 
  GameState, 
  ChatMessage, 
  GameSettings, 
  PerformanceMetrics 
} from '@/stores/gameStore';
