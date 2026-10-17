/** Caps concurrent requests and enforces a minimum spacing between request starts.
 * Port of providers/vision/ratelimit.py. Shared by every admin, so the OpenAI account's own rate
 * limit is respected however many tabs are sorting. */
export class RateLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private nextStart = 0;

  constructor(private readonly maxConcurrency = 4, private readonly minIntervalMs = 0,
              private readonly sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrency) await new Promise<void>((ok) => this.waiting.push(ok));
    else this.active++;
    try {
      const now = Date.now();
      const start = Math.max(now, this.nextStart);
      this.nextStart = start + this.minIntervalMs;
      if (start > now) await this.sleep(start - now);
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // hand our slot straight to the next caller
      else this.active--;
    }
  }
}
