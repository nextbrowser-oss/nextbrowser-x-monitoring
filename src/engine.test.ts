import { beforeEach, describe, expect, it } from "vitest";
import { runPass, type PassDeps, type PassResult } from "./engine.js";
import type { FollowersChangedEvent, MonitorEvent, NewPostEvent } from "./events.js";
import { emptyState, type MonitorState } from "./state.js";
import { FakeX, NOON, rawPost } from "./testing/fakeBrowser.js";

const MINUTE = 60_000;

let clock = NOON + 60 * MINUTE;
let x: FakeX;

beforeEach(() => {
  clock = NOON + 60 * MINUTE;
  x = new FakeX();
});

function pass(state: MonitorState, extra: Partial<PassDeps> = {}): Promise<PassResult> {
  return runPass({
    browser: x,
    state,
    now: () => clock,
    // Waiting is instant, but the clock moves, so a wait that has a deadline
    // still reaches it.
    sleep: async (ms) => {
      clock += ms;
    },
    random: () => 0.5,
    ...extra,
  });
}

const types = (events: MonitorEvent[]) => events.map((event) => event.type);
const posts = (events: MonitorEvent[]) =>
  events.filter((event): event is NewPostEvent => event.type === "new_post").map((event) => event.post.author);

describe("the first pass", () => {
  it("signs in, takes the feed as it is, and records the account's followers", async () => {
    x.feed = [rawPost("alice", 50), rawPost("bob", 40)];
    x.profiles.me = { followers: 100, following: 10 };
    const result = await pass(emptyState());
    const { state, events, summary } = result;

    expect(types(events)).toEqual(["signed_in"]);
    expect(result.posts.map((post) => post.author)).toEqual(["alice", "bob"]);
    expect(summary).toMatchObject({ signedIn: true, handle: "me", baseline: true, feedRead: true, newPosts: 0, followerChecks: 1 });
    expect(state.account).toMatchObject({ handle: "me", signedIn: true });
    expect(state.feed).toMatchObject({ owner: "me", since: expect.any(Number) });
    expect(state.feed.seen).toHaveLength(2);
    expect(state.followers.me).toMatchObject({ followers: 100, following: 10, exact: true, history: [{ followers: 100 }] });
    // The tab is left on a blank page: a feed on screen keeps costing traffic.
    expect(x.opened.at(-1)).toBe("about:blank");
    // A first read does not scroll: it announces nothing, so there is nothing
    // to look for further down.
    expect(x.labels).not.toContain("scroll");
  });

  it("hands back what the feed shows, without the account's own posts", async () => {
    x.feed = [rawPost("alice", 50), rawPost("me", 45), rawPost("bob", 40)];
    const { posts } = await pass(emptyState({ trackOwnFollowers: false }));
    expect(posts.map((post) => post.author)).toEqual(["alice", "bob"]);
  });

  it("never mutates the state it was given", async () => {
    x.feed = [rawPost("alice", 50)];
    x.profiles.me = { followers: 100 };
    const given = emptyState();
    const copy = structuredClone(given);
    await pass(Object.freeze(given));
    expect(given).toEqual(copy);
  });
});

