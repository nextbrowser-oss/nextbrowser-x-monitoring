// One monitoring pass: who is signed in, what is new in the Following feed,
// and whether any tracked follower count moved.
//
// The pass is a state machine over an explicit MonitorState, like the app's X
// reply engine: it takes the state in, returns the next state and the events
// out, and never mutates what it was given. The caller persists the state and
// schedules the next pass; the pass itself never sleeps longer than a scroll.
//
// Everything is read, nothing is clicked but the feed's own "Following" tab:
// no follow, no like, no bell. What the account does in public stays the
// account owner's business.

import type { MonitorBrowser } from "./browser.js";
import { parseCount } from "./counts.js";
import type { MonitorEvent } from "./events.js";
import { maxId } from "./ids.js";
import { errorText, makeLogger, type LogSink, type Logger } from "./log.js";
import { defaultSleep, loadPage, READY_WAIT_MS, unrendered, waitForElement, type LoadedPage, type Sleep } from "./page.js";
import { countKnown, findFresh, newestOriginalId, normalizeFeed, type FeedPost, type FreshnessRules } from "./posts.js";
import {
  FEED_READY_SELECTOR,
  HOME_READY_SELECTOR,
  IDENTITY_ANCHOR_SELECTOR,
  PROFILE_READY_SELECTOR,
  feedScript,
  followingTabScript,
  identityScript,
  profileStatsScript,
  scrollScript,
  type FeedSnapshot,
  type FollowingTabState,
  type IdentitySnapshot,
  type ProfileStatsSnapshot,
  type ScrollState,
} from "./scripts.js";
import {
  MAX_HISTORY,
  MAX_PASS_NOTES,
  MAX_SEEN,
  followerTargets,
  followersDue,
  normalizeState,
  type FollowerStats,
  type MonitorState,
} from "./state.js";

export const HOME_URL = "https://x.com/home";
const BLANK_PAGE = "about:blank";
/** How long the account chrome may take to name the account after the home
 *  page drew. */
const IDENTITY_WAIT_MS = 12_000;
/** How long the Following tab may take to become the selected one. */
const TAB_SWITCH_WAIT_MS = 8_000;
/** How many already-known posts a read must pass before it is sure it is back
 *  in ground the last pass covered. One is not enough: x.com draws the post a
 *  reply answers above the reply, and that post is often old. */
const KNOWN_TO_STOP = 3;
/** How many scrolls in a row may bring nothing before the feed is taken to
 *  have ended. */
const MAX_STALLS = 3;

export interface PassDeps {
  browser: MonitorBrowser;
  state: MonitorState;
  now?: () => number;
  sleep?: Sleep;
  /** A source of numbers in [0, 1), for the pauses a person would take. */
  random?: () => number;
  log?: LogSink;
  /** Called for every event as it happens, before the pass returns. */
  onEvent?: (event: MonitorEvent) => void;
  /** Called with what the pass is doing, for a status line. */
  onStep?: (step: string) => void;
  /** Checked between steps, so Stop ends the pass instead of waiting it out. */
  shouldStop?: () => boolean;
}

export interface PassSummary {
  signedIn: boolean;
  handle?: string;
  /** The profile needs someone to sign it in to x.com. */
  loginRequired: boolean;
  /** Whether the Following feed was read this pass. */
  feedRead: boolean;
  /** The feed was read for the first time: what is on it now is the starting
   *  line, and nothing on it is announced. */
  baseline: boolean;
  entriesRead: number;
  scrolls: number;
  newPosts: number;
  /** The read did not get back to where the last pass stopped. */
  gap: boolean;
  followerChecks: number;
  followerChanges: number;
  stopped: boolean;
  /** Why the pass could do nothing, when that is not a missing sign-in. */
  blocked?: string;
  notes: string[];
}

export interface PassResult {
  state: MonitorState;
  events: MonitorEvent[];
  summary: PassSummary;
  /** Everything this pass read from the Following feed, in feed order, new or
   *  not. The events say what changed; this is what the feed looks like now,
   *  which is what a dashboard shows — including after the first pass, which
   *  announces nothing. Ads and the account's own posts are left out. */
  posts: FeedPost[];
}

