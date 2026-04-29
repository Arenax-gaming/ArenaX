# ArenaX Game Interface

A comprehensive in-game interface built with React, TypeScript, and Zustand for state management. This implementation provides a complete gaming experience with real-time updates, responsive controls, and modern UI components.

## Features

### Core Components

- **GameCanvas** - Main game rendering area with 60fps Canvas API
- **GameHUD** - Heads-up display with health, score, and game status
- **PlayerControls** - Keyboard and mouse input handling
- **ScoreBoard** - Real-time score tracking and leaderboard
- **GameTimer** - Countdown timer with game state management
- **Minimap** - Real-time minimap with player positions
- **ChatOverlay** - In-game chat with quick commands
- **SettingsOverlay** - Comprehensive settings management

### Game State Management

Uses Zustand for centralized state management with:
- Player data and positions
- Game status (waiting, playing, paused, ended)
- Real-time score updates
- Chat messages and commands
- User preferences and settings
- Performance metrics

### Technical Implementation

#### Canvas Rendering
- 60fps game loop using `requestAnimationFrame`
- Smooth player movement and animations
- Grid-based background with visual indicators
- Real-time player position updates

#### Input Handling
- WASD movement controls
- Space bar for actions
- Enter for chat
- Tab for scoreboard
- Escape for pause/settings
- Customizable key bindings

#### UI Features
- Responsive design with Tailwind CSS
- Dark theme optimized for gaming
- Non-intrusive HUD elements
- Minimizable and hideable panels
- Real-time performance monitoring

## Usage

### Basic Setup

```tsx
import { Game } from '@/components/game';

export default function GamePage() {
  return <Game />;
}
```

### Individual Components

```tsx
import { 
  GameCanvas, 
  GameHUD, 
  PlayerControls, 
  ScoreBoard 
} from '@/components/game';

// Use components individually
<GameCanvas width={800} height={600} />
<GameHUD />
<PlayerControls />
<ScoreBoard />
```

### State Management

```tsx
import { useGameStore } from '@/stores/gameStore';

function GameComponent() {
  const localPlayer = useGameStore(state => state.localPlayer);
  const updateLocalPlayer = useGameStore(state => state.updateLocalPlayer);
  
  // Update player position
  updateLocalPlayer({ x: 100, y: 200 });
}
```

## Controls

### Default Key Bindings

| Action | Key |
|--------|-----|
| Move Up | W |
| Move Down | S |
| Move Left | A |
| Move Right | D |
| Action | Space |
| Chat | Enter |
| Pause | Escape |

### Quick Commands

- `/help` - Show available commands
- `/stats` - Show player statistics
- `/score` - Show current score
- `/time` - Show remaining time
- `/gg` - Good game!
- `/nice` - Nice play!
- `/oops` - My mistake!
- `/brb` - Be right back

## Performance

### Optimizations

- Efficient Canvas rendering with dirty rectangle updates
- Optimized state selectors to prevent unnecessary re-renders
- Frame rate monitoring and adaptive quality settings
- Memory-efficient chat message management (max 50 messages)

### Metrics

The game tracks and displays:
- FPS (Frames Per Second)
- Frame time in milliseconds
- Memory usage
- Network latency (when WebSocket is implemented)

## Settings

### Audio
- Master volume control
- Sound effects volume
- Music volume

### Graphics
- Quality settings (Low, Medium, High)
- Performance vs visual quality trade-offs

### UI
- Toggle minimap visibility
- Toggle chat overlay
- Show/hide FPS counter

### Controls
- Customizable key bindings
- Reset to defaults option

## Architecture

### Component Structure

```
game/
├── Game.tsx              # Main game container
├── GameCanvas.tsx        # Canvas rendering
├── GameHUD.tsx          # Heads-up display
├── PlayerControls.tsx   # Input handling
├── ScoreBoard.tsx       # Score tracking
├── GameTimer.tsx        # Timer management
├── Minimap.tsx          # Minimap display
├── ChatOverlay.tsx      # Chat interface
├── SettingsOverlay.tsx  # Settings panel
└── index.ts            # Component exports
```

### State Management

```
stores/
└── gameStore.ts         # Zustand store with:
    ├── Player state
    ├── Game state
    ├── Chat system
    ├── Settings
    └── Performance metrics
```

## Development

### Dependencies

- React 18+
- TypeScript
- Zustand (state management)
- Tailwind CSS (styling)
- Lucide React (icons)

### Getting Started

1. Install dependencies:
   ```bash
   npm install zustand
   ```

2. Import and use components:
   ```tsx
   import { Game } from '@/components/game';
   ```

3. Customize settings and controls as needed

## Future Enhancements

### Planned Features

- WebSocket integration for multiplayer
- Advanced graphics options
- Voice chat support
- Replay system
- Tournament integration
- Mobile touch controls

### Performance Improvements

- WebGL rendering for better performance
- Web Workers for heavy computations
- Optimized collision detection
- Adaptive quality based on device capabilities

## Contributing

When adding new features:

1. Follow the existing component structure
2. Use TypeScript for type safety
3. Update the game store for state changes
4. Add performance monitoring if needed
5. Update this README with new features

## License

This implementation is part of the ArenaX project and follows the project's licensing terms.
