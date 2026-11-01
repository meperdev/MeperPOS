/** Commercial default for a new organization's trial. */
export const TRIAL_DAYS = 15;

/** The trial deadline for an organization created at `now`. */
export function trialEndsAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}
