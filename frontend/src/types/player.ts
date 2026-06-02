/** Base player identity used across lobby, party, and social UIs. */
export interface Player {
  id: string;
  username: string;
  avatar?: string;
}

/** Player in a pre-game lobby or party with ready/host state. */
export interface PartyPlayer extends Player {
  isReady: boolean;
  isHost: boolean;
}
