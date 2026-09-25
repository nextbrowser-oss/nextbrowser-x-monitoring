// What a pass reports. Events are plain JSON, so a caller can store them, send
// them over IPC, or print them one per line.

import type { FeedPost } from "./posts.js";

/** A followed account posted, replied, or (when enabled) reposted. */
export interface NewPostEvent {
  type: "new_post";
  at: number;
  /** The monitored account whose Following feed carried the post. */
  account?: string;
  post: FeedPost;
}

/** An account's follower count moved. */
export interface FollowersChangedEvent {
  type: "followers_changed";
  at: number;
  handle: string;
  /** Whether this is the monitored account itself. */
  own: boolean;
  previous: number;
  current: number;
  delta: number;
  /** False when both figures are x.com's rounded ones ("12.3K"): the delta is
   *  then only as good as the rounding. */
  exact: boolean;
  following?: number;
  label?: string;
}

/** The profile is signed in to x.com, for the first time or again. */
export interface SignedInEvent {
  type: "signed_in";
  at: number;
  handle?: string;
}

/** The profile is signed out of x.com; nothing can be read until someone signs
 *  it in again. */
export interface SignedOutEvent {
  type: "signed_out";
  at: number;
  handle?: string;
}

/** A different account is signed in than before. Its feed starts over. */
export interface AccountChangedEvent {
  type: "account_changed";
  at: number;
  previous: string;
  current: string;
}

export type MonitorEvent =
  | NewPostEvent
  | FollowersChangedEvent
  | SignedInEvent
  | SignedOutEvent
  | AccountChangedEvent;
