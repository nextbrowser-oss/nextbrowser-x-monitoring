// @vitest-environment happy-dom
/// <reference lib="dom" />
//
// The page scripts run here against stand-in documents of both x.com front
// ends: the classic signed-in one with a data-testid on everything, and the
// rewrite (captured from x.com on 2026-09-25) with none. A script that does not
// even parse would otherwise only fail inside a browser, on someone's account.

import { afterEach, describe, expect, it } from "vitest";
import {
  allScripts,
  existsScript,
  feedScript,
  followingTabScript,
  identityScript,
  pageHealthScript,
  profileStatsScript,
  type FeedSnapshot,
  type FollowingTabState,
  type IdentitySnapshot,
  type PageHealth,
  type ProfileStatsSnapshot,
} from "./scripts.js";

function run<T>(script: string): T {
  // Indirect eval: the script runs in the page's global scope, as it would in
  // Runtime.evaluate, and comes back through JSON as it would over CDP.
  return JSON.parse(JSON.stringify((0, eval)(script))) as T;
}

function page(url: string, html: string): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
  document.body.innerHTML = html;
}

afterEach(() => {
  delete (window as unknown as { __TSR_ROUTER__?: unknown }).__TSR_ROUTER__;
  document.body.innerHTML = "";
});

const CHROME = `
  <header role="banner">
    <a data-testid="AppTabBar_Profile_Link" href="/me_handle">Profile</a>
    <div data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-me_handle"></div><span>Me</span></div>
  </header>`;

const TABS = (selected: "for-you" | "following", labels = ["For you", "Following"]) => `
  <div role="tablist">
    <div role="presentation"><a href="/home" role="tab" aria-selected="${selected === "for-you"}"><span>${labels[0]}</span></a></div>
    <div role="presentation"><a href="/home" role="tab" aria-selected="${selected === "following"}"><span>${labels[1]}</span></a></div>
  </div>`;

const CLASSIC_FEED = `
  <article data-testid="tweet">
    <a href="/alice"><div data-testid="UserAvatar-Container-alice"></div></a>
    <a href="/alice/status/1800000000000000001"><time datetime="2026-09-25T10:00:00.000Z">1h</time></a>
    <div data-testid="tweetText"><span>Hello </span><img alt="🚀"><span> world</span></div>
    <div data-testid="tweetPhoto"></div>
    <div role="link"><div data-testid="tweetText">quoted words</div><a href="/carol/status/1700000000000000000">quote</a></div>
  </article>
  <article data-testid="tweet">
    <a href="/bob"><span data-testid="socialContext">Bob reposted</span></a>
    <a href="/carol/status/1790000000000000000"><time datetime="2026-01-01T00:00:00.000Z">Jan 1</time></a>
    <div data-testid="tweetText">old, but reposted</div>
  </article>
  <article data-testid="tweet">
    <a href="/dave/status/1800000000000000003"><time datetime="2026-09-25T09:00:00.000Z">2h</time></a>
    <div dir="ltr"><span>Replying to @alice</span></div>
    <div data-testid="tweetText">agreed</div>
  </article>
  <article data-testid="tweet">
    <a href="/brand/status/1800000000000000005"><time datetime="2026-09-25T10:30:00.000Z">1m</time></a>
    <div data-testid="tweetText">buy now</div>
    <div data-testid="placementTracking"></div>
  </article>`;

// The rewritten front end, trimmed from a real profile page.
const REWRITE_ARTICLE = `
  <article class="flex flex-col gap-1">
    <a href="/NASA"><img alt="@NASA"></a>
    <a href="/NASA">NASA</a>
    <a href="/NASA/status/2103238811165524053">9 ч</a>
    <div dir="auto" class="font-chirp max-w-full whitespace-pre-wrap break-words text-text">Meet Crew-14!</div>
    <a href="/NASA/status/2103238811165524053/photo/1"><img alt="crew"></a>
    <span class="x-animated-count-visual" dir="ltr">2 тыс.</span>
  </article>`;

describe("every script", () => {
  it.each(Object.entries(allScripts()))("%s is a single valid expression", (_name, script) => {
    expect(() => new Function(`return ${script};`)).not.toThrow();
  });
});

