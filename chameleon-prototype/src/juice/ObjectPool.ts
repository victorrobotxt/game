/**
 * Fixed-capacity pool. Everything is allocated up front; acquire() returns null when exhausted
 * (callers drop the effect) so a burst never allocates mid-game.
 */
export class ObjectPool<T> {
    private readonly free: T[] = [];
    readonly all: readonly T[];
    readonly active = new Set<T>();

    constructor(capacity: number, create: (i: number) => T) {
        const all: T[] = [];
        for (let i = 0; i < capacity; i++) all.push(create(i));
        this.all = all;
        this.free = [...all];
    }

    acquire(): T | null {
        const item = this.free.pop() ?? null;
        if (item) this.active.add(item);
        return item;
    }

    release(item: T): void {
        if (!this.active.delete(item)) return;
        this.free.push(item);
    }

    get capacity(): number {
        return this.all.length;
    }

    get inUse(): number {
        return this.active.size;
    }
}
