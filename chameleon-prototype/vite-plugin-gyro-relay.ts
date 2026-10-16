import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Plugin } from 'vite';

/**
 * Attaches a tiny WebSocket relay at /ws-gyro to the Vite dev (and preview) server.
 *   ws://host/ws-gyro?role=game        main game tab(s)
 *   ws://host/ws-gyro?role=controller  phones running /controller.html
 * Controller packets are fanned out to every game; game packets (colours, button label, haptics)
 * to every phone; presence is broadcast to everyone.
 * GET /gyro-info returns the LAN URLs of the controller page (shown on the game HUD).
 */
export function gyroRelay(path = '/ws-gyro'): Plugin {
    const attach = (httpServer: Server | null, port: () => number | undefined, https: () => boolean) => {
        if (!httpServer) return;
        const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
        const games = new Set<WebSocket>();
        const controllers = new Set<WebSocket>();
        let lastGame: string | null = null;

        const presence = () => {
            const msg = JSON.stringify({ t: 'presence', games: games.size, controllers: controllers.size });
            for (const ws of [...games, ...controllers]) if (ws.readyState === ws.OPEN) ws.send(msg);
        };

        wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            const role = new URL(req.url ?? '', 'http://x').searchParams.get('role');
            const set = role === 'controller' ? controllers : games;
            set.add(ws);
            presence();
            if (set === controllers && lastGame) ws.send(lastGame); // late joiner: current colours/label
            ws.on('message', (data) => {
                const text = data.toString();
                if (set === controllers) {
                    for (const g of games) if (g.readyState === g.OPEN) g.send(text);
                    return;
                }
                // Game -> phones: theme colours, button label, haptics.
                if (text.startsWith('{"t":"game"')) lastGame = text;
                for (const c of controllers) if (c.readyState === c.OPEN) c.send(text);
            });
            ws.on('close', () => {
                set.delete(ws);
                presence();
            });
            ws.on('error', () => ws.terminate());
        });

        httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
            if (!req.url || new URL(req.url, 'http://x').pathname !== path) return; // leave Vite HMR alone
            wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
        });

        return (req: IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => {
            if (req.url !== '/gyro-info') return next();
            const urls: string[] = [];
            for (const list of Object.values(networkInterfaces()))
                for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) urls.push(`${https() ? 'https' : 'http'}://${a.address}:${port()}/controller.html`);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ urls, games: games.size, controllers: controllers.size }));
        };
    };

    return {
        name: 'gyro-relay',
        configureServer(server) {
            const mw = attach(server.httpServer as Server | null, () => server.config.server.port, () => !!server.config.server.https);
            if (mw) server.middlewares.use(mw);
        },
        configurePreviewServer(server) {
            const mw = attach(server.httpServer as Server | null, () => server.config.preview.port, () => !!server.config.preview.https);
            if (mw) server.middlewares.use(mw);
        },
    };
}