describe("pageHealthScript", () => {
  it("calls a drawn home page rendered", () => {
    page("https://x.com/home", CHROME + TABS("following") + CLASSIC_FEED);
    expect(run<PageHealth>(pageHealthScript())).toMatchObject({ rendered: true, error_screen: false, login_wall: false });
  });

  it("calls the error screen by its content, even with the chrome around it", () => {
    page("https://x.com/home", `${CHROME}<main><span>Something went wrong. Try reloading.</span><button>Retry</button></main>`);
    expect(run<PageHealth>(pageHealthScript())).toMatchObject({ rendered: true, error_screen: true });
  });

  it("knows the sign-in gate", () => {
    page("https://x.com/i/flow/login?redirect_after_login=%2Fhome", `<input autocomplete="username">`);
    expect(run<PageHealth>(pageHealthScript()).login_wall).toBe(true);
  });
});

describe("existsScript", () => {
  it("ends a wait on x.com's onboarding gate, which draws none of the old sign-in markers", () => {
    page("https://x.com/i/jf/onboarding/web?redirect_after_login=%2Fhome&mode=login", `<div>See what's happening</div>`);
    expect(run<{ found: boolean }>(existsScript("article", true)).found).toBe(true);
    expect(run<{ found: boolean }>(existsScript("article")).found).toBe(false);
  });
});

describe("identityScript", () => {
  it("names the signed-in account from the chrome, not from the posts", () => {
    page("https://x.com/home", CLASSIC_FEED + CHROME);
    const snapshot = run<IdentitySnapshot>(identityScript());
    expect(snapshot.identity).toEqual({ session: true, handle: "me_handle" });
    expect(snapshot.login_wall).toBe(false);
  });

  it("reports no session on a signed-out page", () => {
    page("https://x.com/home", `<a href="/i/flow/login">Sign in</a>`);
    const snapshot = run<IdentitySnapshot>(identityScript());
    expect(snapshot.login_wall).toBe(true);
    expect(snapshot.identity.session).toBe(false);
  });
});

describe("followingTabScript", () => {
  it("finds the tab by its label and reports it unselected", () => {
    page("https://x.com/home", CHROME + TABS("for-you"));
    const tab = run<FollowingTabState>(followingTabScript(false));
    expect(tab).toMatchObject({ found: true, selected: false, matched: "label", labels: ["For you", "Following"] });
  });

  it("falls back to the second tab in a language it does not know", () => {
    page("https://x.com/home", CHROME + TABS("following", ["Para ti", "Folgend"]));
    const tab = run<FollowingTabState>(followingTabScript(false));
    expect(tab).toMatchObject({ found: true, selected: true, matched: "position" });
  });

  it("presses the tab through the page when asked", () => {
    page("https://x.com/home", CHROME + TABS("for-you"));
    let pressed = "";
    document.querySelectorAll('[role="tab"]')[1]!.addEventListener("click", (event: Event) => {
      event.preventDefault();
      pressed = (event.currentTarget as HTMLElement).textContent ?? "";
    });
    expect(run<FollowingTabState>(followingTabScript(true)).clicked).toBe(true);
    expect(pressed).toBe("Following");
  });

  it("finds nothing where there are no tabs", () => {
    page("https://x.com/home", CHROME);
    expect(run<FollowingTabState>(followingTabScript(false)).found).toBe(false);
  });
});

