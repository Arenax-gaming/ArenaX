import { Request, Response, NextFunction } from 'express'

export const requireConfirmationForBulk = (threshold = 10) => (req: Request, res: Response, next: NextFunction) => {
  const { userIds, confirm } = req.body as any

  if (!Array.isArray(userIds)) return res.status(400).json({ error: 'userIds must be an array' })

  if (userIds.length > threshold && !confirm) {
    return res.status(400).json({ error: `confirm is required to operate on more than ${threshold} users` })
  }

  // Prevent accidental global operations
  if (userIds.length === 0) return res.status(400).json({ error: 'userIds must be non-empty' })

  return next()
}

export default requireConfirmationForBulk
