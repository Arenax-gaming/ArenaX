export interface UserListFilters {
  role?: string
  status?: 'active' | 'banned' | 'suspended'
  search?: string
  limit?: number
  offset?: number
}

export interface BanUserPayload {
  userId: string
  reason: string
  duration?: number // in hours, null for permanent
}

export interface GameConfig {
  maintenanceMode: boolean
  maxPlayersPerMatch: number
  minPlayersToStart: number
  matchTimeout: number
  dailyMatchLimit: number
}

export interface ModerationItem {
  id: string
  type: 'chat' | 'username' | 'content'
  reportedUserId: string
  content: string
  reportedAt: Date
  status: 'pending' | 'reviewed' | 'actioned'
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'down'
  uptime: number
  activeUsers: number
  activeMatches: number
  dbLatency: number
  serverLatency: number
  memoryUsage: number
  diskUsage: number
}

export class AdminService {
  private gameConfig: GameConfig = {
    maintenanceMode: false,
    maxPlayersPerMatch: 8,
    minPlayersToStart: 2,
    matchTimeout: 3600,
    dailyMatchLimit: 100,
  }

  private bannedUsers = new Map<string, { reason: string; unbannedAt?: Date }>()
  private moderationQueue: ModerationItem[] = []

  async getUserList(filters: UserListFilters = {}): Promise<{
    users: any[]
    total: number
  }> {
    const {
      limit = 20,
      offset = 0,
      role,
      status,
      search,
    } = filters

    // In production, fetch from database with filters
    console.log('[Admin] Fetching user list with filters:', {
      role,
      status,
      search,
      limit,
      offset,
    })

    // Simulated response
    return {
      users: [],
      total: 0,
    }
  }

  async banUser(payload: BanUserPayload): Promise<boolean> {
    const { userId, reason, duration } = payload

    if (!userId || !reason) {
      throw new Error('userId and reason are required')
    }

    let unbannedAt: Date | undefined
    if (duration) {
      unbannedAt = new Date(Date.now() + duration * 60 * 60 * 1000)
    }

    this.bannedUsers.set(userId, { reason, unbannedAt })

    // In production, update user record in database
    console.log('[Admin] User banned:', {
      userId,
      reason,
      temporary: !!unbannedAt,
      unbannedAt,
    })

    return true
  }

  async unbanUser(userId: string): Promise<boolean> {
    if (!this.bannedUsers.has(userId)) {
      throw new Error('User is not banned')
    }

    this.bannedUsers.delete(userId)

    // In production, update user record in database
    console.log('[Admin] User unbanned:', { userId })

    return true
  }

  async getGameConfig(): Promise<GameConfig> {
    return { ...this.gameConfig }
  }

  async updateGameConfig(config: Partial<GameConfig>): Promise<GameConfig> {
    // Validate config values
    if (config.maxPlayersPerMatch && config.maxPlayersPerMatch < 2) {
      throw new Error('maxPlayersPerMatch must be at least 2')
    }

    if (config.minPlayersToStart && config.minPlayersToStart > config.maxPlayersPerMatch) {
      throw new Error('minPlayersToStart cannot exceed maxPlayersPerMatch')
    }

    Object.assign(this.gameConfig, config)

    // In production, persist to database
    console.log('[Admin] Game config updated:', this.gameConfig)

    return { ...this.gameConfig }
  }

  async toggleMaintenanceMode(enabled: boolean): Promise<boolean> {
    this.gameConfig.maintenanceMode = enabled

    console.log('[Admin] Maintenance mode:', enabled ? 'enabled' : 'disabled')

    return true
  }

  async getModerationQueue(): Promise<ModerationItem[]> {
    return this.moderationQueue.filter(item => item.status === 'pending')
  }

  async reviewContent(
    contentId: string,
    action: 'approve' | 'reject' | 'remove'
  ): Promise<boolean> {
    const item = this.moderationQueue.find(m => m.id === contentId)

    if (!item) {
      throw new Error('Content not found in moderation queue')
    }

    item.status = 'reviewed'

    // In production, take actual action based on decision
    if (action === 'remove') {
      // Remove content from platform
      console.log('[Admin] Content removed:', { contentId, reason: item.content })
    }

    console.log('[Admin] Content reviewed:', {
      contentId,
      action,
      type: item.type,
    })

    return true
  }

  async reportContent(
    userId: string,
    type: 'chat' | 'username' | 'content',
    content: string
  ): Promise<ModerationItem> {
    const item: ModerationItem = {
      id: `mod-${Date.now()}`,
      type,
      reportedUserId: userId,
      content,
      reportedAt: new Date(),
      status: 'pending',
    }

    this.moderationQueue.push(item)

    console.log('[Admin] Content reported:', item)

    return item
  }

  async getSystemHealth(): Promise<SystemHealth> {
    // In production, collect actual system metrics
    return {
      status: 'healthy',
      uptime: Date.now(),
      activeUsers: Math.floor(Math.random() * 1000),
      activeMatches: Math.floor(Math.random() * 100),
      dbLatency: Math.floor(Math.random() * 50),
      serverLatency: Math.floor(Math.random() * 100),
      memoryUsage: Math.floor(Math.random() * 80),
      diskUsage: Math.floor(Math.random() * 60),
    }
  }

  async auditLog(
    adminId: string,
    action: string,
    target: string,
    details: Record<string, any> = {}
  ): Promise<boolean> {
    // In production, store in audit log table
    console.log('[Audit]', {
      adminId,
      action,
      target,
      timestamp: new Date().toISOString(),
      details,
    })

    return true
  }

  isUserBanned(userId: string): boolean {
    const banInfo = this.bannedUsers.get(userId)
    if (!banInfo) return false

    // Check if ban has expired
    if (banInfo.unbannedAt && banInfo.unbannedAt < new Date()) {
      this.bannedUsers.delete(userId)
      return false
    }

    return true
  }

  getBanInfo(userId: string): { reason: string; unbannedAt?: Date } | null {
    return this.bannedUsers.get(userId) || null
  }
}

export function createAdminService() {
  return new AdminService()
}
