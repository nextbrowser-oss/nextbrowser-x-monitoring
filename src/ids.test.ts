import { describe, expect, it } from "vitest";
import { compareIds, maxId, snowflakeTime } from "./ids.js";

describe("compareIds", () => {
  it("orders ids beyond Number precision", () => {
    expect(compareIds("2103243305685225779", "2103243305685225780")).toBe(-1);
    expect(compareIds("2103243305685225780", "2103243305685225779")).toBe(1);
    expect(compareIds("99", "100")).toBe(-1);
    expect(compareIds("0100", "100")).toBe(0);
  });

  it("keeps the larger id", () => {
    expect(maxId(undefined, "5")).toBe("5");
    expect(maxId("7", undefined)).toBe("7");
    expect(maxId("7", "12")).toBe("12");
  });
});

describe("snowflakeTime", () => {
  it("reads the creation time an id carries", () => {
    // 1800000000000000000 >> 22 = 429153442382, plus the epoch.
    expect(snowflakeTime("1800000000000000000")).toBe(1717988417039);
  });

  it("has no time for ids from before snowflakes or for junk", () => {
    expect(snowflakeTime("20")).toBeUndefined();
    expect(snowflakeTime("abc")).toBeUndefined();
    expect(snowflakeTime("")).toBeUndefined();
  });
});
