/** Daily and monthly spending caps for the vision model (UTC days and months).
 *
 * Each call reserves its worst-case cost before it starts and settles to the real cost (from
 * OpenAI's reported token usage) when it ends, so calls running at the same time can't
 * overshoot a cap. */

export interface Spend { dayUsd: number; dayCapUsd: number; monthUsd: number; monthCapUsd: number }
export interface Reservation { amount: number; day: string; month: string }

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthKey = (t: number) => new Date(t).toISOString().slice(0, 7);

export class Budget {
  private day = { key: "", spent: 0, reserved: 0 };
  private month = { key: "", spent: 0, reserved: 0 };

  constructor(private readonly caps: { dailyCapUsd: number; monthlyCapUsd: number }, private readonly now: () => number = Date.now) {
    this.roll();
  }

  /** Start of the day / month: the counters reset. */
  private roll() {
    const t = this.now();
    if (this.day.key !== dayKey(t)) this.day = { key: dayKey(t), spent: 0, reserved: 0 };
    if (this.month.key !== monthKey(t)) this.month = { key: monthKey(t), spent: 0, reserved: 0 };
  }

  /** Costs already spent (from the usage log at startup). */
  load(records: { at: string; cost: number }[]) {
    this.roll();
    for (const r of records) {
      const t = Date.parse(r.at);
      if (!Number.isFinite(t) || !(r.cost > 0)) continue;
      if (dayKey(t) === this.day.key) this.day.spent += r.cost;
      if (monthKey(t) === this.month.key) this.month.spent += r.cost;
    }
  }

  /** null when the call could push today's or this month's spend over its cap. */
  reserve(amount: number): Reservation | null {
    this.roll();
    const fits = (b: { spent: number; reserved: number }, cap: number) => b.spent + b.reserved + amount <= cap;
    if (!fits(this.day, this.caps.dailyCapUsd) || !fits(this.month, this.caps.monthlyCapUsd)) return null;
    this.day.reserved += amount;
    this.month.reserved += amount;
    return { amount, day: this.day.key, month: this.month.key };
  }

  settle(r: Reservation, actual: number) {
    this.roll();
    if (r.day === this.day.key) this.day.reserved = Math.max(0, this.day.reserved - r.amount);
    if (r.month === this.month.key) this.month.reserved = Math.max(0, this.month.reserved - r.amount);
    this.day.spent += actual; // a call that ran over midnight counts for the new day
    this.month.spent += actual;
  }

  /** Room for at least one more call of `amount`. */
  available(amount: number): boolean {
    this.roll();
    return this.day.spent + this.day.reserved + amount <= this.caps.dailyCapUsd &&
      this.month.spent + this.month.reserved + amount <= this.caps.monthlyCapUsd;
  }

  snapshot(): Spend {
    this.roll();
    const r = (n: number) => Math.round(n * 1e6) / 1e6;
    return { dayUsd: r(this.day.spent), dayCapUsd: this.caps.dailyCapUsd, monthUsd: r(this.month.spent), monthCapUsd: this.caps.monthlyCapUsd };
  }
}
