import { describe, expect, it } from "vitest";
import { DISTINCT_COUNT_LIMIT, buildPhysicalProfile, compareDecimal } from "./physical-profile.js";

function profileOf(values: unknown[]) {
  return buildPhysicalProfile({ columns: ["c"], rows: values.map((value) => [value]), truncated: false }).columns[0]!;
}

describe("Physical Profile", () => {
  it("profiles every column in result order with the row count and truncation flag", () => {
    const profile = buildPhysicalProfile({ columns: ["region", "sales"], rows: [["east", 10], ["west", 20]], truncated: true });
    expect(profile).toMatchObject({ version: 1, rowCount: 2, truncated: true });
    expect(profile.columns.map((column) => column.name)).toEqual(["region", "sales"]);
  });

  it("scans every row, so a leading NULL does not decide the kind", () => {
    expect(profileOf([null, 3, 7])).toEqual({ name: "c", kind: "integer", encodedAs: "number", nullCount: 1, distinctCount: 2, min: "3", max: "7" });
  });

  it("treats DECIMAL text as decimal encoded as string, with exact range", () => {
    expect(profileOf(["12.50", "-3.25", null, "100.00"])).toEqual({ name: "c", kind: "decimal", encodedAs: "string", nullCount: 1, distinctCount: 3, min: "-3.25", max: "100.00" });
  });

  it("keeps big integers and high-precision decimals exact", () => {
    expect(profileOf([9007199254740993n, 1n])).toMatchObject({ kind: "integer", encodedAs: "bigint", min: "1", max: "9007199254740993" });
    expect(profileOf(["0.12345678901234567890", "0.12345678901234567891"])).toMatchObject({ min: "0.12345678901234567890", max: "0.12345678901234567891" });
  });

  it("writes JavaScript exponent notation as plain decimal text", () => {
    expect(profileOf([1e21, 1.5e-7])).toMatchObject({ kind: "decimal", min: "0.00000015", max: "1000000000000000000000" });
  });

  it("orders negatives, fractions and zero numerically, not lexically", () => {
    expect(profileOf([-10, -2, 0, 0.5, 9])).toMatchObject({ min: "-10", max: "9" });
    expect(compareDecimal("-0", "0")).toBe(0);
    expect(compareDecimal("1.50", "1.5")).toBe(0);
    expect(compareDecimal("-2.5", "-2.25")).toBe(-1);
  });

  it("combines integers and fractions in one numeric column as decimal", () => {
    expect(profileOf([1, 2.5])).toMatchObject({ kind: "decimal", encodedAs: "number", min: "1", max: "2.5" });
  });

  it("omits encodedAs when numbers and bigints share an integer column", () => {
    const profile = profileOf([1, 2n]);
    expect(profile.kind).toBe("integer");
    expect(profile.encodedAs).toBeUndefined();
  });

  it("marks inconsistent value types as mixed without a numeric range", () => {
    expect(profileOf([1, "12.5"])).toEqual({ name: "c", kind: "mixed", nullCount: 0, distinctCount: 2 });
    expect(profileOf([1, "north"])).toMatchObject({ kind: "mixed" });
    expect(profileOf([true, "north"])).toMatchObject({ kind: "mixed" });
  });

  it("reports an all-NULL column as null", () => {
    expect(profileOf([null, undefined])).toEqual({ name: "c", kind: "null", nullCount: 2, distinctCount: 0 });
  });

  it("profiles text, booleans, dates and JSON without a numeric range", () => {
    expect(profileOf(["east", "west"])).toEqual({ name: "c", kind: "text", nullCount: 0, distinctCount: 2 });
    expect(profileOf([true, false, true])).toEqual({ name: "c", kind: "boolean", nullCount: 0, distinctCount: 2 });
    expect(profileOf([new Date("2026-01-01T00:00:00Z")])).toMatchObject({ kind: "text" });
    expect(profileOf([{ a: 1 }, [1, 2]])).toMatchObject({ kind: "json", distinctCount: 2 });
    expect(profileOf([Number.NaN])).toMatchObject({ kind: "text" });
  });

  it("recognises only plain decimal text as numeric", () => {
    for (const accepted of ["0", "-0", "42", "-7", "3.14", "-0.001", "100.00"]) expect(profileOf([accepted]).kind, accepted).toBe("decimal");
    for (const rejected of ["+1", "1e3", "1E-2", " 1", "1 ", "1,000", "007", ".5", "5.", "", "-", "0x1F", "１２"]) expect(profileOf([rejected]).kind, JSON.stringify(rejected)).toBe("text");
  });

  it("counts distinct values exactly up to the limit and omits the count beyond it", () => {
    expect(profileOf(Array.from({ length: DISTINCT_COUNT_LIMIT }, (_, index) => index)).distinctCount).toBe(DISTINCT_COUNT_LIMIT);
    expect(profileOf(Array.from({ length: DISTINCT_COUNT_LIMIT + 1 }, (_, index) => index)).distinctCount).toBeUndefined();
    expect(profileOf([1, "1", 1n]).distinctCount).toBe(2);
  });
});