class StopRequested extends Error {}
class SignedOut extends Error {}

/** runPass runs one monitoring pass. It does not throw for anything x.com or
 *  the browser does; failures end up in the summary's notes and the log. */
export async function runPass(deps: PassDeps): Promise<PassResult> {
  return new Pass(deps).run();
}

class Pass {
  private readonly browser: MonitorBrowser;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private readonly random: () => number;
  private readonly log: Logger;
  private readonly deps: PassDeps;
  private readonly at: number;
  private state: MonitorState;
  private readonly events: MonitorEvent[] = [];
  private posts: FeedPost[] = [];
  private readonly summary: PassSummary = {
    signedIn: false,
    loginRequired: false,
    feedRead: false,
    baseline: false,
    entriesRead: 0,
    scrolls: 0,
    newPosts: 0,
    gap: false,
    followerChecks: 0,
    followerChanges: 0,
    stopped: false,
    notes: [],
  };

  constructor(deps: PassDeps) {
    this.deps = deps;
    this.browser = deps.browser;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
    this.log = makeLogger(deps.log, this.now);
    this.at = this.now();
    this.state = normalizeState(deps.state);
  }

  async run(): Promise<PassResult> {
    this.log("pass_start", { settings: this.state.settings, account: this.state.account?.handle });
    try {
      const signedIn = await this.readAccount();
      if (signedIn) {
        if (this.state.settings.watchPosts) await this.readFeed();
        await this.readFollowers();
      }
    } catch (error) {
      if (error instanceof StopRequested) {
        this.summary.stopped = true;
      } else if (error instanceof SignedOut) {
        this.signOut();
      } else {
        this.note(`The pass failed: ${errorText(error)}`);
        this.log("pass_error", { error: errorText(error) });
      }
    } finally {
      await this.park();
    }
    this.state = {
      ...this.state,
      lastPass: {
        at: this.at,
        finishedAt: this.now(),
        newPosts: this.summary.newPosts,
        followerChanges: this.summary.followerChanges,
        notes: this.summary.notes,
      },
    };
    this.log("pass_end", { ...this.summary });
    return { state: this.state, events: this.events, summary: this.summary, posts: this.posts };
  }

  // --- account -------------------------------------------------------------

  /** readAccount lands on the home page and reads who is signed in. Everything
   *  else depends on it: a signed-out profile reads an empty feed that looks
   *  exactly like one where nobody posted. */
  private async readAccount(): Promise<boolean> {
    this.step("Opening x.com");
    const home = await this.load(HOME_URL, HOME_READY_SELECTOR);
    if (home.login_wall) throw new SignedOut();
    if (!home.rendered || home.error_screen) {
      this.summary.blocked = unrendered(home, "the home page");
      this.note(this.summary.blocked);
      return false;
    }
    this.checkStop();
    await waitForElement(this.browser, IDENTITY_ANCHOR_SELECTOR, IDENTITY_WAIT_MS, this.sleep, this.now);
    const snapshot = await this.browser.evaluate<IdentitySnapshot>(identityScript(), "identity");
    this.log("identity", { url: snapshot.url, login_wall: snapshot.login_wall, identity: snapshot.identity, diag: snapshot.diag });
    if (snapshot.login_wall || !snapshot.identity?.session) throw new SignedOut();

    const previous = this.state.account;
    // A session x.com did not name is still the account it was a moment ago.
    const handle = snapshot.identity.handle || previous?.handle;
    if (!handle) this.note("Signed in, but x.com did not say as whom; the account's own followers are skipped.");
    if (!previous?.signedIn) this.emit({ type: "signed_in", at: this.at, ...(handle ? { handle } : {}) });
    if (previous?.handle && snapshot.identity.handle && previous.handle.toLowerCase() !== snapshot.identity.handle.toLowerCase()) {
      this.emit({ type: "account_changed", at: this.at, previous: previous.handle, current: snapshot.identity.handle });
    }
    this.state = { ...this.state, account: { ...(handle ? { handle } : {}), signedIn: true, checkedAt: this.at } };
    this.summary.signedIn = true;
    if (handle) this.summary.handle = handle;
    return true;
  }

