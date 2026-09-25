// Monitor state and settings: one JSON document the caller owns and persists.
//
// A pass takes the state in and hands the next one back without mutating what
// it was given, as the app's X reply engine does, so a pass cut short leaves
// the last saved state intact and everything a finished pass learned is in
// what it returned.

export interface MonitorSettings {
  /** Watch the Following feed for new posts. */
  watchPosts: boolean;
  /** Announce reposts made by the followed accounts. */
  includeReposts: boolean;
  /** Announce replies the followed accounts post. */
  includeReplies: boolean;
  /** How many feed entries one pass may read at most. */
  feedLimit: number;
  /** How many times one pass may scroll the feed looking for where the last
   *  one stopped. Every scroll is more of the feed over the proxy. */
  maxScrolls: number;
  /** How old a post may be and still be announced. A monitor that was away —
   *  a laptop asleep, a spent proxy — comes back to a feed it never saw, and
   *  announcing a day of it at once is noise, not news. */
  maxPostAgeMs: number;
  /** Track the signed-in account's own followers. */
  trackOwnFollowers: boolean;
  /** Other accounts whose follower counts are tracked. Each one is a profile
   *  page load, so this is a short list, not everyone the account follows. */
  followerHandles: string[];
  /** How often one account's counts are read. 0 reads them on every pass,
   *  for a host whose own schedule already sets how often that is. */
  followersIntervalMs: number;
  /** Leave the tab on about:blank after a pass. A feed left on screen keeps
   *  autoplaying video and polling x.com, which the Go service found cost more
   *  proxy traffic than the reads themselves. */
  parkTab: boolean;
}

export interface AccountState {
  handle?: string;
  signedIn: boolean;
  checkedAt: number;
}

export interface FeedState {
  /** The account the feed belongs to. Another account follows other people,
   *  so a change of account starts the feed over. */
  owner?: string;
  /** Newest original post id read from the feed. */
  lastPostId?: string;
  /** Keys of the entries already seen, newest last, bounded. */
  seen: string[];
  /** When the feed was first read: nothing before it is announced. */
  since?: number;
  lastReadAt?: number;
  lastNewAt?: number;
}

export interface FollowerSample {
  at: number;
  followers: number;
  exact: boolean;
}

export interface FollowerStats {
  handle: string;
  followers?: number;
  following?: number;
  posts?: number;
  /** Whether the figures are exact or x.com's rounded ones. */
  exact?: boolean;
  /** The label as drawn, e.g. "92.3M Followers". */
  label?: string;
  /** When a figure was last read. */
  checkedAt?: number;
  /** When a read was last tried, whether or not it got a figure. */
  attemptedAt?: number;
  changedAt?: number;
  /** Every change, oldest first, bounded. */
  history: FollowerSample[];
  /** Why the last read came back without a figure. */
  note?: string;
}

export interface PassRecord {
  at: number;
  finishedAt: number;
  newPosts: number;
  followerChanges: number;
  notes: string[];
}

export interface MonitorState {
  version: 1;
  settings: MonitorSettings;
  account?: AccountState;
  feed: FeedState;
  /** Keyed by lowercased handle. */
  followers: Record<string, FollowerStats>;
  lastPass?: PassRecord;
}

export const DEFAULT_FEED_LIMIT = 60;
export const MAX_FEED_LIMIT = 300;
export const DEFAULT_MAX_SCROLLS = 6;
export const DEFAULT_MAX_POST_AGE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_FOLLOWERS_INTERVAL_MS = 30 * 60 * 1000;
/** Reading a profile more often than this is not monitoring, it is scraping. */
export const MIN_FOLLOWERS_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_FOLLOWER_HANDLES = 50;
/** How soon a read that got no figure is tried again, at most. */
export const FOLLOWERS_RETRY_MS = 10 * 60 * 1000;
export const MAX_SEEN = 2000;
export const MAX_HISTORY = 200;
export const MAX_PASS_NOTES = 5;

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

export function defaultSettings(): MonitorSettings {
  return {
    watchPosts: true,
    includeReposts: false,
    includeReplies: true,
    feedLimit: DEFAULT_FEED_LIMIT,
    maxScrolls: DEFAULT_MAX_SCROLLS,
    maxPostAgeMs: DEFAULT_MAX_POST_AGE_MS,
    trackOwnFollowers: true,
    followerHandles: [],
    followersIntervalMs: DEFAULT_FOLLOWERS_INTERVAL_MS,
    parkTab: true,
  };
}

export function emptyState(settings: Partial<MonitorSettings> = {}): MonitorState {
  return { version: 1, settings: normalizeSettings(settings), feed: { seen: [] }, followers: {} };
}

/** normalizeHandle strips an @ and whitespace, and returns "" for anything
 *  that cannot be an X handle. */
export function normalizeHandle(value: unknown): string {
  const handle = String(value ?? "").trim().replace(/^@+/, "");
  return HANDLE.test(handle) ? handle : "";
}

