import assert from "node:assert/strict";
import test from "node:test";

import { convertMinorUnits, normalizeCurrencyCodes } from "../dist/src/index.js";

test("converts USD cents to COP pesos with a quoted rate", () => {
  assert.equal(convertMinorUnits(10_00, "USD", "COP", 4_000), 40_000);
});

test("converts zero-decimal COP to USD cents", () => {
  assert.equal(convertMinorUnits(40_000, "COP", "USD", 0.00025), 1_000);
});

test("normalizes enabled currencies and always retains the base currency", () => {
  assert.deepEqual(normalizeCurrencyCodes(["usd", "COP", "eur", "bad-code"], "cop"), ["COP", "USD", "EUR"]);
});
