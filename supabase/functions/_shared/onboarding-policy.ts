export interface CalibrationState {
  completedAt: string | null;
  confirmed: number;
  target: number;
  pendingCalibration: number;
  currentCandidateHeld?: boolean;
}

/**
 * Holds only the number of useful signals still needed for onboarding calibration.
 * A candidate already reserved for calibration stays reserved until the target is met.
 */
export function shouldHoldForCalibration(state: CalibrationState | null): boolean {
  if (!state || state.completedAt) return false;
  const target = Math.max(3, Math.min(5, Math.trunc(state.target || 3)));
  const confirmed = Math.max(0, Math.trunc(state.confirmed || 0));
  const pending = Math.max(0, Math.trunc(state.pendingCalibration || 0));
  if (confirmed >= target) return false;
  if (state.currentCandidateHeld) return true;
  return pending < Math.max(0, target - confirmed);
}
