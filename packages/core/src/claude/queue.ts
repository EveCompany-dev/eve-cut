/** At most this many `claude -p` processes at once: the subscription and the PC both have limits. */
export const MAX_CONCURRENT_RUNS = 2;

/** Runs async tasks with a cap on how many are in flight; the rest wait in FIFO order. */
export class RunQueue {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}
