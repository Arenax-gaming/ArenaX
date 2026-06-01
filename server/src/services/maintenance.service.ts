import { GameSessionService } from './game-session.service';
import { Server } from 'socket.io';

export class MaintenanceService {
    private static instance: MaintenanceService;
    
    private active: boolean = false;
    private startTime: Date | null = null;
    private endTime: Date | null = null;
    private message: string = '';
    private io: Server | null = null;
    private checkTimer: NodeJS.Timeout | null = null;
    private gameSessionService: GameSessionService;

    private constructor() {
        this.gameSessionService = new GameSessionService();
        this.startScheduleChecker();
    }

    public static getInstance(): MaintenanceService {
        if (!MaintenanceService.instance) {
            MaintenanceService.instance = new MaintenanceService();
        }
        return MaintenanceService.instance;
    }

    public setSocketServer(io: Server) {
        this.io = io;
    }

    public isMaintenanceActive(): boolean {
        if (this.active) return true;
        if (this.startTime && this.endTime) {
            const now = new Date();
            return now >= this.startTime && now <= this.endTime;
        }
        return false;
    }

    public getMaintenanceMessage(): string {
        return this.message;
    }

    public getStatus() {
        return {
            active: this.isMaintenanceActive(),
            startTime: this.startTime,
            endTime: this.endTime,
            message: this.message
        };
    }

    public scheduleMaintenance(startTime: Date, endTime: Date, message: string = 'Scheduled maintenance') {
        this.startTime = startTime;
        this.endTime = endTime;
        this.message = message;
        this.active = false; // Will be activated by checker when time arrives

        this.notifyScheduledMaintenance();
    }

    public enableMaintenanceImmediately(endTime: Date, message: string = 'Maintenance mode active') {
        this.active = true;
        this.startTime = new Date();
        this.endTime = endTime;
        this.message = message;

        this.notifyScheduledMaintenance();
        this.closeExistingGamesSafely();
    }

    public disableMaintenance() {
        this.active = false;
        this.startTime = null;
        this.endTime = null;
        this.message = '';
        if (this.io) {
            this.io.of('/game').emit('maintenance:ended');
        }
    }

    private startScheduleChecker() {
        // Check every 10 seconds
        this.checkTimer = setInterval(() => {
            if (this.isMaintenanceActive() && !this.active) {
                // Time has come, activate it
                this.active = true;
                this.closeExistingGamesSafely();
            } else if (this.startTime && !this.active) {
                // If it's scheduled and within e.g. 15 minutes, notify players
                const now = new Date();
                const diffMs = this.startTime.getTime() - now.getTime();
                const diffMins = diffMs / (1000 * 60);
                if (diffMins > 0 && diffMins <= 15) {
                    this.notifyScheduledMaintenance(Math.round(diffMins));
                }
            }
        }, 10000);
    }

    private notifyScheduledMaintenance(minutesRemaining?: number) {
        if (!this.io) return;
        
        const payload = {
            message: this.message,
            startTime: this.startTime,
            endTime: this.endTime,
            minutesRemaining
        };
        
        this.io.of('/game').emit('maintenance:scheduled', payload);
    }

    private closeExistingGamesSafely() {
        if (this.io) {
            this.io.of('/game').emit('maintenance:started', {
                message: this.message,
                endTime: this.endTime
            });
        }

        // Access the game session service to close games safely
        this.gameSessionService.closeAllActiveSessions(this.message || 'Server entering maintenance mode');
    }
}
