import crypto from 'crypto'

type TokenRecord = {
  token: string
  adminId: string
  action: string
  payloadHash?: string
  expiresAt: number
}

class ConfirmationService {
  private store: Map<string, TokenRecord>

  constructor() {
    this.store = new Map()
  }

  generate(adminId: string, action: string, payload?: any, ttlMs = 5 * 60 * 1000) {
    const token = crypto.randomBytes(20).toString('hex')
    const payloadHash = payload ? crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') : undefined
    const rec: TokenRecord = { token, adminId, action, payloadHash, expiresAt: Date.now() + ttlMs }
    this.store.set(token, rec)
    return { token, expiresAt: rec.expiresAt }
  }

  validate(adminId: string, token: string, action: string, payload?: any) {
    const rec = this.store.get(token)
    if (!rec) return false
    if (rec.adminId !== adminId) return false
    if (rec.action !== action) return false
    if (rec.expiresAt < Date.now()) {
      this.store.delete(token)
      return false
    }
    if (rec.payloadHash) {
      const payloadHash = payload ? crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') : undefined
      if (payloadHash !== rec.payloadHash) return false
    }
    // one-time use
    this.store.delete(token)
    return true
  }

  // helpful for tests
  clear() {
    this.store.clear()
  }
}

export const confirmationService = new ConfirmationService()

export default confirmationService
