import { createAdminService } from './admin.service'
import { NotificationService } from './notification.service'

export interface HealthMonitorOptions {
  intervalMs?: number
  thresholds?: {
    dbLatency?: number
    serverLatency?: number
  }
}

export function startHealthMonitor(opts: HealthMonitorOptions = {}) {
  const { intervalMs = 60_000, thresholds = { dbLatency: 200, serverLatency: 500 } } = opts

  const adminService = createAdminService()

  let lastAlertState: { alerted: boolean; lastStatus?: string } = { alerted: false }

  const check = async () => {
    try {
      const health = await adminService.getSystemHealth()

      const dbBad = health.dbLatency > (thresholds.dbLatency ?? 200)
      const serverBad = health.serverLatency > (thresholds.serverLatency ?? 500)
      const degraded = health.status !== 'healthy' || dbBad || serverBad

      if (degraded && !lastAlertState.alerted) {
        lastAlertState.alerted = true
        lastAlertState.lastStatus = health.status
        await NotificationService.notifyWebhook({ type: 'SYSTEM_ALERT', payload: { health } }).catch(() => null)
        return
      }

      // Recovering: clear alerted flag when back to healthy
      if (!degraded && lastAlertState.alerted) {
        lastAlertState.alerted = false
        lastAlertState.lastStatus = health.status
        await NotificationService.notifyWebhook({ type: 'SYSTEM_RECOVERY', payload: { health } }).catch(() => null)
      }
    } catch (err) {
      // On error reporting, send alert once
      if (!lastAlertState.alerted) {
        lastAlertState.alerted = true
        await NotificationService.notifyWebhook({ type: 'SYSTEM_ALERT', payload: { error: String(err) } }).catch(() => null)
      }
    }
  }

  // Run immediately and schedule
  void check()
  const id = setInterval(check, intervalMs)

  return {
    stop: () => clearInterval(id)
  }
}
