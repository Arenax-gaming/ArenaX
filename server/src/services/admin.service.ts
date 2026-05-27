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

import { getDatabaseClient } from './database.service'
import ModerationService from './moderation.service'
import { NotificationService } from './notification.service'

export class AdminService {
  private inMemoryGameConfig: GameConfig = {
    maintenanceMode: false,
    maxPlayersPerMatch: 8,
    minPlayersToStart: 2,
    matchTimeout: 3600,
    dailyMatchLimit: 100,
  }

  // fallback in-memory stores for environments without DB
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

    const prisma = getDatabaseClient()

    const where: any = {}
    if (role) where.role = role

    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ]
    }

    // status handling: 'banned' -> users with active ban
    if (status === 'banned') {
      where.bans = {
        some: {
          OR: [
            { unbannedAt: null },
            { unbannedAt: { gt: new Date() } }
          ]
        }
      }
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, username: true, role: true, createdAt: true }
      }),
      prisma.user.count({ where })
    ])

    return { users, total }
  }

  async banUser(payload: BanUserPayload): Promise<boolean> {
    const { userId, reason, duration } = payload

    if (!userId || !reason) {
      throw new Error('userId and reason are required')
    }

    // Basic validation: reason must be substantive
    if (reason.trim().length < 5) {
      throw new Error('reason must be at least 5 characters')
    }

    // Limit temporary ban duration to max 30 days
    if (duration && duration > 24 * 30) {
      throw new Error('duration cannot exceed 30 days')
    }

    const prisma = getDatabaseClient()
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } })
    if (!target) throw new Error('user not found')

    // Prevent banning admins or moderators with higher privileges
    if (target.role === 'ADMIN' || target.role === 'MODERATOR') {
      throw new Error('cannot ban a user with elevated privileges')
    }

    let unbannedAt: Date | undefined
    if (duration) {
      unbannedAt = new Date(Date.now() + duration * 60 * 60 * 1000)
    }

    await prisma.ban.create({
      data: {
        userId,
        reason,
        unbannedAt
      }
    })

    // keep in-memory copy as well
    this.bannedUsers.set(userId, { reason, unbannedAt })

    // Audit and notify
    await this.auditLog('system', 'ban_user', userId, { reason, durationHours: duration ?? null }).catch(() => null)
    NotificationService.notifyWebhook({ type: 'USER_BANNED', payload: { userId, reason, unbannedAt } }).catch(() => null)

    console.log('[Admin] User banned (db):', { userId, reason, unbannedAt })
    return true
  }

  async unbanUser(userId: string): Promise<boolean> {
    const prisma = getDatabaseClient()
    const activeBan = await prisma.ban.findFirst({
      where: { userId, OR: [{ unbannedAt: null }, { unbannedAt: { gt: new Date() } }] },
      orderBy: { bannedAt: 'desc' }
    })

    if (!activeBan) {
      throw new Error('User is not banned')
    }

    await prisma.ban.update({ where: { id: activeBan.id }, data: { unbannedAt: new Date() } })
    this.bannedUsers.delete(userId)

    // Audit and notify
    await this.auditLog('system', 'unban_user', userId, {}).catch(() => null)
    NotificationService.notifyWebhook({ type: 'USER_UNBANNED', payload: { userId } }).catch(() => null)

    console.log('[Admin] User unbanned (db):', { userId })

    return true
  }

  async getGameConfig(): Promise<GameConfig> {
    const prisma = getDatabaseClient()
    const cfg = await prisma.gameConfig.findFirst()
    if (cfg) {
      return {
        maintenanceMode: cfg.maintenanceMode,
        maxPlayersPerMatch: cfg.maxPlayersPerMatch,
        minPlayersToStart: cfg.minPlayersToStart,
        matchTimeout: cfg.matchTimeout,
        dailyMatchLimit: cfg.dailyMatchLimit
      }
    }

    return { ...this.inMemoryGameConfig }
  }

  async updateGameConfig(config: Partial<GameConfig>): Promise<GameConfig> {
    // Validate config values
    if (config.maxPlayersPerMatch && config.maxPlayersPerMatch < 2) {
      throw new Error('maxPlayersPerMatch must be at least 2')
    }

    const maxPlayers = config.maxPlayersPerMatch ?? this.inMemoryGameConfig.maxPlayersPerMatch
    if (config.minPlayersToStart && config.minPlayersToStart > maxPlayers) {
      throw new Error('minPlayersToStart cannot exceed maxPlayersPerMatch')
    }

    // Persist to DB
    const prisma = getDatabaseClient()
    const existing = await prisma.gameConfig.findFirst()

    if (existing) {
      const updated = await prisma.gameConfig.update({
        where: { id: existing.id },
        data: {
          maintenanceMode: config.maintenanceMode ?? existing.maintenanceMode,
          maxPlayersPerMatch: config.maxPlayersPerMatch ?? existing.maxPlayersPerMatch,
          minPlayersToStart: config.minPlayersToStart ?? existing.minPlayersToStart,
          matchTimeout: config.matchTimeout ?? existing.matchTimeout,
          dailyMatchLimit: config.dailyMatchLimit ?? existing.dailyMatchLimit
        }
      })

      return {
        maintenanceMode: updated.maintenanceMode,
        maxPlayersPerMatch: updated.maxPlayersPerMatch,
        minPlayersToStart: updated.minPlayersToStart,
        matchTimeout: updated.matchTimeout,
        dailyMatchLimit: updated.dailyMatchLimit
      }
    }

    const created = await prisma.gameConfig.create({ data: { ...config } as any })
    return {
      maintenanceMode: created.maintenanceMode,
      maxPlayersPerMatch: created.maxPlayersPerMatch,
      minPlayersToStart: created.minPlayersToStart,
      matchTimeout: created.matchTimeout,
      dailyMatchLimit: created.dailyMatchLimit
    }
  }

  async toggleMaintenanceMode(enabled: boolean): Promise<boolean> {
    this.inMemoryGameConfig.maintenanceMode = enabled

    console.log('[Admin] Maintenance mode:', enabled ? 'enabled' : 'disabled')

    return true
  }

  async getModerationQueue(): Promise<ModerationItem[]> {
    const prisma = getDatabaseClient()
    const rows = await prisma.moderationItem.findMany({ where: { status: 'PENDING' }, orderBy: { reportedAt: 'desc' } })
    return rows.map(r => ({
      id: r.id,
      type: r.type as any,
      reportedUserId: r.reportedUserId,
      content: r.content,
      reportedAt: r.reportedAt,
      status: (r.status === 'PENDING' ? 'pending' : r.status === 'REVIEWED' ? 'reviewed' : 'actioned') as any
    }))
  }

  async reviewContent(
    contentId: string,
    action: 'approve' | 'reject' | 'remove'
  ): Promise<boolean> {
    const prisma = getDatabaseClient()
    const existing = await prisma.moderationItem.findUnique({ where: { id: contentId } })
    if (!existing) throw new Error('Content not found in moderation queue')

    await prisma.moderationItem.update({ where: { id: contentId }, data: { status: 'REVIEWED', reviewerId: null, reviewedAt: new Date(), actionTaken: action === 'remove' ? 'removed' : action } })

    if (action === 'remove') {
      // placeholder for removal logic
      console.log('[Admin] Content removed via moderation:', { contentId, content: existing.content })
    }

    // Notify admin webhook about review action
    NotificationService.notifyWebhook({ type: 'MODERATION_REVIEW', payload: { moderationId: contentId, action } }).catch(() => null)

    console.log('[Admin] Content reviewed (db):', { contentId, action })
    return true
  }

  async reportContent(
    userId: string,
    type: 'chat' | 'username' | 'content',
    content: string
  ): Promise<ModerationItem> {
    const prisma = getDatabaseClient()
    const detection = ModerationService.detectProfanity(content)
    const created = await prisma.moderationItem.create({ data: { type, reportedUserId: userId, content, flagged: detection.flagged, flagReason: detection.reason ?? null } })
    const item: ModerationItem = {
      id: created.id,
      type: type,
      reportedUserId: created.reportedUserId,
      content: created.content,
      reportedAt: created.reportedAt,
      status: 'pending'
    }

    console.log('[Admin] Content reported (db):', item)
    // Notify admin webhook for flagged content
    if (detection.flagged) {
      NotificationService.notifyWebhook({ type: 'MODERATION_FLAGGED', payload: { moderationId: created.id, reason: detection.reason, matches: detection.matches } }).catch(() => null)
    }

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
    const prisma = getDatabaseClient()
    await prisma.auditLog.create({ data: { adminId, action, targetType: target, targetId: target, details, snapshotBefore: {}, snapshotAfter: {}, requestId: undefined } })
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
