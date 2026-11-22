import { test } from "node:test";
import assert from "node:assert/strict";
import { smokeDatabaseProblem, assertSmokeDatabase } from "./database-guard.mjs";

test("accepts the dedicated smoke database on its own port", () => {
  assert.equal(
    smokeDatabaseProblem(
      "postgresql://playwright:playwright@127.0.0.1:55433/meperpos_playwright",
    ),
    null,
  );
  assert.equal(
    smokeDatabaseProblem(
      "postgres://playwright:playwright@localhost:55433/meperpos_playwright?schema=public",
    ),
    null,
  );
});

test("refuses the developer database by name", () => {
  assert.match(
    smokeDatabaseProblem("postgresql://admin:admin123@localhost:55433/inventario_db"),
    /developer database/,
  );
});

test("refuses the developer port, explicit or implied", () => {
  assert.match(
    smokeDatabaseProblem("postgresql://p:p@127.0.0.1:5432/meperpos_playwright"),
    /port 5432/,
  );
  assert.match(
    smokeDatabaseProblem("postgresql://p:p@127.0.0.1/meperpos_playwright"),
    /port 5432/,
  );
});

test("refuses any other database name, a remote host, or a missing URL", () => {
  assert.match(
    smokeDatabaseProblem("postgresql://p:p@127.0.0.1:55433/meperpos_test"),
    /must be "meperpos_playwright"/,
  );
  assert.match(
    smokeDatabaseProblem("postgresql://p:p@db.example.com:55433/meperpos_playwright"),
    /not a loopback/,
  );
  assert.match(smokeDatabaseProblem(undefined), /empty/);
  assert.match(smokeDatabaseProblem("not a url"), /not a valid URL/);
  assert.match(
    smokeDatabaseProblem("mysql://p:p@127.0.0.1:55433/meperpos_playwright"),
    /protocol/,
  );
});

test("assertSmokeDatabase throws with the reason", () => {
  assert.throws(
    () => assertSmokeDatabase("postgresql://admin:admin123@localhost:5432/inventario_db"),
    /Refusing to use the database: database "inventario_db"/,
  );
  assert.doesNotThrow(() =>
    assertSmokeDatabase("postgresql://p:p@127.0.0.1:55433/meperpos_playwright"),
  );
});
