import { Response } from 'express';
import { profileService } from '../services/profileService.js';

interface Client {
    username: string;
    res: Response;
}

class RealtimeManager {
    private clients: Client[] = [];
    private watcherInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Start the background watcher to keep "Live" status updated for active viewers
        this.startWatcher();
    }

    /**
     * Background watcher that triggers social syncs for active usernames
     */
    private startWatcher() {
        if (this.watcherInterval) return;

        this.watcherInterval = setInterval(async () => {
            const activeUsernames = [...new Set(this.clients.map(c => c.username))];
            
            if (activeUsernames.length === 0) return;

            // console.log(`[RealtimeWatcher] Checking ${activeUsernames.length} active profiles: ${activeUsernames.join(', ')}`);
            
            // Loop through active profiles and trigger sync
            for (const username of activeUsernames) {
                try {
                    // Calling getProfileByUsername with triggerSync: true 
                    // This kicks off Twitch/YouTube/Kick status checks in background
                    await profileService.getProfileByUsername(username, true);
                } catch (err) {
                    console.error(`[RealtimeWatcher] Failed to sync ${username}:`, err);
                }
            }
        }, 2500); // Check every 2.5 seconds for truly instant live detection (as requested)
    }

    /**
     * Add a new SSE client connection
     */
    public addClient(username: string, res: Response) {
        // SSE Headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*' // Ensure CORS for SSE if needed
        });

        // Send a heartbeat every 15s to keep the connection alive
        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 15000);

        const client = { username: username.toLowerCase(), res };
        this.clients.push(client);

        // Remove client on close
        res.on('close', () => {
            clearInterval(heartbeat);
            this.clients = this.clients.filter(c => c !== client);
            console.log(`[RealtimeManager] Connection closed for: ${username}`);
        });

        // Initial response
        res.write('data: {"status": "connected"}\n\n');
        console.log(`[RealtimeManager] Client connected for: ${username}. Total clients: ${this.clients.length}`);
    }

    /**
     * Notify all open connections for a specific username
     */
    public notifyUpdate(username: string) {
        const u = username.toLowerCase();
        const targets = this.clients.filter(c => c.username === u);
        
        if (targets.length === 0) return;

        console.log(`[RealtimeManager] Notifying ${targets.length} clients about update for: ${username}`);
        
        const payload = JSON.stringify({ type: 'profile_update', timestamp: Date.now() });
        targets.forEach(c => {
            c.res.write(`data: ${payload}\n\n`);
        });
    }
}

export const realtimeManager = new RealtimeManager();
