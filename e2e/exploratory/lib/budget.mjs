/**
 * The explorer's budget: a hard cap on actions taken after login AND on wall
 * time. Whichever runs out first stops the run; the report still gets written.
 */

export class BudgetExhausted extends Error {
  constructor(reason) {
    super(`budget exhausted: ${reason}`);
    this.name = "BudgetExhausted";
    this.reason = reason;
  }
}

export class Budget {
  /**
   * @param {{ maxActions: number, maxMs: number, now?: () => number }} options
   */
  constructor({ maxActions, maxMs, now = Date.now }) {
    if (!Number.isInteger(maxActions) || maxActions <= 0) {
      throw new Error(`maxActions must be a positive integer, got ${maxActions}`);
    }
    if (!Number.isFinite(maxMs) || maxMs <= 0) {
      throw new Error(`maxMs must be a positive number, got ${maxMs}`);
    }
    this.maxActions = maxActions;
    this.maxMs = maxMs;
    this.now = now;
    this.startedAt = now();
    this.actions = 0;
    /** Set once a limit is hit, so the report can say which one. */
    this.exhaustedBy = null;
  }

  elapsedMs() {
    return this.now() - this.startedAt;
  }

  /** Returns the limit that is used up, or null while there is budget left. */
  exhausted() {
    if (this.actions >= this.maxActions) return "actions";
    if (this.elapsedMs() >= this.maxMs) return "time";
    return null;
  }

  /** Reserves one action, or throws BudgetExhausted. */
  spend() {
    const reason = this.exhausted();
    if (reason) {
      this.exhaustedBy ??= reason;
      throw new BudgetExhausted(reason);
    }
    this.actions += 1;
    return this.actions;
  }

  summary() {
    return {
      actions: this.actions,
      maxActions: this.maxActions,
      elapsedMs: this.elapsedMs(),
      maxMs: this.maxMs,
      exhaustedBy: this.exhaustedBy,
    };
  }
}
