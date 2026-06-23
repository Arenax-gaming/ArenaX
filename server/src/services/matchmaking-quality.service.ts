/**
 * Foundation for the AI-powered matchmaking work tracked in #469.
 *
 * The current matchmaker (match.service.ts) is a single-axis ELO check.
 * This file isolates the *quality scoring* and *skill prediction*
 * concerns so the matchmaker can keep its O(1) selection loop while a
 * smarter model gets layered in behind a stable interface.
 *
 * Two pieces live here:
 *   1. {@link SkillPredictor} — interface a real model implementation
 *      (a server-side ONNX export, a hosted endpoint, …) plugs into.
 *      A deterministic moving-average predictor is provided as the
 *      default so the matchmaker has a working baseline today.
 *   2. {@link scoreMatchQuality} — pure function that turns a candidate
 *      pairing + predictions into a 0..1 score, with weights tuned for
 *      ELO closeness, latency, behaviour compatibility, and team balance.
 *      The matchmaker treats this score as the only signal it needs to
 *      pick the best candidate out of a window.
 */

export interface PlayerSnapshot {
    playerId: string
    /** Current visible rating. The actual model gets the full history. */
    rating: number
    /** Recent rating history (most recent last). Empty for new accounts. */
    recentRatings?: number[]
    /** Coarse-grained latency to the matchmaker's region in ms. */
    regionLatencyMs?: number
    /** Win-rate over the last 100 games, 0..1. */
    recentWinRate?: number
    /** Behaviour cluster from the offline behavioural model. */
    behaviourCluster?: string
}

export interface SkillPrediction {
    playerId: string
    /** Predicted "true" rating — the rating that best explains future games. */
    predictedRating: number
    /** Confidence in the prediction, 0..1. */
    confidence: number
}

export interface SkillPredictor {
    predict(player: PlayerSnapshot): SkillPrediction
}

export interface MatchCandidate {
    teamA: PlayerSnapshot[]
    teamB: PlayerSnapshot[]
}

export interface MatchQualityBreakdown {
    skillBalance: number
    latencyBalance: number
    behaviourBalance: number
    teamSizeBalance: number
}

export interface MatchQualityScore {
    score: number
    breakdown: MatchQualityBreakdown
}

const WEIGHTS = {
    skill: 0.55,
    latency: 0.2,
    behaviour: 0.15,
    teamSize: 0.1,
}

const SKILL_TOLERANCE = 200 // rating points of difference scored as 0
const LATENCY_TOLERANCE = 120 // ms
const TEAM_IMBALANCE_TOLERANCE = 2 // player count delta scored as 0

/**
 * Default predictor. Smooths the player's recent rating into the
 * current rating with confidence rising as more games are observed.
 * Good enough for unit tests and as a baseline until a real model
 * lands.
 */
export class MovingAverageSkillPredictor implements SkillPredictor {
    constructor(private readonly windowSize = 10) {}

    predict(player: PlayerSnapshot): SkillPrediction {
        const recent = (player.recentRatings ?? []).slice(-this.windowSize)
        if (recent.length === 0) {
            // New accounts get the visible rating with low confidence.
            return {
                playerId: player.playerId,
                predictedRating: player.rating,
                confidence: 0.1,
            }
        }
        const mean = recent.reduce((a, b) => a + b, 0) / recent.length
        const variance =
            recent.reduce((acc, r) => acc + (r - mean) ** 2, 0) / recent.length
        const variance0to1 = Math.min(1, Math.sqrt(variance) / 400)

        return {
            playerId: player.playerId,
            predictedRating: 0.6 * mean + 0.4 * player.rating,
            confidence: Math.max(0.1, Math.min(1, recent.length / this.windowSize) - variance0to1),
        }
    }
}

function meanRating(team: PlayerSnapshot[], predictor: SkillPredictor): number {
    if (team.length === 0) return 0
    return (
        team.reduce((acc, p) => acc + predictor.predict(p).predictedRating, 0) /
        team.length
    )
}

function meanLatency(team: PlayerSnapshot[]): number {
    const sampled = team.map((p) => p.regionLatencyMs).filter((v): v is number => typeof v === 'number')
    if (sampled.length === 0) return 0
    return sampled.reduce((a, b) => a + b, 0) / sampled.length
}

function behaviourMix(team: PlayerSnapshot[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const p of team) {
        const k = p.behaviourCluster ?? 'unknown'
        counts[k] = (counts[k] ?? 0) + 1
    }
    return counts
}

function jaccard(a: Record<string, number>, b: Record<string, number>): number {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    let intersection = 0
    let union = 0
    for (const k of keys) {
        intersection += Math.min(a[k] ?? 0, b[k] ?? 0)
        union += Math.max(a[k] ?? 0, b[k] ?? 0)
    }
    return union === 0 ? 1 : intersection / union
}

function clamp01(n: number): number {
    if (Number.isNaN(n)) return 0
    return Math.max(0, Math.min(1, n))
}

/**
 * Convert a candidate pairing into a 0..1 score. Higher is better. The
 * breakdown is returned alongside the score for analytics dashboards
 * and the matchmaking explanation surface called out in #469's
 * "transparency" feature.
 */
export function scoreMatchQuality(
    candidate: MatchCandidate,
    predictor: SkillPredictor = new MovingAverageSkillPredictor(),
): MatchQualityScore {
    const ratingA = meanRating(candidate.teamA, predictor)
    const ratingB = meanRating(candidate.teamB, predictor)
    const skillBalance = clamp01(1 - Math.abs(ratingA - ratingB) / SKILL_TOLERANCE)

    const latencyA = meanLatency(candidate.teamA)
    const latencyB = meanLatency(candidate.teamB)
    const latencyBalance = clamp01(
        1 - Math.abs(latencyA - latencyB) / LATENCY_TOLERANCE,
    )

    const behaviourBalance = clamp01(
        jaccard(behaviourMix(candidate.teamA), behaviourMix(candidate.teamB)),
    )

    const teamSizeBalance = clamp01(
        1 - Math.abs(candidate.teamA.length - candidate.teamB.length) / TEAM_IMBALANCE_TOLERANCE,
    )

    const score =
        WEIGHTS.skill * skillBalance +
        WEIGHTS.latency * latencyBalance +
        WEIGHTS.behaviour * behaviourBalance +
        WEIGHTS.teamSize * teamSizeBalance

    return {
        score: clamp01(score),
        breakdown: { skillBalance, latencyBalance, behaviourBalance, teamSizeBalance },
    }
}
