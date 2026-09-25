import { describe, expect, it } from "vitest";
import { findFresh, newestOriginalId, normalizeFeed, type FeedPost, type FreshnessRules } from "./posts.js";
import type { RawPost } from "./scripts.js";

function raw(patch: Partial<RawPost>): RawPost {
  return {
    id: "100",
    url: "",
    author: "alice",
    text: "hello",
    created_at: "",
    social_context: "",
    reposted_by: "",
    reply_context: "",
    repost: false,
    reply: false,
    promoted: false,
    photos: 0,
    video: false,
    card: false,
    quoted_url: "",
    ...patch,
  };
}

function post(id: string, patch: Partial<FeedPost> = {}): FeedPost {
  return { key: id, id, url: "", author: "alice", text: "", repost: false, reply: false, photos: 0, video: false, card: false, ...patch };
}

function repost(id: string, by: string, patch: Partial<FeedPost> = {}): FeedPost {
  return post(id, { key: `${id}@${by.toLowerCase()}`, repost: true, repostedBy: by, ...patch });
}

const rules = (patch: Partial<FreshnessRules> = {}): FreshnessRules => ({
  seen: new Set<string>(),
  includeReposts: true,
  includeReplies: true,
  ...patch,
});

describe("normalizeFeed", () => {
  it("keeps media-only posts, drops ads and junk, and dates posts by their id", () => {
    const posts = normalizeFeed([
      raw({ id: "1800000000000000000", text: "", photos: 2 }),
      raw({ id: "200", promoted: true }),
      raw({ id: "not-an-id" }),
      raw({ id: "300", author: "has space" }),
      raw({ id: "1800000000000000000" }),
    ]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: "1800000000000000000", text: "", photos: 2, createdAt: 1717988417039 });
  });

  it("prefers the page's own time", () => {
    const [first] = normalizeFeed([raw({ id: "1800000000000000000", created_at: "2026-09-25T10:00:00.000Z" })]);
    expect(first?.createdAt).toBe(Date.parse("2026-09-25T10:00:00.000Z"));
  });

  it("keys a repost by who reposted it", () => {
    const posts = normalizeFeed([
      raw({ id: "500", author: "carol", reposted_by: "Bob", repost: true }),
      raw({ id: "500", author: "carol", reposted_by: "dave", repost: true }),
      raw({ id: "500", author: "carol" }),
    ]);
    expect(posts.map((entry) => entry.key)).toEqual(["500@bob", "500@dave", "500"]);
    expect(posts[0]).toMatchObject({ repost: true, repostedBy: "Bob" });
  });
});

describe("findFresh", () => {
  it("announces what is newer than the watermark, oldest first", () => {
    const feed = [post("30"), post("20"), post("10")];
    const result = findFresh(feed, rules({ lastPostId: "10", seen: new Set(["10"]) }));
    expect(result.fresh.map((entry) => entry.id)).toEqual(["20", "30"]);
    expect(result.known).toBe(1);
  });

  it("does not stop at an old post a new reply sits under", () => {
    // x.com draws the answered post above the reply.
    const feed = [post("40"), post("5", { author: "bob" }), post("35", { reply: true }), post("10")];
    const result = findFresh(feed, rules({ lastPostId: "10", seen: new Set(["10", "5"]) }));
    expect(result.fresh.map((entry) => entry.id)).toEqual(["35", "40"]);
  });

  it("announces a repost only above the first post the last pass saw", () => {
    const feed = [repost("7", "bob"), post("30"), post("20"), repost("3", "carol")];
    const result = findFresh(feed, rules({ lastPostId: "20", seen: new Set(["20"]) }));
    expect(result.fresh.map((entry) => entry.key)).toEqual(["30", "7@bob"]);
  });

  it("leaves out reposts and replies when asked", () => {
    const feed = [repost("7", "bob"), post("30", { reply: true }), post("25"), post("20")];
    const result = findFresh(feed, rules({ lastPostId: "20", seen: new Set(["20"]), includeReposts: false, includeReplies: false }));
    expect(result.fresh.map((entry) => entry.key)).toEqual(["25"]);
  });

  it("never announces the account's own posts or reposts", () => {
    const feed = [repost("7", "Me"), post("30", { author: "ME" }), post("25"), post("20")];
    const result = findFresh(feed, rules({ lastPostId: "20", seen: new Set(["20"]), self: "me" }));
    expect(result.fresh.map((entry) => entry.key)).toEqual(["25"]);
  });

  it("skips posts older than the floor and what was already seen", () => {
    const feed = [post("40", { createdAt: 5_000 }), post("30", { createdAt: 500 }), post("25")];
    const result = findFresh(feed, rules({ lastPostId: "20", seen: new Set(["25"]), floor: 1_000 }));
    expect(result.fresh.map((entry) => entry.id)).toEqual(["40"]);
  });

  it("reports a read that never got back to known ground", () => {
    const result = findFresh([post("40"), post("30")], rules({ lastPostId: "20" }));
    expect(result.known).toBe(0);
    expect(result.fresh).toHaveLength(2);
  });
});

describe("newestOriginalId", () => {
  it("ignores reposts, whose ids are someone else's post", () => {
    expect(newestOriginalId([repost("999", "bob"), post("30"), post("40")])).toBe("40");
    expect(newestOriginalId([repost("999", "bob")])).toBeUndefined();
  });
});
