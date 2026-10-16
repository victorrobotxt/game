import { tiltToAngle, wsUrl, type GamePacket, type RelayPacket } from './protocol';

export type LinkStatus = 'offline' | 'waiting' | 'linked';

/** Game-side end of the phone bridge. Auto-reconnects; never throws into the game loop. */
export class GyroClient {
    private ws: WebSocket | null = null;
    private retry = 500;
    private controllers = 0;
    private lastPacketAt = -Infinity;
    private lastSeq = -1;
    angle = 0;
    hasAngle = false;
    jx = 0;
    jy = 0;
    packets = 0;
    onAction: () => void = () => {};

    connect() {
        try {
            const ws = (this.ws = new WebSocket(wsUrl('game')));
            ws.onopen = () => (this.retry = 500);
            ws.onmessage = (e) => this.handle(e.data);
            ws.onclose = () => {
                this.ws = null;
                this.controllers = 0;
                setTimeout(() => this.connect(), this.retry);
                this.retry = Math.min(8000, this.retry * 2);
            };
            ws.onerror = () => ws.close();
        } catch {
            setTimeout(() => this.connect(), this.retry);
        }
    }

    /** Game -> phones (theme colours, button label, haptics). Dropped silently while offline. */
    send(p: GamePacket) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(p));
    }

    private handle(raw: unknown) {
        let msg: RelayPacket;
        try {
            msg = JSON.parse(String(raw)) as RelayPacket;
        } catch {
            return;
        }
        if (msg.t === 'presence') {
            this.controllers = msg.controllers;
            return;
        }
        if (msg.t === 'game' || msg.t === 'haptic') return; // our own kind; games ignore them
        this.lastPacketAt = performance.now();
        this.packets++;
        if (msg.t === 'state') {
            const a = msg.tilt ? tiltToAngle(msg.b, msg.g) : null;
            if (a !== null) {
                this.angle = a;
                this.hasAngle = true;
            }
            this.jx = Math.max(-1, Math.min(1, msg.jx || 0));
            this.jy = Math.max(-1, Math.min(1, msg.jy || 0));
        } else if (msg.t === 'action' && msg.seq !== this.lastSeq) {
            this.lastSeq = msg.seq;
            this.onAction();
        }
    }

    get status(): LinkStatus {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return 'offline';
        return this.controllers > 0 ? 'linked' : 'waiting';
    }

    /** Phone tilt drives the lens only while packets are fresh. */
    get steering(): boolean {
        return this.hasAngle && performance.now() - this.lastPacketAt < 1500;
    }
}
