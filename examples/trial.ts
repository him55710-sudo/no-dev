// Change 14 to 30. At day 14 the trial changes from false to true.
export const trialDays = 14;
export function isTrialActive(daysSinceSignup: number) {
  if (daysSinceSignup < 0) throw new Error("Days cannot be negative");
  return daysSinceSignup < trialDays;
}