  private signOut(): void {
    const previous = this.state.account;
    if (previous?.signedIn !== false) {
      this.emit({ type: "signed_out", at: this.at, ...(previous?.handle ? { handle: previous.handle } : {}) });
    }
    this.state = {
      ...this.state,
      account: { ...(previous?.handle ? { handle: previous.handle } : {}), signedIn: false, checkedAt: this.at },
    };
    this.summary.signedIn = false;
    this.summary.loginRequired = true;
    this.note("The profile is not signed in to x.com. Sign it in, and monitoring picks up on the next pass.");
  }

  // --- feed ----------------------------------------------------------------

  /** readFeed switches the home page to the Following feed and reads it down
   *  to where the last pass stopped. */
  private async readFeed(): Promise<void> {
    this.step("Reading the Following feed");
    if (!(await this.selectFollowingTab())) return;
    this.checkStop();
    await waitForElement(this.browser, FEED_READY_SELECTOR, READY_WAIT_MS, this.sleep, this.now);

    const account = this.state.account?.handle;
    const settings = this.state.settings;
    // Another account follows other people: its feed is not a continuation.
    const sameOwner = !!this.state.feed.since && (this.state.feed.owner ?? "").toLowerCase() === (account ?? "").toLowerCase();
    const feed = sameOwner ? this.state.feed : { seen: [] };
    const baseline = !sameOwner;
    const since = feed.since ?? this.at;
    const floor = settings.maxPostAgeMs > 0 ? Math.max(since, this.at - settings.maxPostAgeMs) : since;
    const rules: FreshnessRules = {
      seen: new Set(feed.seen),
      ...(feed.lastPostId ? { lastPostId: feed.lastPostId } : {}),
      floor,
      includeReposts: settings.includeReposts,
      includeReplies: settings.includeReplies,
      ...(account ? { self: account } : {}),
    };

    const { posts, empty, scrolls } = await this.collect(rules, baseline);
    this.summary.feedRead = true;
    this.summary.entriesRead = posts.length;
    this.summary.scrolls = scrolls;
    const self = account?.toLowerCase();
    this.posts = posts.filter((post) => !self || (post.repost ? post.repostedBy?.toLowerCase() !== self : post.author.toLowerCase() !== self));
    if (posts.length === 0) {
      this.note(empty ? "The Following feed is empty: the account follows nobody who has posted." : "The Following feed showed no posts.");
      this.state = { ...this.state, feed: { ...feed, ...(account ? { owner: account } : {}), since, lastReadAt: this.at } };
      return;
    }

    const known = new Set(feed.seen);
    const seen = [...feed.seen, ...posts.map((post) => post.key).filter((key) => !known.has(key))].slice(-MAX_SEEN);
    const lastPostId = maxId(feed.lastPostId, newestOriginalId(posts));
    let lastNewAt = feed.lastNewAt;
    if (baseline) {
      this.summary.baseline = true;
      this.log("feed_baseline", { owner: account, entries: posts.length, last_post_id: lastPostId });
    } else {
      const { fresh, known: knownCount } = findFresh(posts, rules);
      if (knownCount === 0) {
        this.summary.gap = true;
        this.note(`The feed was not read back to where the last pass stopped (${posts.length} entries); posts in between may be missed.`);
      }
      for (const post of fresh) this.emit({ type: "new_post", at: this.at, ...(account ? { account } : {}), post });
      this.summary.newPosts = fresh.length;
      if (fresh.length > 0) lastNewAt = this.at;
      this.log("feed_read", { entries: posts.length, fresh: fresh.length, known: knownCount, scrolls });
    }
    this.state = {
      ...this.state,
      feed: {
        ...(account ? { owner: account } : {}),
        ...(lastPostId ? { lastPostId } : {}),
        seen,
        since,
        lastReadAt: this.at,
        ...(lastNewAt !== undefined ? { lastNewAt } : {}),
      },
    };
  }

