import assert from "node:assert/strict";
import test from "node:test";
import { shouldHoldForCalibration } from "./onboarding-policy.ts";

test("holds the first useful signals until the calibration target is covered", () => {
  assert.equal(shouldHoldForCalibration({ completedAt: null, confirmed: 0, target: 3, pendingCalibration: 0 }), true);
  assert.equal(shouldHoldForCalibration({ completedAt: null, confirmed: 0, target: 3, pendingCalibration: 3 }), false);
});

test("an already reserved calibration candidate stays reserved after another example is accepted", () => {
  assert.equal(shouldHoldForCalibration({ completedAt: null, confirmed: 1, target: 3, pendingCalibration: 2, currentCandidateHeld: true }), true);
  assert.equal(shouldHoldForCalibration({ completedAt: null, confirmed: 3, target: 3, pendingCalibration: 1, currentCandidateHeld: true }), false);
});

test("confirmed associations reduce the number of new held calibration slots", () => {
  assert.equal(shouldHoldForCalibration({ completedAt: null, confirmed: 2, target: 3, pendingCalibration: 0 }), true);
  assert.equal(shouldHoldForCalibration({ completedAt: null, confirmed: 2, target: 3, pendingCalibration: 1 }), false);
});

test("completed onboarding never intercepts automatic posting", () => {
  assert.equal(shouldHoldForCalibration({ completedAt: new Date().toISOString(), confirmed: 0, target: 3, pendingCalibration: 0 }), false);
  assert.equal(shouldHoldForCalibration(null), false);
});
