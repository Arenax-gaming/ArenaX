export interface ModerationResult {
  flagged: boolean
  matches: string[]
  reason?: string
  severity?: 'low' | 'medium' | 'high'
}

export class ModerationService {
  private static PROFANE = [
    'shit', 'fuck', 'bitch', 'ass', 'damn', 'hell',
    'bastard', 'crap', 'piss', 'dick', 'cock', 'pussy'
  ]

  private static SLURS: string[] = [
    // extend as needed
  ]

  private static SPAM_PATTERNS: RegExp[] = [
    /\b(buy|sell|cheap|free|click|win|prize|money|cash)\b.{0,50}\$(\d+)/gi,
    /\b(bitcoin|crypto|investment|forex|trading)\b/gi,
    /(.)\1{4,}/g, // Repeated characters
    /\b\d{10,}\b/g // Long numbers (phone numbers, etc.)
  ]

  private static PII_PATTERNS: RegExp[] = [
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, // Phone numbers
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email addresses
    /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g // Credit card numbers
  ]

  static detectProfanity(text: string): ModerationResult {
    if (!text) return { flagged: false, matches: [] }

    const lower = text.toLowerCase()
    const matches: string[] = []

    for (const word of ModerationService.PROFANE) {
      const re = new RegExp(`\\b${word}\\b`, 'i')
      if (re.test(lower)) matches.push(word)
    }

    return {
      flagged: matches.length > 0,
      matches,
      reason: matches.length > 0 ? 'profanity' : undefined,
      severity: matches.length > 3 ? 'high' : matches.length > 1 ? 'medium' : 'low'
    }
  }

  static detectSlurs(text: string): ModerationResult {
    if (!text) return { flagged: false, matches: [] }

    const lower = text.toLowerCase()
    const matches: string[] = []

    for (const word of ModerationService.SLURS) {
      const re = new RegExp(`\\b${word}\\b`, 'i')
      if (re.test(lower)) matches.push(word)
    }

    return {
      flagged: matches.length > 0,
      matches,
      reason: matches.length > 0 ? 'hate_speech' : undefined,
      severity: 'high'
    }
  }

  static detectSpam(text: string): ModerationResult {
    if (!text) return { flagged: false, matches: [] }

    const matches: string[] = []

    for (const pattern of ModerationService.SPAM_PATTERNS) {
      const found = text.match(pattern)
      if (found) matches.push(...found)
    }

    return {
      flagged: matches.length > 0,
      matches,
      reason: matches.length > 0 ? 'spam' : undefined,
      severity: matches.length > 2 ? 'high' : 'medium'
    }
  }

  static detectPII(text: string): ModerationResult {
    if (!text) return { flagged: false, matches: [] }

    const matches: string[] = []

    for (const pattern of ModerationService.PII_PATTERNS) {
      const found = text.match(pattern)
      if (found) matches.push(...found)
    }

    return {
      flagged: matches.length > 0,
      matches,
      reason: matches.length > 0 ? 'pii' : undefined,
      severity: 'high'
    }
  }

  static detectAll(text: string): ModerationResult {
    if (!text) return { flagged: false, matches: [] }

    const results = [
      this.detectProfanity(text),
      this.detectSlurs(text),
      this.detectSpam(text),
      this.detectPII(text)
    ]

    const flaggedResults = results.filter(r => r.flagged)
    const allMatches = flaggedResults.flatMap(r => r.matches)
    const highestSeverity = this.getHighestSeverity(flaggedResults.map(r => r.severity))

    return {
      flagged: flaggedResults.length > 0,
      matches: allMatches,
      reason: flaggedResults.map(r => r.reason).filter(Boolean).join(', '),
      severity: highestSeverity
    }
  }

  private static getHighestSeverity(severities: ('low' | 'medium' | 'high' | undefined)[]): 'low' | 'medium' | 'high' {
    if (severities.includes('high')) return 'high'
    if (severities.includes('medium')) return 'medium'
    return 'low'
  }
}

export default ModerationService
