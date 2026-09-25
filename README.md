# nextbrowser-x-monitoring

Watches an X account through a NextBrowser profile that is signed in to x.com:

- **new posts** from the accounts it follows, read from the home page's
  chronological *Following* feed, one page load per pass;
- **follower-count changes**, for the signed-in account and for a short list
  of other handles, read from their profile pages.

It reads and never acts: no follows, likes or bells. The only thing it clicks
is the home page's own *Following* tab.

It is derived from
[nextbrowser-x-reply-agent](https://github.com/nextbrowser-oss/nextbrowser-x-reply-agent),
with the reply, LLM and publishing parts dropped, and it is shaped like the
app's TypeScript port of that agent (`nextbrowser-app/src/lib/xreply`) so it
can drop into the app as a dependency.

## Layout

| Entry | What | Runs in |
|---|---|---|
| `@nextbrowser-oss/x-monitoring` | the pass, state, events, page scripts | anywhere: the app's renderer, Node, a browser. No Node imports (a test enforces it) |
| `@nextbrowser-oss/x-monitoring/node` | a browser over the `nbc`/`nextctl` CLI, the state as a file, the CLI | Node ≥ 22 |
| `x-monitor` | the command line | Node ≥ 22 |

## Using it from the NextBrowser app

A pass is a function from state to state, like the app's X reply engine: the
app owns the timer, the storage and the browser.

```ts
import { normalizeState, runPass, scheduleDelay } from "@nextbrowser-oss/x-monitoring";
import { cliBrowser } from "./lib/xreply/browser"; // the app's own nextctl-backed browser

const state = normalizeState(await readAppData("x-monitor-state.json")); // anything, even nothing
const { state: next, events, summary } = await runPass({
  browser: cliBrowser(profileArgs),          // the profile the app prepared
  state,
  log: (entry) => appendAppData("x-monitor-log.jsonl", entry),
  onEvent: (event) => notify(event),         // as each one happens
  shouldStop: () => stopRequested,
});
await writeAppData("x-monitor-state.json", next);
setTimeout(nextPass, scheduleDelay(5 * 60_000, { loginRequired: summary.loginRequired }));
```

`MonitorBrowser` is a subset of the app's `XBrowser` (`open`, `evaluate(script,
label)`, `waitForLoad`, `reopen`, optional `clickAt`), so `cliBrowser` fits as is.
The monitor waits for elements by polling `evaluate` itself, not through
`nbc wait --selector`, which only matches inside the viewport.

The package is private, and the app repository is public. So the app's CI
cannot install it from this repository without a token. Choose one of these
before wiring it in:

- vendor a tarball (`npm pack` → `vendor/*.tgz` in the app, `"file:"` dependency);
- publish to GitHub Packages and give the app's CI a read token;
- make this repository public.

Installing from git (`"github:nextbrowser-oss/nextbrowser-x-monitoring#<sha>"`)
also works, because `prepare` builds `dist/`.

## Events

Each event is plain JSON with a `type` and an `at` time in epoch milliseconds.

| `type` | Fields |
|---|---|
| `new_post` | `account`, `post: { id, url, author, text, createdAt, repost, repostedBy?, reply, quotedUrl?, photos, video, card }` |
| `followers_changed` | `handle`, `own`, `previous`, `current`, `delta`, `exact`, `following?`, `label?` |
| `signed_in` / `signed_out` | `handle?` |
| `account_changed` | `previous`, `current`. The feed starts over for the new account. |

## How a pass works

1. **Account.** Opens `x.com/home` and reads who is signed in from the account
   chrome. A signed-out profile emits `signed_out` once, and nothing else is
   read until someone signs it in. A page x.com never drew is reported as a
   page failure, not a sign-out. This was the reply agent's hardest-won lesson.
2. **Feed.** Selects *Following*. x.com remembers the choice, so from the second
   pass on this is only a read. The pass reads posts top down, scrolling until
   it has passed three posts it already knew (up to `maxScrolls`). The first
   pass only records the starting line and announces nothing.
   - An original post is new when it is newer than the watermark and was not
     seen before. A reply's parent is often old, so old posts do not end the
     scan.
   - A repost is new only above the first already-seen post, because its id is
     the original post's.
   - Ads and the account's own posts are dropped. Posts older than
     `maxPostAgeMs` (6 h by default) are not announced after downtime.
3. **Followers.** For each tracked account that is due (every 30 min by default):
   - It opens the profile and takes the exact figure when the page holds one:
     the router data on the rewritten x.com, or the user object behind the
     header on the classic one.
   - Otherwise it parses the drawn label ("12.3K", "92,3 млн", "1,2 Mio.", "12万").
     `exact: false` says the delta is only as good as the rounding.
   - A switch between a rounded and an exact figure is not reported as a change.
4. **Park.** Leaves the tab on `about:blank`. A feed left on screen autoplays
   video and keeps polling x.com, which cost the reply agent more proxy traffic
   than its reads did.

Post times come from the snowflake id when the page has no `<time>`, as on the
rewritten front end.

## Settings

Settings live in `state.settings` and are normalized on every load.

| Setting | Default | |
|---|---|---|
| `watchPosts` | `true` | read the Following feed |
| `includeReposts` | `false` | announce reposts by followed accounts |
| `includeReplies` | `true` | announce their replies |
| `feedLimit` | `60` | feed entries per pass, at most 300 |
| `maxScrolls` | `6` | scrolls per pass |
| `maxPostAgeMs` | 6 h | older posts are not announced |
| `trackOwnFollowers` | `true` | the signed-in account's followers |
| `followerHandles` | `[]` | other accounts, at most 50; each one costs a page load |
| `followersIntervalMs` | 30 min | at least 5 min; a failed read is retried after 10 min |
| `parkTab` | `true` | leave the tab on about:blank |

## Command line

```bash
npm install && npm run build
node dist/node/bin.js run --profile my-x-profile --followers NASA,SpaceX --interval 5m
```

- It drives the NextBrowser app's profiles. The runtime root defaults to the
  app's: `~/.nextbrowser/runtime` on macOS, `<userData>/runtime` elsewhere.
- It uses the app's managed `nextctl` when it exists, otherwise `nbc` from PATH.
- It keeps its state in `~/.nextbrowser/x-monitoring/<profile>.json`.
- Events go to stdout, as JSON lines when piped and as text on a terminal.
- `--verbose` writes the full log to stderr.
- `x-monitor --help` lists every flag.

## Development

```bash
npm test          # vitest: parser, freshness rules, engine on a fake x.com,
                  # page scripts on happy-dom fixtures of both front ends, nbc adapter
npm run typecheck
npm run build
```

## Known limits

- **The signed-in DOM is not verified live yet.** The scripts were run against
  live x.com on 2026-09-25, but only signed out, which is the rewritten front
  end. There, the post reader and the exact follower counts from router data
  both worked. The signed-in classic front end is covered by fixtures built
  from the reply agent's selectors. On a signed-in profile, three reads still
  need a real run: the *Following* tab, the repost social context and the
  React-props follower count.
- **The Following tab label** is matched in about fifteen languages. Otherwise
  the second tab is assumed.
- **"Replying to" and ad labels** are matched in a handful of languages.
- **Only follower counts** are tracked. Who followed or unfollowed would need
  a scroll through `/followers`, which is not done.
- **nbc 1.2.24 refuses browser switches** on proxied profiles. `nbcBrowser`
  therefore starts profiles without `--autoplay-policy` unless you pass it in
  `browserArgs`.
