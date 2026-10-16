/** Wire format for /ws-gyro. Kept tiny: 30 packets/s from each phone. */
export type ControllerPacket =
    | { t: 'state'; a: number; b: number; g: number; jx: number; jy: number; tilt: boolean }
    | { t: 'action'; seq: number };

/** Game -> phone. The relay caches the last `game` packet so a phone that joins late is in sync. */
export type GamePacket =
    | {
          t: 'game';
          mode: 'title' | 'play' | 'draft' | 'over' | 'demo';
          /** Big button text + small caption under it. */
          label: string;
          sub: string;
          theme: string;
          realm: string;
          /** CSS colours of the current realm skin. */
          accent: string;
          accent2: string;
          bg: string;
          bpm: number;
      }
    | { t: 'haptic'; ms: number | number[] };

export type RelayPacket = ControllerPacket | GamePacket | { t: 'presence'; games: number; controllers: number };

export const GYRO_PATH = '/ws-gyro';
export const SEND_HZ = 30;
/** Degrees of tilt ignored around flat, so a phone lying on a desk doesn't twitch the lens. */
export const TILT_DEADZONE = 6;

export function wsUrl(role: 'game' | 'controller'): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${GYRO_PATH}?role=${role}`;
}

/** Phone tilt -> screen-space aim angle. Tilt right = +x, tilt top edge away = -y (up). */
export function tiltToAngle(beta: number, gamma: number): number | null {
    if (Math.hypot(beta, gamma) < TILT_DEADZONE) return null;
    return Math.atan2(beta, gamma);
}
