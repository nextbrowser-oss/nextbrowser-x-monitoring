import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyState } from "../state.js";
import { describeEvent, parseDuration, settingsFromFlags } from "./cli.js";
import { loadState, saveState } from "./store.js";

describe("parseDuration", () => {
  it("reads the durations the flags take", () => {
    expect(parseDuration("90s", "--x")).toBe(90_000);
    expect(parseDuration("5m", "--x")).toBe(300_000);
    expect(parseDuration("1.5h", "--x")).toBe(5_400_000);
    expect(parseDuration("45", "--x")).toBe(45_000);
    expect(() => parseDuration("soon", "--interval")).toThrow("--interval");
  });
});

describe("settingsFromFlags", () => {
  it("patches only what was given, and the negative flag wins", () => {
    expect(settingsFromFlags({})).toEqual({});
    expect(settingsFromFlags({ "no-posts": true, reposts: true, "no-replies": true, replies: true, "keep-tab": true })).toEqual({
      watchPosts: false,
      includeReposts: true,
      includeReplies: false,
      parkTab: false,
    });
    expect(settingsFromFlags({ followers: "@NASA, elonmusk", "followers-interval": "1h", "feed-limit": "40" })).toEqual({
      followerHandles: ["NASA", "elonmusk"],
      followersIntervalMs: 3_600_000,
      feedLimit: 40,
    });
  });

  it("refuses a handle X would not have", () => {
    expect(() => settingsFromFlags({ followers: "ok, not a handle!" })).toThrow("not an X handle");
  });
});

describe("describeEvent", () => {
  it("writes one readable line per event", () => {
    const at = Date.UTC(2026, 8, 25, 12, 0);
    const line = describeEvent({
      type: "new_post",
      at,
      post: { key: "1", id: "1", url: "https://x.com/a/status/1", author: "a", text: "", repost: true, repostedBy: "b", reply: false, photos: 2, video: false, card: false },
    });
    expect(line).toContain("@b reposted @a: [2 photos]  https://x.com/a/status/1");
    expect(describeEvent({ type: "followers_changed", at, handle: "me", own: true, previous: 10, current: 12, delta: 2, exact: true }))
      .toMatch(/followers @me \(you\): 10 → 12 \(\+2\)$/);
  });
});

describe("the state file", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("round-trips, and a missing file is a fresh state", async () => {
    dir = await mkdtemp(join(tmpdir(), "x-monitor-"));
    const path = join(dir, "nested", "state.json");
    expect(await loadState(path)).toEqual(emptyState());
    const state = { ...emptyState({ followerHandles: ["NASA"] }), feed: { seen: ["1"], lastPostId: "1", since: 5 } };
    await saveState(path, state);
    expect(await loadState(path)).toEqual(state);
    expect(JSON.parse(await readFile(path, "utf8")).settings.followerHandles).toEqual(["NASA"]);
  });

  it("refuses a file it cannot read rather than starting over", async () => {
    dir = await mkdtemp(join(tmpdir(), "x-monitor-"));
    const path = join(dir, "state.json");
    await writeFile(path, "{ not json");
    await expect(loadState(path)).rejects.toThrow();
  });
});
