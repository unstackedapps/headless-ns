import assert from "node:assert/strict";
import test from "node:test";
import { likeTerm, searchAnd } from "../server/netsuite.mjs";

// Splits SQL into string literals and the code between them, honoring '' as an escaped quote.
function literals(sql) {
  const found = [];
  let code = "";
  let i = 0;
  while (i < sql.length) {
    if (sql[i] !== "'") {
      code += sql[i++];
      continue;
    }
    let value = "";
    i += 1;
    for (;;) {
      assert.ok(i < sql.length, `unterminated literal in ${sql}`);
      if (sql[i] === "'" && sql[i + 1] === "'") {
        value += "'";
        i += 2;
      } else if (sql[i] === "'") {
        i += 1;
        break;
      } else {
        value += sql[i++];
      }
    }
    found.push(value);
  }
  return { found, code };
}

const attacks = [
  "x' OR 1=1 --",
  "'; DROP TABLE customer; --",
  "o'brien",
  "'''",
  "a\\' OR '1'='1",
  "%' UNION SELECT password FROM employee --",
  "x'".repeat(40),
  "名前' OR 'a'='a",
];

test("likeTerm keeps only safe characters and doubles quotes", () => {
  assert.equal(likeTerm("O'Brien & Co."), "o''brien & co.");
  assert.equal(likeTerm("a;b--c/*d*/"), "ab--cd");
  assert.equal(likeTerm("50%_off\\"), "50off");
  assert.equal(likeTerm(null), "");
  assert.ok(likeTerm("x".repeat(100)).length <= 60);
});

test("searchAnd is empty for an empty term", () => {
  assert.equal(searchAnd(["entityid"], ""), "");
  assert.equal(searchAnd(["entityid"], ";;;"), "");
});

test("searchAnd keeps every term inside its string literal", () => {
  const columns = ["c.entityid", "c.companyname"];
  for (const attack of attacks) {
    const sql = searchAnd(columns, attack);
    const { found, code } = literals(sql);
    assert.equal(found.length, columns.length, sql);
    for (const value of found) assert.match(value, /^%[a-z0-9 @.&'-]*%$/, sql);
    assert.equal(code, " AND (LOWER(c.entityid) LIKE  OR LOWER(c.companyname) LIKE )", sql);
  }
});