function integer(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeSettings(raw: unknown): MonitorSettings {
  const base = defaultSettings();
  const record = raw && typeof raw === "object" ? (raw as Partial<MonitorSettings>) : {};
  const handles: string[] = [];
  for (const value of Array.isArray(record.followerHandles) ? record.followerHandles : []) {
    const handle = normalizeHandle(value);
    if (handle && !handles.some((known) => known.toLowerCase() === handle.toLowerCase())) handles.push(handle);
  }
  return {
    watchPosts: flag(record.watchPosts, base.watchPosts),
    includeReposts: flag(record.includeReposts, base.includeReposts),
    includeReplies: flag(record.includeReplies, base.includeReplies),
    feedLimit: integer(record.feedLimit, base.feedLimit, 1, MAX_FEED_LIMIT),
    maxScrolls: integer(record.maxScrolls, base.maxScrolls, 0, 50),
    maxPostAgeMs: integer(record.maxPostAgeMs, base.maxPostAgeMs, 0),
    trackOwnFollowers: flag(record.trackOwnFollowers, base.trackOwnFollowers),
    followerHandles: handles.slice(0, MAX_FOLLOWER_HANDLES),
    followersIntervalMs: record.followersIntervalMs === 0
      ? 0
      : integer(record.followersIntervalMs, base.followersIntervalMs, MIN_FOLLOWERS_INTERVAL_MS),
    parkTab: flag(record.parkTab, base.parkTab),
  };
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** normalizeState accepts whatever was on disk, including a file from an
 *  older version or a hand edit, and returns something a pass can run on. */
export function normalizeState(raw: unknown): MonitorState {
  const record = raw && typeof raw === "object" ? (raw as Partial<MonitorState>) : {};
  const state = emptyState(record.settings ?? {});

  const account = record.account;
  if (account && typeof account === "object") {
    state.account = {
      ...(normalizeHandle(account.handle) ? { handle: normalizeHandle(account.handle) } : {}),
      signedIn: account.signedIn === true,
      checkedAt: finite(account.checkedAt) ?? 0,
    };
  }

  const feed = record.feed;
  if (feed && typeof feed === "object") {
    const seen = Array.isArray(feed.seen) ? feed.seen.filter((key): key is string => typeof key === "string" && !!key) : [];
    state.feed = {
      ...(normalizeHandle(feed.owner) ? { owner: normalizeHandle(feed.owner) } : {}),
      ...(typeof feed.lastPostId === "string" && /^\d{1,20}$/.test(feed.lastPostId) ? { lastPostId: feed.lastPostId } : {}),
      seen: seen.slice(-MAX_SEEN),
      ...optional("since", finite(feed.since)),
      ...optional("lastReadAt", finite(feed.lastReadAt)),
      ...optional("lastNewAt", finite(feed.lastNewAt)),
    };
  }

  for (const [key, value] of Object.entries(record.followers ?? {})) {
    if (!value || typeof value !== "object") continue;
    const handle = normalizeHandle(value.handle ?? key);
    if (!handle) continue;
    const history = Array.isArray(value.history)
      ? value.history
        .filter((sample) => sample && finite(sample.at) !== undefined && finite(sample.followers) !== undefined)
        .map((sample) => ({ at: sample.at, followers: sample.followers, exact: sample.exact === true }))
      : [];
    state.followers[handle.toLowerCase()] = {
      handle,
      ...optional("followers", finite(value.followers)),
      ...optional("following", finite(value.following)),
      ...optional("posts", finite(value.posts)),
      ...(typeof value.exact === "boolean" ? { exact: value.exact } : {}),
      ...optional("label", text(value.label)),
      ...optional("checkedAt", finite(value.checkedAt)),
      ...optional("attemptedAt", finite(value.attemptedAt)),
      ...optional("changedAt", finite(value.changedAt)),
      history: history.slice(-MAX_HISTORY),
      ...optional("note", text(value.note)),
    };
  }

  const pass = record.lastPass;
  if (pass && typeof pass === "object" && finite(pass.at) !== undefined) {
    state.lastPass = {
      at: pass.at,
      finishedAt: finite(pass.finishedAt) ?? pass.at,
      newPosts: finite(pass.newPosts) ?? 0,
      followerChanges: finite(pass.followerChanges) ?? 0,
      notes: Array.isArray(pass.notes) ? pass.notes.filter((note): note is string => typeof note === "string").slice(-MAX_PASS_NOTES) : [],
    };
  }
  return state;
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

/** withSettings applies a settings patch, normalized. */
export function withSettings(state: MonitorState, patch: Partial<MonitorSettings>): MonitorState {
  return { ...state, settings: normalizeSettings({ ...state.settings, ...patch }) };
}

/** followerTargets lists the accounts whose counts a pass tracks: the signed-in
 *  account first, when it is tracked and known, then the configured ones. */
export function followerTargets(state: MonitorState): { handle: string; own: boolean }[] {
  const targets: { handle: string; own: boolean }[] = [];
  const own = state.account?.signedIn ? state.account.handle : undefined;
  if (state.settings.trackOwnFollowers && own) targets.push({ handle: own, own: true });
  for (const handle of state.settings.followerHandles) {
    if (targets.some((target) => target.handle.toLowerCase() === handle.toLowerCase())) continue;
    targets.push({ handle, own: false });
  }
  return targets;
}

/** followersDue says whether an account's counts are due for a read. A read
 *  that failed is retried sooner than the interval, but not on every pass: a
 *  profile that will not draw is not helped by being loaded every few minutes. */
export function followersDue(state: MonitorState, handle: string, at: number): boolean {
  const stats = state.followers[handle.toLowerCase()];
  const interval = state.settings.followersIntervalMs;
  if (stats?.checkedAt !== undefined && at - stats.checkedAt < interval) return false;
  if (stats?.attemptedAt !== undefined && at - stats.attemptedAt < Math.min(interval, FOLLOWERS_RETRY_MS)) return false;
  return true;
}
