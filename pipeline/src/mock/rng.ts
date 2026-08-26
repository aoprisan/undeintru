/**
 * Deterministic pseudo-randomness for synthetic data.
 *
 * `Math.random()` is unusable here: a generator that produces different data
 * every run makes the model's validation suite flaky, and a flaky statistical
 * test gets its tolerances loosened until it stops meaning anything. Every
 * synthetic dataset is a pure function of its seed.
 */

/** mulberry32 — small, fast, and good enough for generating test fixtures. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded source of the distributions the generator needs. */
export class Rng {
  readonly #next: () => number;
  #spare: number | null = null;

  constructor(seed: number) {
    this.#next = mulberry32(seed);
  }

  /** Uniform in [0, 1). */
  uniform(): number {
    return this.#next();
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.#next() * (max - min);
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.#next() < p;
  }

  /** Uniformly pick one element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new Error('cannot pick from an empty list');
    return item;
  }

  /** Normal deviate via Box-Muller, keeping the second value of each pair. */
  normal(mean = 0, sd = 1): number {
    if (this.#spare !== null) {
      const value = this.#spare;
      this.#spare = null;
      return mean + sd * value;
    }
    let u = 0;
    let v = 0;
    // u must be non-zero for the log.
    while (u === 0) u = this.#next();
    while (v === 0) v = this.#next();
    const radius = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    this.#spare = radius * Math.sin(theta);
    return mean + sd * radius * Math.cos(theta);
  }
}
