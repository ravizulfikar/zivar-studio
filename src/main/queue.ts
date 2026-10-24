/**
 * Runs jobs one at a time per key (a connection id). Every connection is a single database session,
 * so without this a query from another tab could slip between a transaction's BEGIN and COMMIT and
 * be rolled back with it. A failing job never blocks the ones queued behind it.
 */
export class KeyedQueue {
  private tails = new Map<string, Promise<void>>()

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous.then(job)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key) // idle again; don't keep the map growing
    })
    return result
  }

  /**
   * Hold several keys at once (a transfer between two connections). Keys are taken in sorted order,
   * so two jobs that need the same pair can never wait on each other.
   */
  runAll<T>(keys: string[], job: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(keys)].sort()
    return ordered.reduceRight<() => Promise<T>>((inner, key) => () => this.run(key, inner), job)()
  }
}
