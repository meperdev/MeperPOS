import { TRIAL_DAYS, trialEndsAt } from './trial.constants';

describe('trialEndsAt', () => {
  it('adds the trial window to the creation instant', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');

    expect(trialEndsAt(now).toISOString()).toBe('2026-01-16T12:00:00.000Z');
    expect(TRIAL_DAYS).toBe(15);
  });
});