  /** selectFollowingTab makes the chronological Following feed the one on
   *  screen. x.com remembers the choice, so after the first pass this is
   *  usually a single read. */
  private async selectFollowingTab(): Promise<boolean> {
    let tab = await this.browser.evaluate<FollowingTabState>(followingTabScript(false), "following-tab");
    if (tab.login_wall) throw new SignedOut();
    if (!tab.found) {
      this.note(`The Following tab was not found on the home page${tab.labels.length ? ` (tabs: ${tab.labels.join(", ")})` : ""}.`);
      this.log("following_tab_missing", { ...tab });
      return false;
    }
    if (tab.selected) return true;
    if (this.browser.clickAt && tab.visible) {
      await this.browser.clickAt(tab.x, tab.y);
    } else {
      await this.browser.evaluate<FollowingTabState>(followingTabScript(true), "following-tab-click");
    }
    const deadline = this.now() + TAB_SWITCH_WAIT_MS;
    while (this.now() < deadline) {
      await this.sleep(400);
      tab = await this.browser.evaluate<FollowingTabState>(followingTabScript(false), "following-tab");
      if (tab.selected) {
        this.log("following_tab_selected", { matched: tab.matched });
        return true;
      }
    }
    this.note("Could not switch the home page to the Following feed.");
    this.log("following_tab_stuck", { ...tab });
    return false;
  }

  /** collect reads the feed top down, scrolling until the read is back in
   *  ground the last pass covered, the limit is reached, or the feed ends. A
   *  first read takes what is on screen and does not scroll: it announces
   *  nothing, so there is nothing to look for further down. */
  private async collect(rules: FreshnessRules, baseline: boolean): Promise<{ posts: FeedPost[]; empty: boolean; scrolls: number }> {
    const limit = this.state.settings.feedLimit;
    const posts: FeedPost[] = [];
    const keys = new Set<string>();
    let scrolls = 0;
    let stalls = 0;
    let empty = false;
    for (;;) {
      const snapshot = await this.browser.evaluate<FeedSnapshot>(feedScript(limit), "feed");
      if (snapshot.login_wall) throw new SignedOut();
      empty = snapshot.empty;
      const before = posts.length;
      for (const post of normalizeFeed(snapshot.posts ?? [])) {
        if (keys.has(post.key)) continue;
        keys.add(post.key);
        posts.push(post);
      }
      if (posts.length === 0 && snapshot.diag) this.log("feed_empty_read", { url: snapshot.url, empty, diag: snapshot.diag });
      if (baseline || posts.length >= limit) break;
      if (countKnown(posts, rules) >= KNOWN_TO_STOP) break;
      if (scrolls >= this.state.settings.maxScrolls) break;
      this.checkStop();
      const scroll = await this.browser.evaluate<ScrollState>(scrollScript(), "scroll");
      scrolls += 1;
      await this.sleep(this.pause(600, 1400));
      if (posts.length === before && scroll.after <= scroll.before) {
        stalls += 1;
        if (stalls >= MAX_STALLS) break;
      } else {
        stalls = 0;
      }
    }
    return { posts: posts.slice(0, limit), empty, scrolls };
  }

  // --- followers -----------------------------------------------------------

  /** readFollowers reads the counts of every tracked account that is due. */
  private async readFollowers(): Promise<void> {
    const due = followerTargets(this.state).filter((target) => followersDue(this.state, target.handle, this.at));
    for (const [index, target] of due.entries()) {
      this.checkStop();
      // A person does not open ten profiles in the same second.
      if (index > 0 || this.summary.feedRead) await this.sleep(this.pause(1500, 4000));
      this.step(`Reading @${target.handle}'s followers`);
      await this.readProfile(target.handle, target.own);
    }
  }

