/**
 * /play/party (#292)
 *
 * Pre-game party host page. Lives under /play because that's the
 * pre-game journey the issue lays out (mode selection → party setup →
 * lobby → match). The existing /party route also exists and hosts the
 * standalone social-party UI; this page is a slimmer pre-game-only
 * shell that reuses the existing PartyManager + CountdownTimer +
 * ChatPanel primitives so the visual / interaction language matches
 * the rest of the /play surface.
 */

'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PartyManager from '@/components/game/PartyManager';
import CountdownTimer from '@/components/game/CountdownTimer';
import ChatPanel from '@/components/game/ChatPanel';
import PlayerList from '@/components/game/PlayerList';
import type { PartyPlayer } from '@/types/player';

const MAX_PARTY_SIZE = 4;
const COUNTDOWN_SECONDS = 15;

export default function PlayPartyPage() {
    const router = useRouter();
    const [players, setPlayers] = useState<PartyPlayer[]>([
        {
            id: 'self',
            username: 'You',
            isReady: false,
            isHost: true,
        },
    ]);
    const [countdownActive, setCountdownActive] = useState(false);

    // The party can launch once everyone is ready *and* at least two
    // players are in (a solo party is conceptually a non-party — the
    // user should use /play directly for matchmaking).
    const canLaunch = useMemo(
        () => players.length >= 2 && players.every(player => player.isReady),
        [players]
    );

    const handleToggleReady = (playerId: string) => {
        setPlayers(prev =>
            prev.map(player =>
                player.id === playerId
                    ? { ...player, isReady: !player.isReady }
                    : player
            )
        );
    };

    const handleKick = (playerId: string) => {
        // Hosts can kick anyone other than themselves; the PartyManager
        // already enforces the host-only affordance at the UI level.
        setPlayers(prev => prev.filter(player => player.id !== playerId));
    };

    const handleStartGame = () => {
        if (!canLaunch) return;
        setCountdownActive(true);
    };

    const handleCountdownComplete = () => {
        // Hand off to the existing lobby route — same destination /play
        // hands off to when matchmaking resolves.
        router.push('/play/lobby?session=party-session');
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
            <div className="container mx-auto px-4 py-8 space-y-8">
                <header className="text-center">
                    <h1 className="text-4xl font-bold text-white mb-2">
                        Party Setup
                    </h1>
                    <p className="text-gray-300">
                        Invite teammates, mark yourselves ready, then queue
                        together.
                    </p>
                </header>

                {countdownActive ? (
                    <div className="max-w-md mx-auto bg-white/10 backdrop-blur-lg rounded-xl p-8 border border-white/20 text-center">
                        <p className="text-white mb-4">Launching match…</p>
                        <CountdownTimer
                            seconds={COUNTDOWN_SECONDS}
                            onComplete={handleCountdownComplete}
                        />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 space-y-6">
                            <PartyManager
                                partyId="party-session"
                                players={players}
                                maxPlayers={MAX_PARTY_SIZE}
                                onKick={handleKick}
                                onStartGame={handleStartGame}
                            />
                            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                                <h3 className="text-white font-semibold mb-3">
                                    Ready status
                                </h3>
                                <ul className="space-y-2">
                                    {players.map(player => (
                                        <li
                                            key={player.id}
                                            className="flex items-center justify-between text-sm text-white/80"
                                        >
                                            <span>
                                                {player.username}
                                                {player.isHost && (
                                                    <span className="ml-2 text-xs text-amber-300">
                                                        host
                                                    </span>
                                                )}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleToggleReady(player.id)
                                                }
                                                className={`rounded-md px-2 py-1 text-xs font-medium ${
                                                    player.isReady
                                                        ? 'bg-emerald-400/20 text-emerald-300'
                                                        : 'bg-white/10 text-white/70'
                                                }`}
                                            >
                                                {player.isReady
                                                    ? 'Ready'
                                                    : 'Mark ready'}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <PlayerList players={players} />
                        </div>
                        <aside aria-label="Party chat" className="space-y-4">
                            <ChatPanel roomId="party-session" />
                            <button
                                type="button"
                                disabled={!canLaunch}
                                onClick={handleStartGame}
                                className="w-full rounded-xl bg-amber-400 px-4 py-3 font-semibold text-slate-950 transition-opacity disabled:opacity-50"
                            >
                                {canLaunch
                                    ? 'Launch match'
                                    : 'Everyone must be ready'}
                            </button>
                        </aside>
                    </div>
                )}
            </div>
        </div>
    );
}
