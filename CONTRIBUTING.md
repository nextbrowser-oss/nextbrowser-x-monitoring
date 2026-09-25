# Contributing to Nextbrowser X Monitoring

Thank you for helping improve the X monitoring engine behind Nextbrowser. Contributions of all sizes are welcome: bug reports, fixes to how x.com is read, tests, documentation, and new features.

Please keep contributions focused, factual, and easy to review. By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For a small fix, a documentation correction, or a test improvement, open a pull request directly.
- For a new kind of event, a new data source, or a new dependency, open an issue first so the approach can be discussed.
- Do not report security vulnerabilities publicly. Follow [SECURITY.md](SECURITY.md).

## Development setup

You need Git and Node.js 22 or later. A live check additionally needs [Nextbrowser](https://github.com/nextbrowser-oss/nextbrowser-app) and a profile that is signed in to x.com.

```bash
git clone https://github.com/YOUR-USERNAME/nextbrowser-x-monitoring.git
cd nextbrowser-x-monitoring
git remote add upstream https://github.com/nextbrowser-oss/nextbrowser-x-monitoring.git
npm ci
npm test
```

## Repository structure

| Path | What lives there |
| --- | --- |
| `src/engine.ts` | The pass: account, feed, followers, parking the tab. |
| `src/scripts.ts` | The page scripts evaluated on x.com. Each one is a single JSON-returning expression. |
| `src/posts.ts`, `src/counts.ts`, `src/ids.ts` | Pure rules: what is new, how a drawn count is read, how post ids compare. |
| `src/state.ts`, `src/events.ts` | The state document, settings, and events: the public contract. |
| `src/node/` | The Node adapter: nbc browser, state file, CLI. The only code allowed to import Node. |
| `src/testing/` | The fake x.com used by engine tests. |
| `scripts/` | Maintenance helpers, such as the README terminal renderer. |
| `docs/` | Documentation and the README translation. |

## Ground rules for this engine

- **Read-only.** The engine must never follow, like, repost, reply, type, or change a setting on x.com. The only allowed interactions are selecting the *Following* tab and scrolling a feed.
- **The core stays browser-safe.** Nothing under `src/` outside `src/node/` may import a Node module or use `process`. `src/core.test.ts` fails if it does, because the app runs the core in its renderer.
- **Passes stay pure.** `runPass` never mutates the state it is given, and it never sleeps longer than a scroll. Timers and storage belong to the host.
- **Pacing limits stay.** Do not lower the minimum pass interval, the minimum profile interval, or the handle cap.
- **Explain page knowledge.** A selector or a page quirk gets a comment saying what x.com does and why the code handles it that way.

## Changing what is read from x.com

x.com serves two front ends (see [how it works](docs/how-it-works.md#two-front-ends-of-xcom)). A change to a page script needs:

1. a fixture in `src/scripts.test.ts` reproducing the markup, trimmed from the real page, with personal data removed;
2. a test that fails without the change;
3. the front end it was observed on (classic or rewritten) and the date, in the pull request.

Where possible, run the changed read once against a live page and describe the result in the pull request, for example with `node dist/node/bin.js once --profile <name> --verbose`.

## Required checks

```bash
npm run typecheck
npm test
npm run build
```

If a check cannot be run on your platform, say so in the pull request. Do not claim a check passed if it was skipped.

The terminal image in the README is generated from the CLI's own formatters. After changing CLI output, regenerate it:

```bash
npm run build && npm run render:terminal
```

## Documentation and translations

`README.md` is the canonical English README. A semantic change to it must also update [`docs/i18n/ru/README.md`](docs/i18n/ru/README.md). Keep commands, paths, and product names identical, and check relative links from each file's location.

Do not add unverified features, platform support, metrics, or screenshots.

## Commits and pull requests

Use Conventional Commit prefixes in the imperative mood:

```text
fix: read the repost author from the new social context
feat: report who followed and unfollowed
docs: explain rounded follower counts
```

A pull request should include the problem and the chosen solution, links to related issues, the checks you ran and their results, and any risks or follow-up work. Keep it free of generated `dist/` output, credentials, cookies, and personal data from x.com.

Thank you for making Nextbrowser better.
