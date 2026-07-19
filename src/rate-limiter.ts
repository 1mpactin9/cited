export class RateLimiter {
  private readonly maxPerMinute: number;
  private readonly maxConcurrent: number;
  private active = 0;
  private queue: Array<() => void> = [];
  private count = 0;
  private windowStart = Date.now();
  private readonly windowMs = 60000;

  constructor(maxPerMinute: number = 10, maxConcurrent: number = 5) {
    this.maxPerMinute = maxPerMinute;
    this.maxConcurrent = maxConcurrent;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.count = 0;
      this.windowStart = now;
    }
    if (this.count >= this.maxPerMinute) {
      const waitSeconds = Math.ceil((this.windowMs - (now - this.windowStart)) / 1000);
      throw new Error(`Rate limit exceeded. Please wait ${waitSeconds} seconds.`);
    }
    this.count++;

    if (this.active >= this.maxConcurrent) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
