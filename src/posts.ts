// The post model and the rules for what in a feed is new. Everything here is
// pure: given what a page reported and what was seen before, decide what to
// announce.

import { compareIds, snowflakeTime } from "./ids.js";
import type { RawPost } from "./scripts.js";

export interface FeedPost {
  /** What identifies this entry in the feed: the post id, or id@reposter for a
   *  repost, since one post reposted by two accounts is two entries. */
  key: string;
  id: string;
  url: string;
  author: string;
  text: string;
  /** Milliseconds since the epoch: the page's <time> when there is one, and
   *  the time the id itself carries otherwise. */
  createdAt?: number;
  repost: boolean;
  /** The followed account that reposted it, for a repost. */
  repostedBy?: string;
  reply: boolean;
  quotedUrl?: string;
  photos: number;
  video: boolean;
  card: boolean;
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const ID = /^\d{1,20}$/;

export function postKey(id: string, repostedBy?: string): string {
  return repostedBy ? `${id}@${repostedBy.toLowerCase()}` : id;
}

/** normalizeFeed turns what the page reported into posts, in feed order.
 *  Advertisements are dropped: nobody followed them. A post with no text of its
 *  own is kept — a photo is a post too. */
export function normalizeFeed(raw: RawPost[]): FeedPost[] {
  const posts: FeedPost[] = [];
  const keys = new Set<string>();
  for (const item of raw ?? []) {
    if (!item || item.promoted) continue;
    const id = String(item.id ?? "").trim();
    const author = String(item.author ?? "").trim();
    if (!ID.test(id) || !HANDLE.test(author)) continue;
    const repostedBy = HANDLE.test(String(item.reposted_by ?? "")) ? String(item.reposted_by) : undefined;
    const key = postKey(id, repostedBy);
    if (keys.has(key)) continue;
    keys.add(key);
    const stamped = Date.parse(String(item.created_at ?? ""));
    posts.push({
      key,
      id,
      url: `https://x.com/${author}/status/${id}`,
      author,
      text: String(item.text ?? "").trim(),
      createdAt: Number.isFinite(stamped) ? stamped : snowflakeTime(id),
      repost: !!repostedBy || !!item.repost,
      ...(repostedBy ? { repostedBy } : {}),
      reply: !!item.reply,
      ...(item.quoted_url ? { quotedUrl: String(item.quoted_url) } : {}),
      photos: Math.max(0, Number(item.photos) || 0),
      video: !!item.video,
      card: !!item.card,
    });
  }
  return posts;
}

export interface FreshnessRules {
  /** Keys already announced or already on screen when watching began. */
  seen: ReadonlySet<string>;
  /** The newest original post id seen so far. */
  lastPostId?: string;
  /** Posts created before this are history, not news. */
  floor?: number;
  includeReposts: boolean;
  includeReplies: boolean;
  /** The monitored account itself: its own posts are not news to it. */
  self?: string;
}

export interface Freshness {
  /** New entries, oldest first. */
  fresh: FeedPost[];
  /** How many original posts in the read were already known: seen before, or
   *  not newer than the watermark. None means the read never got back to what
   *  the last pass saw, and entries between the two may be out of reach. */
  known: number;
}

/** isKnown says whether an original post was there before this pass. */
function isKnown(post: FeedPost, rules: FreshnessRules): boolean {
  return rules.seen.has(post.key) || (!!rules.lastPostId && compareIds(post.id, rules.lastPostId) <= 0);
}

/** countKnown is how many original posts of a read were already known, which
 *  is what tells a read that has scrolled back into old ground. */
export function countKnown(posts: FeedPost[], rules: FreshnessRules): number {
  return posts.filter((post) => !post.repost && isKnown(post, rules)).length;
}

/** findFresh picks the new entries of a feed read newest first.
 *
 *  An original post is new when it is newer than the watermark and was not
 *  seen. Old posts do not end the scan: x.com draws a reply under the post it
 *  answers, so an old post in the middle of the feed can sit on top of a new
 *  one.
 *
 *  A repost carries the original's id, which says nothing about when it was
 *  reposted, so a repost is new only above the first original post that was
 *  already seen: below that line the feed is what the last pass read. */
export function findFresh(posts: FeedPost[], rules: FreshnessRules): Freshness {
  const self = rules.self?.toLowerCase();
  let repostLine = posts.findIndex((post) => !post.repost && rules.seen.has(post.key));
  if (repostLine < 0) repostLine = posts.length;
  const fresh = posts.filter((post, index) => {
    if (rules.seen.has(post.key)) return false;
    if (post.repost) {
      if (!rules.includeReposts || index >= repostLine) return false;
      return !(self && post.repostedBy?.toLowerCase() === self);
    }
    if (rules.lastPostId && compareIds(post.id, rules.lastPostId) <= 0) return false;
    if (post.reply && !rules.includeReplies) return false;
    if (self && post.author.toLowerCase() === self) return false;
    if (rules.floor !== undefined && post.createdAt !== undefined && post.createdAt < rules.floor) return false;
    return true;
  });
  return { fresh: fresh.reverse(), known: countKnown(posts, rules) };
}

/** newestOriginalId is the watermark a read leaves behind. */
export function newestOriginalId(posts: FeedPost[]): string | undefined {
  let newest: string | undefined;
  for (const post of posts) {
    if (post.repost) continue;
    if (!newest || compareIds(post.id, newest) > 0) newest = post.id;
  }
  return newest;
}