describe("the Following feed", () => {
  it("announces what appeared since the last pass, oldest first", async () => {
    x.feed = [rawPost("alice", 50), rawPost("bob", 40)];
    const first = await pass(emptyState({ trackOwnFollowers: false }));
    clock += 5 * MINUTE;
    x.feed = [rawPost("carol", 64), rawPost("dave", 62), ...x.feed];
    const second = await pass(first.state);

    expect(posts(second.events)).toEqual(["dave", "carol"]);
    expect(second.summary).toMatchObject({ newPosts: 2, baseline: false, gap: false });
    expect((second.events[0] as NewPostEvent).account).toBe("me");
    // And nothing twice.
    clock += 5 * MINUTE;
    const third = await pass(second.state);
    expect(posts(third.events)).toEqual([]);
  });

  it("scrolls until it is back in ground the last pass read", async () => {
    x.pageSize = 3;
    const old = [rawPost("old1", 30), rawPost("old2", 29), rawPost("old3", 28), rawPost("old4", 27)];
    x.feed = old;
    const first = await pass(emptyState({ trackOwnFollowers: false }));
    clock += 10 * MINUTE;
    const fresh = [1, 2, 3, 4, 5].map((n) => rawPost(`new${n}`, 70 - n));
    x.feed = [...fresh, ...old];
    const second = await pass(first.state);

    expect(posts(second.events)).toEqual(["new5", "new4", "new3", "new2", "new1"]);
    expect(second.summary.scrolls).toBeGreaterThan(0);
    expect(second.summary.gap).toBe(false);
  });

  it("says so when the read never got back to the last pass", async () => {
    x.pageSize = 2;
    x.feed = [rawPost("old", 30)];
    const first = await pass(emptyState({ trackOwnFollowers: false, maxScrolls: 1 }));
    x.feed = [1, 2, 3, 4, 5, 6].map((n) => rawPost(`new${n}`, 70 - n)).concat(x.feed);
    const second = await pass(first.state);

    expect(second.summary.gap).toBe(true);
    expect(second.summary.notes.join(" ")).toContain("not read back");
    expect(posts(second.events)).toHaveLength(4);
  });

  it("does not announce a flood after a long absence", async () => {
    x.feed = [rawPost("alice", 0)];
    const first = await pass(emptyState({ trackOwnFollowers: false, maxPostAgeMs: 60 * MINUTE }));
    clock = NOON + 24 * 60 * MINUTE;
    x.feed = [rawPost("recent", 24 * 60 - 5), rawPost("stale", 60), ...x.feed];
    const second = await pass(first.state);
    expect(posts(second.events)).toEqual(["recent"]);
  });

  it("switches the home page to the Following feed with a real click", async () => {
    x.tabSelected = false;
    x.feed = [rawPost("alice", 50)];
    await pass(emptyState({ trackOwnFollowers: false }));
    expect(x.clicks).toEqual([[300, 80]]);
  });

  it("presses the tab through the page when the browser cannot click", async () => {
    x.tabSelected = false;
    x.clickAt = undefined;
    x.feed = [rawPost("alice", 50)];
    const { summary } = await pass(emptyState({ trackOwnFollowers: false }));
    expect(x.labels).toContain("following-tab-click");
    expect(summary.feedRead).toBe(true);
  });

  it("gives up on the feed, not the pass, when there is no Following tab", async () => {
    x.tabExists = false;
    x.profiles.me = { followers: 5 };
    const { summary } = await pass(emptyState());
    expect(summary.feedRead).toBe(false);
    expect(summary.notes.join(" ")).toContain("Following tab was not found");
    expect(summary.followerChecks).toBe(1);
  });
});

