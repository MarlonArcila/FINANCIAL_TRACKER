import test from "node:test";
import assert from "node:assert/strict";
import { guessImportMapping, normalizeImportRows, parseDelimitedText, parseJsonTable, parseMoneyToMinor } from "../dist/src/importing/index.js";

test("CSV detects semicolon, quotes and Spanish headers", () => {
  const table = parseDelimitedText('Fecha;Descripción;Monto;Tipo\n13/08/2026;"Café, Centro";12.500,50;Gasto\n');
  assert.deepEqual(table.headers, ["Fecha", "Descripción", "Monto", "Tipo"]);
  assert.equal(table.rows[0]["Descripción"], "Café, Centro");
  const mapping = guessImportMapping(table.headers);
  assert.equal(mapping.date, "Fecha");
  assert.equal(mapping.amount, "Monto");
  assert.equal(mapping.kind, "Tipo");
});

test("normalizes signed and localized amounts", () => {
  const table = parseDelimitedText('date,amount,type,currency,merchant\n2026-08-13,"1,234.56",income,USD,Client\n2026-08-12,"-25.50",,USD,Cafe\n');
  const result = normalizeImportRows(table.rows, { date: "date", amount: "amount", kind: "type", currency: "currency", merchant: "merchant" }, { defaultCurrency: "COP" });
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].amount_minor, 123456);
  assert.equal(result.rows[0].kind, "income");
  assert.equal(result.rows[1].kind, "expense");
});

test("supports separate income and expense columns", () => {
  const table = parseDelimitedText('Fecha,Ingreso,Gasto\n13/08/2026,"100.000,00",\n12/08/2026,,"25.500,00"\n');
  const result = normalizeImportRows(table.rows, { date: "Fecha", income: "Ingreso", expense: "Gasto" }, { defaultCurrency: "COP" });
  assert.deepEqual(result.rows.map((row) => [row.kind, row.amount_minor]), [["income", 10000000], ["expense", 2550000]]);
});

test("JSON accepts transactions wrapper", () => {
  const table = parseJsonTable({ transactions: [{ Fecha: "2026-08-13", Valor: 10 }] });
  assert.deepEqual(table.headers.sort(), ["Fecha", "Valor"]);
});

test("money parser handles COP and US formatting", () => {
  assert.equal(parseMoneyToMinor("$ 1.234.567,89"), 123456789);
  assert.equal(parseMoneyToMinor("USD 1,234.56"), 123456);
});
