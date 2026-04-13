import { Response } from 'express';
import { profileService } from '../services/profileService.js';

interface Client {
    username: string;
    res: Response;
    isStealth: boolean;
}

class RealtimeManager {
    private clients: Client[] = [];
    private watcherInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Delay watcher start to ensure all services (supabase, profileService) are fully initialized
        setTimeout(() => this.startWatcher(), 5000);
    }

    /**
     * Background watcher that triggers social syncs for active usernames
     */
    private startWatcher() {
        if (this.watcherInterval) return;

        this.watcherInterval = setInterval(async () => {
            // Watcher doesn't need to skip stealth clients as it's just background syncing
            const activeUsernames = [...new Set(this.clients.map(c => c.username))];
            
            if (activeUsernames.length === 0) return;

            // Loop through active profiles and trigger sync
            for (const username of activeUsernames) {
                try {
                    await profileService.getProfileByUsername(username, true);
                } catch (err) {
                    console.error(`[RealtimeWatcher] Failed to sync ${username}:`, err);
                }
            }
        }, 2500);
    }

    /**
     * Add a new SSE client connection
     */
    public addClient(username: string, res: Response, isStealth: boolean = false) {
        // SSE Headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 15000);

        const client = { username: username.toLowerCase(), res, isStealth };
        this.clients.push(client);

        res.on('close', () => {
            clearInterval(heartbeat);
            this.clients = this.clients.filter(c => c !== client);
            if (!isStealth) {
                console.log(`[RealtimeManager] Connection closed for: ${username}`);
            }
        });

        // Initial response
        res.write('data: {"status": "connected"}\n\n');
        if (!isStealth) {
            console.log(`[RealtimeManager] Client connected for: ${username}. Total clients: ${this.clients.length}`);
        } else {
            console.log(`[RealtimeManager] Stealth client (Ghost) connected for: ${username}`);
        }
    }

    /**
     * Notify all open connections for a specific username
     */
    public notifyUpdate(username: string) {
        const u = username.toLowerCase();
        const targets = this.clients.filter(c => c.username === u);
        
        if (targets.length === 0) return;

        const payload = JSON.stringify({ type: 'profile_update', timestamp: Date.now() });
        targets.forEach(c => {
            c.res.write(`data: ${payload}\n\n`);
        });
    }

    /**
     * Get all currently connected usernames (skipping stealth)
     */
    public getActiveUsernames(): string[] {
        return [...new Set(this.clients.filter(c => !c.isStealth).map(c => c.username))];
    }

    /**
     * Check if a specific user is currently online (skipping stealth)
     */
    public isUserOnline(username: string): boolean {
        const u = username.toLowerCase();
        return this.clients.some(c => c.username === u && !c.isStealth);
    }
}

export const realtimeManager = new RealtimeManager();
