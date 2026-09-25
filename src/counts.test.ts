import { describe, expect, it } from "vitest";
import { parseCount } from "./counts.js";

describe("parseCount", () => {
  it.each([
    ["1,234 Followers", 1234],
    ["117\nFollowing", 117],
    ["1 234 читателя", 1234],
    ["1 234", 1234],
    ["1 234 abonnés", 1234],
    ["1.234 Follower", 1234],
    ["0 Followers", 0],
    ["9,999", 9999],
  ])("reads the exact figure in %j", (label, value) => {
    expect(parseCount(label)).toEqual({ value, approximate: false });
  });

  it.each([
    ["92.3M Followers", 92_300_000],
    ["92,3 млн\nЧитатели", 92_300_000],
    ["12.3K", 12_300],
    ["2 тыс.", 2_000],
    ["533 тыс.", 533_000],
    ["1,2 Mio. Follower", 1_200_000],
    ["1,5 Mrd.", 1_500_000_000],
    ["12万 フォロワー", 120_000],
    ["3.4억", 340_000_000],
    ["1.1B", 1_100_000_000],
    ["45,6 mil seguidores", 45_600],
  ])("reads the rounded figure in %j", (label, value) => {
    expect(parseCount(label)).toEqual({ value, approximate: true });
  });

  it("is undefined for anything that does not start with a figure", () => {
    expect(parseCount("")).toBeUndefined();
    expect(parseCount(undefined)).toBeUndefined();
    expect(parseCount("Followers")).toBeUndefined();
    expect(parseCount("—")).toBeUndefined();
  });
});
