// A stand-in x.com for engine tests. The engine labels every evaluate, so the
// fake answers by label instead of parsing the scripts; the scripts themselves
// are tested against real documents in scripts.test.ts.

import type { MonitorBrowser } from "../browser.js";
import type { FeedSnapshot, FollowingTabState, PageHealth, ProfileStatsSnapshot, RawPost } from "../scripts.js";

export interface FakeProfile {
  followers?: number | null;
  following?: number | null;
  exact?: boolean;
  followersText?: string;
  unavailable?: boolean;
}

export class FakeX implements MonitorBrowser {
  url = "about:blank";
  signedIn = true;
  handle = "me";
  /** Whether the home page draws at all. */
  homeRenders = true;
  tabSelected = true;
  tabExists = true;
  /** The feed, newest first; `pageSize` entries are visible per scroll. */
  feed: RawPost[] = [];
  pageSize = 5;
  scrolled = 0;
  profiles: Record<string, FakeProfile> = {};
  readonly opened: string[] = [];
  readonly labels: string[] = [];
  readonly clicks: [number, number][] = [];
  clickAt?: (x: number, y: number) => Promise<void> = async (x, y) => {
    this.clicks.push([x, y]);
    this.tabSelected = true;
  };

  async open(url: string): Promise<void> {
    this.url = url;
    this.opened.push(url);
    this.scrolled = 0;
  }

  async reopen(url: string): Promise<void> {
    await this.open(url);
  }

  async waitForLoad(): Promise<void> {}

  async evaluate<T>(_script: string, label = ""): Promise<T> {
    this.labels.push(label);
    return this.answer(label) as T;
  }

  private onProfile(): string | undefined {
    const match = /^https:\/\/x\.com\/([A-Za-z0-9_]+)$/.exec(this.url);
    return match && match[1] !== "home" ? match[1] : undefined;
  }

  private answer(label: string): unknown {
    const wall = !this.signedIn;
    switch (label) {
      case "exists":
        return { found: true };
      case "health": {
        const rendered = this.url === "https://x.com/home" ? this.homeRenders : true;
        return { url: this.url, rendered: rendered && !wall, error_screen: false, login_wall: wall } satisfies PageHealth;
      }
      case "identity":
        return { url: this.url, login_wall: wall, identity: { session: !wall, handle: wall ? "" : this.handle } };
      case "following-tab":
        return {
          url: this.url, login_wall: wall, found: this.tabExists, selected: this.tabExists && this.tabSelected,
          matched: this.tabExists ? "label" : "", labels: this.tabExists ? ["For you", "Following"] : [],
          x: 300, y: 80, visible: true, clicked: false,
        } satisfies FollowingTabState;
      case "following-tab-click":
        this.tabSelected = true;
        return { found: true, clicked: true };
      case "feed": {
        const visible = this.feed.slice(0, this.pageSize * (this.scrolled + 1));
        return { url: this.url, login_wall: wall, empty: this.feed.length === 0, posts: visible } satisfies FeedSnapshot;
      }
      case "scroll": {
        const before = this.scrolled * 600;
        if (this.pageSize * (this.scrolled + 1) < this.feed.length) this.scrolled += 1;
        return { before, after: this.scrolled * 600, height: 10_000 };
      }
      case "profile-stats": {
        const handle = this.onProfile() ?? "";
        const profile = this.profiles[handle.toLowerCase()];
        const snapshot: ProfileStatsSnapshot = {
          url: this.url, login_wall: wall, rendered: !!profile && !profile.unavailable, unavailable: !!profile?.unavailable,
          handle: profile ? handle : "", followers: profile?.followers ?? null, following: profile?.following ?? null, posts: null,
          exact: profile?.exact ?? profile?.followers != null, source: profile?.followers != null ? "router" : "",
          followers_text: profile?.followersText ?? "", following_text: "",
        };
        return snapshot;
      }
      default:
        throw new Error(`the fake has no answer for "${label}"`);
    }
  }
}

let serial = 0;

/** rawPost builds a feed entry. Ids are snowflakes from the given minute
 *  offset, so they carry a time the engine can check against its floor. */
export function rawPost(author: string, minute: number, patch: Partial<RawPost> = {}): RawPost {
  const ms = BigInt(Date.UTC(2026, 8, 25, 12, 0, 0) + minute * 60_000) - 1288834974657n;
  const id = String((ms << 22n) + BigInt(serial++ % 4096));
  return {
    id, url: `https://x.com/${author}/status/${id}`, author, text: `${author} at ${minute}`, created_at: "",
    social_context: "", reposted_by: "", reply_context: "", repost: false, reply: false, promoted: false,
    photos: 0, video: false, card: false, quoted_url: "", ...patch,
  };
}

/** NOON is the time rawPost's minute 0 stands for. */
export const NOON = Date.UTC(2026, 8, 25, 12, 0, 0);
