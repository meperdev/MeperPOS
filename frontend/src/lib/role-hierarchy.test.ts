import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import frontendTable from "./role-hierarchy.table.json";

// Next cannot import from ../backend, so each side owns a copy of the table and
// this test keeps them identical (the backend copy is what RolesGuard reads).
const backendTable = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "..", "backend", "src", "common", "guards", "role-hierarchy.table.json"),
    "utf8",
  ),
) as unknown;

describe("role hierarchy contract", () => {
  it("is the same table the backend guard reads", () => {
    expect(frontendTable).toEqual(backendTable);
  });
});
