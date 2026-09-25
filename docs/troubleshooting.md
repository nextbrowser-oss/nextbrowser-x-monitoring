# Troubleshooting

Start with the log. In the app, it is the monitor's log file. In the CLI, run with `--verbose` to get every step and every nbc call on stderr. A `page` entry with `rendered: false` or `error_screen: true`, and the `diag` block beside it, usually explains the failure.

## "The profile is not signed in to x.com"

The home page showed the sign-in gate, so the profile has no x.com session. Open the profile in Nextbrowser, sign in to x.com, and leave the profile running. The next pass picks up from there. While the profile is signed out, the CLI waits three intervals between passes, not one.

If you *are* signed in and still see this, look at the `identity` log entry. If `anchors` is `0` and `articles` is `0`, x.com did not draw the page. That is a page failure, not a sign-out (see the next section).

## "x.com did not render the home page"

The page stayed blank or showed x.com's own error screen ("Something went wrong. Try again"), even after being reopened in a fresh tab. Common causes:

- **A slow or failing proxy.** Check `diag.text` and the page timings in the log. Nextbrowser's proxy diagnostics show whether the connection works.
- **Rate limiting by x.com.** Passes that are too frequent make it worse. Keep `--interval` at five minutes or more.
- **Exhausted proxy traffic.** nbc reports `PROXY_TRAFFIC_EXHAUSTED`.

## "The Following tab was not found on the home page"

The note lists the tab labels the page did draw.

- **The labels are empty.** The home page had not finished drawing. The next pass usually succeeds.
- **The labels are in a language the engine does not know, and there are fewer than two tabs.** The layout has changed. Open an issue with the labels from the note.

## "The feed was not read back to where the last pass stopped"

More posts arrived since the last pass than `feedLimit` or `maxScrolls` allowed the pass to read. Posts in between may have been missed. Raise `--max-scrolls` or `--feed-limit`, or shorten `--interval`.

## Follower counts are "(rounded)"

The page held only x.com's rounded figure, such as "12.3K". The engine looks for the exact figure first:

- in the router data on the rewritten site;
- in the profile header's props on the classic site.

When neither is present, the rounded figure is the best available. A rounded figure changes only when the change is larger than the rounding step.

## A tracked handle is "unavailable"

The account is suspended or deactivated, or the handle does not exist. Check the spelling. The engine retries after 10 minutes, then keeps trying at that pace.

## The profile does not start

`x-monitor` starts the profile through nbc, and nbc reports why a start failed. Messages seen in practice:

| nbc says | Meaning |
| --- | --- |
| `ClawBrowser does not expose managed-proxy privacy capability 2` | The installed browser runtime is older than nbc requires for proxied profiles. Update the browser runtime from the Nextbrowser app. |
| `browser switch "--…" is not allowed before proxied runtime privacy verification` | A browser switch was passed to a proxied profile. Do not pass `browserArgs` for proxied profiles. |
| `SESSION_NOT_FOUND` | nbc is looking in the wrong runtime root. Point `--runtime-root` at the app's (`~/.nextbrowser/runtime` on macOS). |
| `API_KEY_REQUIRED`, `API_KEY_INVALID` | The Nextbrowser account setup is incomplete. Sign in to the app. |

In `run` mode, a profile that does not start is reported and retried at the next interval. `once` exits with code 1.

## Reporting a problem

Open a [bug report](https://github.com/nextbrowser-oss/nextbrowser-x-monitoring/issues/new/choose) and include:

- the version or commit;
- the relevant `--verbose` log lines, with handles and post text removed if they are private;
- which front end x.com showed. `diag.test_ids` is `0` on the rewritten one.
