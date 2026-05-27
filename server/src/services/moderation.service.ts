export class ModerationService {
  private static PROFANE = [
    'shit',
    'fuck',
    'bitch',
    'ass',
    'damn',
    'hell'
  ]

  static detectProfanity(text: string) {
    if (!text) return { flagged: false, matches: [] }

    const lower = text.toLowerCase()
    const matches: string[] = []

    for (const word of ModerationService.PROFANE) {
      const re = new RegExp(`\\b${word}\\b`, 'i')
      if (re.test(lower)) matches.push(word)
    }

    return { flagged: matches.length > 0, matches, reason: matches.length > 0 ? 'profanity' : undefined }
  }
}

export default ModerationService