describe("feedScript", () => {
  it("reads the classic feed: text with emoji, media, quotes, reposts, replies, ads", () => {
    page("https://x.com/home", CHROME + TABS("following") + CLASSIC_FEED);
    const snapshot = run<FeedSnapshot>(feedScript(20));
    expect(snapshot.login_wall).toBe(false);
    expect(snapshot.posts).toHaveLength(4);
    const [first, repost, reply, ad] = snapshot.posts;
    expect(first).toMatchObject({
      id: "1800000000000000001",
      author: "alice",
      created_at: "2026-09-25T10:00:00.000Z",
      repost: false,
      photos: 1,
      quoted_url: "https://x.com/carol/status/1700000000000000000",
    });
    expect(first!.text.replace(/\s+/g, " ")).toBe("Hello 🚀 world");
    expect(repost).toMatchObject({ id: "1790000000000000000", author: "carol", reposted_by: "bob", repost: true });
    expect(reply).toMatchObject({ author: "dave", reply: true, reply_context: "Replying to @alice" });
    expect(ad).toMatchObject({ author: "brand", promoted: true });
  });

  it("reads the rewritten front end, which has no test ids and no <time>", () => {
    page("https://x.com/NASA", REWRITE_ARTICLE);
    const snapshot = run<FeedSnapshot>(feedScript(20));
    expect(snapshot.posts).toHaveLength(1);
    expect(snapshot.posts[0]).toMatchObject({
      id: "2103238811165524053",
      author: "NASA",
      text: "Meet Crew-14!",
      created_at: "",
      photos: 1,
      promoted: false,
    });
  });

  it("stops at the limit", () => {
    page("https://x.com/home", CLASSIC_FEED);
    expect(run<FeedSnapshot>(feedScript(2)).posts).toHaveLength(2);
  });

  it("tells an empty feed from an unrendered one", () => {
    page("https://x.com/home", `${CHROME}<div data-testid="emptyState">Welcome</div>`);
    expect(run<FeedSnapshot>(feedScript(20))).toMatchObject({ empty: true, posts: [] });
    page("https://x.com/home", CHROME);
    const blank = run<FeedSnapshot>(feedScript(20));
    expect(blank.empty).toBe(false);
    expect(blank.diag?.anchors).toBeGreaterThan(0);
  });
});

describe("profileStatsScript", () => {
  it("takes the exact counts from the rewritten site's router", () => {
    page("https://x.com/NASA", `
      <a href="/NASA/following"><div>117</div><div>Читаю</div></a>
      <a href="/NASA/verified_followers"><div>92,3&nbsp;млн</div><div>Читатели</div></a>`);
    (window as unknown as { __TSR_ROUTER__: unknown }).__TSR_ROUTER__ = {
      state: { matches: [{ loaderData: { guideTrends: [] } }, { loaderData: { screenName: "NASA", followers: 92374631, following: 117, tweets: 74329 } }] },
    };
    const stats = run<ProfileStatsSnapshot>(profileStatsScript("nasa"));
    expect(stats).toMatchObject({ rendered: true, exact: true, source: "router", handle: "NASA", followers: 92374631, following: 117, posts: 74329 });
    expect(stats.followers_text).toContain("92,3");
  });

  it("takes the exact counts from the user object behind the classic header", () => {
    page("https://x.com/alice", `
      <div data-testid="UserName">Alice @alice</div>
      <a href="/alice/following"><span>12</span> Following</a>
      <a href="/alice/verified_followers"><span>12.3K</span> Followers</a>`);
    const link = document.querySelector('a[href="/alice/verified_followers"]') as unknown as Record<string, unknown>;
    const header = { memoizedProps: { user: { legacy: { screen_name: "Alice", followers_count: 12345, friends_count: 12, statuses_count: 99 } } }, return: null };
    link["__reactFiber$test"] = { memoizedProps: { href: "/alice/verified_followers" }, return: { memoizedProps: { children: [] }, return: header } };
    const stats = run<ProfileStatsSnapshot>(profileStatsScript("@alice"));
    expect(stats).toMatchObject({ exact: true, source: "react", handle: "Alice", followers: 12345, following: 12, posts: 99 });
  });

  it("falls back to the drawn labels", () => {
    page("https://x.com/alice", `
      <a href="/Alice/following"><span>12</span> Following</a>
      <a href="/Alice/followers"><span>1,234</span> Followers</a>`);
    const stats = run<ProfileStatsSnapshot>(profileStatsScript("alice"));
    expect(stats).toMatchObject({ rendered: true, exact: false, source: "", followers: null });
    expect(stats.followers_text).toMatch(/^1,234\s+Followers$/);
    expect(stats.following_text).toMatch(/^12\s+Following$/);
  });

  it("does not read another account's counts", () => {
    page("https://x.com/alice", `<a href="/bob/followers"><span>5</span> Followers</a>`);
    const stats = run<ProfileStatsSnapshot>(profileStatsScript("alice"));
    expect(stats).toMatchObject({ rendered: false, followers_text: "" });
  });

  it("knows an account that is gone", () => {
    page("https://x.com/gone", `<div data-testid="emptyState">This account doesn’t exist</div>`);
    expect(run<ProfileStatsSnapshot>(profileStatsScript("gone"))).toMatchObject({ rendered: false, unavailable: true });
  });
});