  private async readProfile(handle: string, own: boolean): Promise<void> {
    const key = handle.toLowerCase();
    const previous: FollowerStats = this.state.followers[key] ?? { handle, history: [] };
    const page = await this.load(`https://x.com/${handle}`, PROFILE_READY_SELECTOR);
    if (page.login_wall) throw new SignedOut();
    const stats = await this.browser.evaluate<ProfileStatsSnapshot>(profileStatsScript(handle), "profile-stats");
    if (stats.login_wall) throw new SignedOut();
    this.summary.followerChecks += 1;
    this.log("profile_stats", {
      handle,
      source: stats.source,
      exact: stats.exact,
      followers: stats.followers,
      following: stats.following,
      followers_text: stats.followers_text,
      unavailable: stats.unavailable,
      ...(stats.diag ? { diag: stats.diag } : {}),
    });

    const followers = stats.followers ?? parseCount(stats.followers_text)?.value;
    const exact = stats.followers !== null ? stats.exact : false;
    const following = stats.following ?? parseCount(stats.following_text)?.value;
    if (followers === undefined) {
      const why = stats.unavailable
        ? `@${handle} is unavailable (suspended, deactivated, or never existed).`
        : !page.rendered || page.error_screen
          ? unrendered(page, `@${handle}'s profile`)
          : `@${handle}'s profile showed no follower count.`;
      this.note(why);
      this.setFollowers(key, { ...previous, handle, attemptedAt: this.at, note: why });
      return;
    }

    const next: FollowerStats = {
      handle: stats.handle || previous.handle || handle,
      followers,
      ...(following !== undefined ? { following } : {}),
      ...(stats.posts !== null ? { posts: stats.posts } : {}),
      exact,
      ...(stats.followers_text ? { label: stats.followers_text.replace(/\s+/g, " ") } : {}),
      checkedAt: this.at,
      attemptedAt: this.at,
      ...(previous.changedAt !== undefined ? { changedAt: previous.changedAt } : {}),
      history: previous.history,
    };
    const before = previous.followers;
    if (before === undefined) {
      next.history = [...previous.history, { at: this.at, followers, exact }].slice(-MAX_HISTORY);
    } else if (before !== followers) {
      if (previous.exact !== undefined && previous.exact !== exact) {
        // An exact figure against a rounded one differs by the rounding alone.
        // The new figure becomes the reference; nothing moved that anyone saw.
        this.log("followers_rebased", { handle, previous: before, current: followers, exact });
      } else {
        this.emit({
          type: "followers_changed",
          at: this.at,
          handle: next.handle,
          own,
          previous: before,
          current: followers,
          delta: followers - before,
          exact,
          ...(following !== undefined ? { following } : {}),
          ...(next.label ? { label: next.label } : {}),
        });
        this.summary.followerChanges += 1;
        next.changedAt = this.at;
      }
      next.history = [...previous.history, { at: this.at, followers, exact }].slice(-MAX_HISTORY);
    }
    this.setFollowers(key, next);
  }

  private setFollowers(key: string, stats: FollowerStats): void {
    this.state = { ...this.state, followers: { ...this.state.followers, [key]: stats } };
  }

  // --- plumbing ------------------------------------------------------------

  private async load(url: string, readySelector: string): Promise<LoadedPage> {
    return loadPage(this.browser, url, readySelector, { sleep: this.sleep, log: this.log, now: this.now });
  }

  /** park leaves the tab on a blank page. It is best effort: a tab that would
   *  not park still holds a page nobody reads, and saying so is all that is
   *  owed to the pass that just finished. */
  private async park(): Promise<void> {
    if (!this.state.settings.parkTab) return;
    try {
      await this.browser.open(BLANK_PAGE);
    } catch (error) {
      this.log("park_failed", { error: errorText(error) });
    }
  }

  private pause(min: number, max: number): number {
    return Math.round(min + (max - min) * this.random());
  }

  private emit(event: MonitorEvent): void {
    this.events.push(event);
    this.log("event", { event });
    try {
      this.deps.onEvent?.(event);
    } catch (error) {
      this.log("on_event_failed", { error: errorText(error) });
    }
  }

  private step(step: string): void {
    this.log("step", { step });
    try {
      this.deps.onStep?.(step);
    } catch {
      /* a status line is not worth a pass */
    }
  }

  private note(note: string): void {
    this.summary.notes = [...this.summary.notes, note].slice(-MAX_PASS_NOTES);
  }

  private checkStop(): void {
    if (this.deps.shouldStop?.()) throw new StopRequested("stopped");
  }
}
