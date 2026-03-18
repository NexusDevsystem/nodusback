import { Response } from 'express';

interface Client {
    username: string;
    res: Response;
}

class RealtimeManager {
    private clients: Client[] = [];

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
