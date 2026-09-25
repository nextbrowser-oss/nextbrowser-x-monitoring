# Events and state

## Events

Every event is a plain JSON object with a `type` field and an `at` field, the pass time in epoch milliseconds. A pass returns its events in `result.events`. With `onEvent`, it also hands over each event as soon as it happens.

### `new_post`

A followed account posted or replied. A repost is also a `new_post`, but only when `includeReposts` is on.

```json
{
  "type": "new_post",
  "at": 1790326800000,
  "account": "acme_labs",
  "post": {
    "key": "2103250000000000001",
    "id": "2103250000000000001",
    "url": "https://x.com/jane_builds/status/2103250000000000001",
    "author": "jane_builds",
    "text": "Shipped the new release: 40% faster cold starts.",
    "createdAt": 1790326500000,
    "repost": false,
    "reply": false,
    "photos": 1,
    "video": false,
    "card": false
  }
}
```

| Field | Meaning |
| --- | --- |
| `account` | The monitored account whose *Following* feed carried the post. |
| `post.key` | The post id. For a repost it is `id@reposter`, because one post reposted by two accounts appears as two entries. |
| `post.createdAt` | The page's `<time>` when it has one, otherwise the time encoded in the id. |
| `post.repostedBy` | For a repost, the followed account that reposted it. |
| `post.quotedUrl` | The post this one quotes, if any. |
| `post.text` | Emoji drawn as images are kept. Empty for a post that is only media. |

### `followers_changed`

The follower count of the monitored account or of a tracked handle moved.

```json
{ "type": "followers_changed", "at": 1790328600000, "handle": "acme_labs", "own": true,
  "previous": 12480, "current": 12517, "delta": 37, "exact": true, "following": 311 }
```

`exact: false` means both figures are x.com's rounded ones, such as "12.3K", so the delta is only as precise as that rounding. `label` holds the count as x.com drew it, when there was one.

### `signed_in`, `signed_out`, `account_changed`

```json
{ "type": "signed_in", "at": 1790326800000, "handle": "acme_labs" }
{ "type": "signed_out", "at": 1790330400000, "handle": "acme_labs" }
{ "type": "account_changed", "at": 1790334000000, "previous": "acme_labs", "current": "other_account" }
```

- **`signed_out`** is emitted once when the session ends. While the profile stays signed out, nothing else is read.
- **`signed_in`** is emitted on the first pass, and again after a sign-out.
- **`account_changed`** means the next feed read starts from scratch, as a new baseline.

## The feed as read

`result.posts` holds every entry the pass read from the *Following* feed, in feed order, whether it is new or not. Ads and the account's own posts are left out. The events say what changed. `posts` says what the feed shows right now, which is what a dashboard displays, including after the first pass, which announces nothing.

## The pass summary

`result.summary` describes one pass, for a status line or a panel:

| Field | Meaning |
| --- | --- |
| `signedIn`, `handle` | Who the pass found signed in. |
| `loginRequired` | The profile needs someone to sign it in to x.com. |
| `blocked` | Why the pass could do nothing, when the reason is not a sign-out, e.g. "x.com did not render the home page". |
| `feedRead`, `baseline` | Whether the feed was read. `baseline` means it was the first read, which announces nothing. |
| `entriesRead`, `scrolls`, `newPosts` | What the feed read covered. |
| `gap` | The read did not get back to where the last pass stopped. |
| `followerChecks`, `followerChanges` | Profiles read and counts that changed. |
| `stopped` | `shouldStop` ended the pass early. |
| `notes` | Up to five sentences a person can read. |

## The state document

```jsonc
{
  "version": 1,
  "settings": { /* see below */ },
  "account": { "handle": "acme_labs", "signedIn": true, "checkedAt": 1790326800000 },
  "feed": {
    "owner": "acme_labs",              // the account this feed belongs to
    "lastPostId": "2103250000000000001",
    "seen": ["2103249…", "2103250…"],  // last 2,000 entry keys
    "since": 1790326500000,            // nothing before this is announced
    "lastReadAt": 1790326800000,
    "lastNewAt": 1790326800000
  },
  "followers": {
    "acme_labs": {
      "handle": "acme_labs", "followers": 12517, "following": 311, "exact": true,
      "checkedAt": 1790328600000, "attemptedAt": 1790328600000, "changedAt": 1790328600000,
      "history": [{ "at": 1790326800000, "followers": 12480, "exact": true },
                  { "at": 1790328600000, "followers": 12517, "exact": true }]
    }
  },
  "lastPass": { "at": 1790328600000, "finishedAt": 1790328612000, "newPosts": 0, "followerChanges": 1, "notes": [] }
}
```

`followers[*].history` records every change, capped at the latest 200. It is enough to draw a chart without a separate store.

Pass anything read from storage through `normalizeState`. It accepts older versions, hand edits, and missing fields, and fills in defaults.

## Settings

Settings live in `state.settings`. `normalizeState` and `withSettings` clamp them to safe ranges.

| Setting | Default | Range and meaning |
| --- | --- | --- |
| `watchPosts` | `true` | Read the *Following* feed. |
| `includeReposts` | `false` | Announce reposts by followed accounts. |
| `includeReplies` | `true` | Announce their replies. |
| `feedLimit` | `60` | 1–300 feed entries per pass. |
| `maxScrolls` | `6` | 0–50 scrolls per pass. Each scroll loads more of the feed over the proxy. |
| `maxPostAgeMs` | 6 h | Older posts are not announced. `0` turns the limit off. |
| `trackOwnFollowers` | `true` | Track the signed-in account's own follower count. |
| `followerHandles` | `[]` | Up to 50 other handles. Each one costs a profile page load. |
| `followersIntervalMs` | 30 min | At least 5 min. A read that failed is retried after 10 min. |
| `parkTab` | `true` | Leave the tab on `about:blank` after a pass. |

For the time between passes, `scheduleDelay(intervalMs)` returns the interval with a ±20% random spread. It never returns less than one minute, and it triples the wait while the profile needs a sign-in.
