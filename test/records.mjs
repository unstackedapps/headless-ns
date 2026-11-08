import assert from "node:assert/strict";
import test from "node:test";
import { cleanWrite, recordScalars, scalarFields } from "../server/records.mjs";

test("record forms keep plain fields and drop sensitive ones", () => {
  const fields = scalarFields({
    companyName: { title: "Company", type: "string" },
    socialsecuritynumber: { title: "SSN", type: "string" },
    password: { title: "Password", type: "string" },
    addressBook: { title: "Address", type: "object" },
    balance: { title: "Balance", type: "number" },
  });
  assert.deepEqual(
    fields.map((field) => field.id),
    ["balance", "companyName"],
  );
});

test("a saved record sends only the values that were filled in", () => {
  assert.deepEqual(cleanWrite({ companyName: " Acme ", phone: "", birthdate: "2000-01-01", id: "3", note: { text: "x" } }), {
    companyName: "Acme",
  });
  assert.deepEqual(recordScalars({ companyName: "Acme", addressBook: {}, gender: "x", balance: 2 }).map((row) => row.id), [
    "balance",
    "companyName",
  ]);
});
