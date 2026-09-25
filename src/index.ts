// @nextbrowser-oss/x-monitoring — the browser-agnostic core.
//
// Nothing exported from here touches Node: the NextBrowser app runs it in the
// renderer with its own nextctl-backed browser. The Node adapter (nbc CLI,
// state file, command line) is "@nextbrowser-oss/x-monitoring/node".

export type { MonitorBrowser } from "./browser.js";
export { checkAccount, runPass, HOME_URL, type AccountCheck, type PassDeps, type PassResult, type PassSummary } from "./engine.js";
export type {
  AccountChangedEvent,
  FollowersChangedEvent,
  MonitorEvent,
  NewPostEvent,
  SignedInEvent,
  SignedOutEvent,
} from "./events.js";
export {
  defaultSettings,
  emptyState,
  followerTargets,
  followersDue,
  normalizeHandle,
  normalizeSettings,
  normalizeState,
  withSettings,
  type AccountState,
  type FeedState,
  type FollowerSample,
  type FollowerStats,
  type MonitorSettings,
  type MonitorState,
  type PassRecord,
} from "./state.js";
export { findFresh, normalizeFeed, type FeedPost } from "./posts.js";
export { parseCount, type ParsedCount } from "./counts.js";
export { compareIds, snowflakeTime } from "./ids.js";
export type { LogEntry, LogSink } from "./log.js";
export { scheduleDelay } from "./schedule.js";
