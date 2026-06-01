import { Request, Response, NextFunction } from 'express';
import { MaintenanceService } from '../services/maintenance.service';

export const maintenanceMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const maintenanceService = MaintenanceService.getInstance();
    if (maintenanceService.isMaintenanceActive()) {
        const isAdmin = req.user && (req.user as any).role === 'ADMIN';
        const isAdminRoute = req.path.startsWith('/admin') || req.path.startsWith('/api/v1/admin');
        
        const isStatusRoute = req.path.includes('/maintenance/status');
        
        if (!isAdmin && !isAdminRoute && !isStatusRoute) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: maintenanceService.getMaintenanceMessage() || 'Server is currently undergoing scheduled maintenance. Please try again later.'
            });
        }
    }
    next();
};