describe("followers", () => {
  it("reports a change with its delta, for the account and for tracked handles", async () => {
    x.profiles.me = { followers: 100 };
    x.profiles.nasa = { followers: 92_374_631 };
    const settings = { watchPosts: false, followerHandles: ["NASA"] };
    const first = await pass(emptyState(settings));
    expect(first.summary.followerChecks).toBe(2);

    clock += 31 * MINUTE;
    x.profiles.me = { followers: 97 };
    x.profiles.nasa = { followers: 92_374_700 };
    const second = await pass(first.state);
    const changes = second.events.filter((event): event is FollowersChangedEvent => event.type === "followers_changed");
    expect(changes).toEqual([
      expect.objectContaining({ handle: "me", own: true, previous: 100, current: 97, delta: -3, exact: true }),
      expect.objectContaining({ handle: "NASA", own: false, previous: 92_374_631, current: 92_374_700, delta: 69 }),
    ]);
    expect(second.state.followers.me?.history.map((sample) => sample.followers)).toEqual([100, 97]);
  });

  it("does not read an account again before its interval", async () => {
    x.profiles.me = { followers: 100 };
    const first = await pass(emptyState({ watchPosts: false }));
    clock += 5 * MINUTE;
    const second = await pass(first.state);
    expect(second.summary.followerChecks).toBe(0);
  });

  it("reads the rounded label when the page has no exact figure", async () => {
    x.profiles.me = { followers: null, followersText: "12.3K Followers" };
    const first = await pass(emptyState({ watchPosts: false }));
    expect(first.state.followers.me).toMatchObject({ followers: 12_300, exact: false, label: "12.3K Followers" });
    clock += 31 * MINUTE;
    x.profiles.me = { followers: null, followersText: "12.4K Followers" };
    const second = await pass(first.state);
    expect(second.events).toEqual([expect.objectContaining({ type: "followers_changed", delta: 100, exact: false })]);
  });

  it("does not call rounding a change when the figure turns exact", async () => {
    x.profiles.me = { followers: null, followersText: "12.3K Followers" };
    const first = await pass(emptyState({ watchPosts: false }));
    clock += 31 * MINUTE;
    x.profiles.me = { followers: 12_345 };
    const second = await pass(first.state);
    expect(types(second.events)).toEqual([]);
    expect(second.state.followers.me).toMatchObject({ followers: 12_345, exact: true });
  });

  it("notes an account that is gone and tries it again later, not every pass", async () => {
    x.profiles.gone = { unavailable: true };
    const settings = { watchPosts: false, trackOwnFollowers: false, followerHandles: ["gone"] };
    const first = await pass(emptyState(settings));
    expect(first.summary.notes.join(" ")).toContain("@gone is unavailable");
    expect(first.state.followers.gone).toMatchObject({ attemptedAt: clock });
    clock += 5 * MINUTE;
    expect((await pass(first.state)).summary.followerChecks).toBe(0);
    clock += 6 * MINUTE;
    expect((await pass(first.state)).summary.followerChecks).toBe(1);
  });
});

describe("the session", () => {
  it("reports a sign-out once, and reads nothing while signed out", async () => {
    x.profiles.me = { followers: 1 };
    const first = await pass(emptyState());
    x.signedIn = false;
    const second = await pass(first.state);
    expect(types(second.events)).toEqual(["signed_out"]);
    expect(second.summary).toMatchObject({ loginRequired: true, feedRead: false, followerChecks: 0 });
    expect(second.state.account).toMatchObject({ handle: "me", signedIn: false });

    const third = await pass(second.state);
    expect(types(third.events)).toEqual([]);

    x.signedIn = true;
    const fourth = await pass(third.state);
    expect(types(fourth.events)).toEqual(["signed_in"]);
  });

  it("starts the feed over when another account signs in", async () => {
    x.feed = [rawPost("alice", 50)];
    const first = await pass(emptyState({ trackOwnFollowers: false }));
    x.handle = "someone_else";
    x.feed = [rawPost("zed", 70), ...x.feed];
    const second = await pass(first.state);
    expect(types(second.events)).toEqual(["account_changed"]);
    expect(second.summary.baseline).toBe(true);
    expect(second.state.feed.owner).toBe("someone_else");
  });

  it("reports a home page x.com never drew as a page failure, not a sign-out", async () => {
    x.homeRenders = false;
    const { summary, events } = await pass(emptyState());
    expect(summary.loginRequired).toBe(false);
    expect(summary.blocked).toContain("did not render the home page");
    expect(types(events)).toEqual([]);
  });

  it("stops between steps when asked, keeping what it learned", async () => {
    x.feed = [rawPost("alice", 50)];
    x.profiles.me = { followers: 1 };
    let steps = 0;
    const { summary, state } = await pass(emptyState(), { shouldStop: () => ++steps > 1 });
    expect(summary.stopped).toBe(true);
    expect(state.account?.handle).toBe("me");
    expect(summary.followerChecks).toBe(0);
    expect(x.opened.at(-1)).toBe("about:blank");
  });

  it("keeps the tab when asked to", async () => {
    x.feed = [rawPost("alice", 50)];
    await pass(emptyState({ parkTab: false, trackOwnFollowers: false }));
    expect(x.opened).not.toContain("about:blank");
  });
});
