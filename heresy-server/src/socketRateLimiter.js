const DEFAULT_LIMIT = { points: 20, duration: 5000 };

export class SocketRateLimiter {
  constructor(eventLimits = {}, defaultLimit = DEFAULT_LIMIT) {
    this.eventLimits = eventLimits;
    this.defaultLimit = defaultLimit;
    this.buckets = new Map();
  }

  isRateLimited(socketId, eventName) {
    const limit = this.eventLimits[eventName] ?? this.defaultLimit;
    if (!limit || limit.points <= 0) {
      return false;
    }

    const key = `${socketId}:${eventName}`;
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || now > existing.reset) {
      // Prune all expired buckets on new key creation to prevent unbounded growth
      if (this.buckets.size > 0) {
        for (const [k, v] of this.buckets.entries()) {
          if (now > v.reset) this.buckets.delete(k);
        }
      }
      this.buckets.set(key, { count: 1, reset: now + limit.duration });
      return false;
    }

    existing.count += 1;
    if (existing.count > limit.points) {
      return true;
    }

    this.buckets.set(key, existing);
    return false;
  }

  clear(socketId) {
    const prefix = `${socketId}:`;
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) {
        this.buckets.delete(key);
      }
    }
  }
}
