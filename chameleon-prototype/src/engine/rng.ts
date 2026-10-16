/** Seeded mulberry32 so playtests and screenshots are reproducible (`?seed=123`). */
export class Rng {
    private s: number;

    constructor(seed: number) {
        this.s = seed >>> 0 || 1;
    }

    next(): number {
        let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    range(min: number, max: number): number {
        return min + (max - min) * this.next();
    }

    int(maxExclusive: number): number {
        return Math.floor(this.next() * maxExclusive);
    }

    pick<T>(items: readonly T[]): T {
        return items[this.int(items.length)];
    }

    shuffle<T>(items: T[]): T[] {
        for (let i = items.length - 1; i > 0; i--) {
            const j = this.int(i + 1);
            const tmp = items[i];
            items[i] = items[j];
            items[j] = tmp;
        }
        return items;
    }
}
