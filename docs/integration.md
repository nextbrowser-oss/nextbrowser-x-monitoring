# Integration guide

The package has two entry points:

| Entry | Contents | Runs in |
| --- | --- | --- |
| `@nextbrowser-oss/x-monitoring` | `runPass`, state and settings, events, page scripts, `scheduleDelay` | Anywhere. It has no Node imports; [`src/core.test.ts`](../src/core.test.ts) enforces this. |
| `@nextbrowser-oss/x-monitoring/node` | `nbcBrowser` (a browser over the `nbc`/`nextctl` CLI), `loadState`/`saveState`, the CLI | Node.js 22 or later |

## Installing

The package is consumed from Git. `prepare` builds `dist/` on install:

```bash
npm install github:nextbrowser-oss/nextbrowser-x-monitoring#<commit-or-tag>
```

Pin a commit or a tag rather than a branch, so a rebuild of the app never picks up an unreviewed change.

## The contract with Nextbrowser

The app owns everything that has a lifetime:

- the browser, prepared for the selected profile;
- the timer;
- the storage.

The engine owns only the logic of one pass.

```ts
import {
  normalizeState,
  runPass,
  scheduleDelay,
  withSettings,
  type MonitorEvent,
} from "@nextbrowser-oss/x-monitoring";
import { cliBrowser } from "./lib/xreply/browser";

async function monitorPass(profileArgs: string[]) {
  const saved = normalizeState(await readAppData("x-monitor-state.json"));
  const { state, events, summary } = await runPass({
    browser: cliBrowser(profileArgs),
    state: saved,
    log: (entry) => appendAppData("x-monitor-log.jsonl", entry),
    onStep: (step) => setStatus(step),
    onEvent: (event: MonitorEvent) => showNotification(event),
    shouldStop: () => stopRequested,
  });
  await writeAppData("x-monitor-state.json", state);
  return scheduleDelay(5 * 60_000, { loginRequired: summary.loginRequired });
}

// Settings changed in the UI: patch them, normalized.
const next = withSettings(saved, { followerHandles: ["NASA"], includeReposts: true });
```

### The browser

`MonitorBrowser` is a subset of the app's `XBrowser` (`src/lib/xreply/browser.ts`), so the app can pass its existing `cliBrowser(profileArgs)` as it is:

```ts
interface MonitorBrowser {
  open(url: string): Promise<void>;
  evaluate<T>(script: string, label?: string): Promise<T>;
  waitForLoad(timeoutSeconds?: number): Promise<void>;
  reopen(url: string): Promise<void>;          // fresh tab, then close the site's old tabs
  clickAt?(x: number, y: number): Promise<void>;
}
```

The engine waits for elements by polling `evaluate` itself. It does not use `nbc wait --selector`, which only matches elements inside the viewport.

### Sharing the profile

The monitor, the X reply engine, and the user's own agent runs may all drive the same profile. They must take turns, because two passes navigating one tab read each other's pages. Run the monitor pass in the same queue the app already uses for the X reply engine's passes. Do not run it beside them.

### State

The state is one JSON document. Store it as it is, and pass whatever comes back from storage through `normalizeState`. That function accepts older files, hand edits, and nothing at all. The layout is described in [events and state](events-and-state.md).

### Logging

`log` receives one JSON object per step: every page load with its timing and diagnostics, every identity read, every feed read, and every profile read. The pass summary keeps at most five notes. When a read fails on a user's machine, the log is the full record, so append it to a rotated file, as the app does for the X reply engine.

## Outside the app: the Node adapter

```ts
import { runPass } from "@nextbrowser-oss/x-monitoring";
import { loadState, nbcBrowser, saveState } from "@nextbrowser-oss/x-monitoring/node";

const browser = nbcBrowser({ profile: "my-x-profile" });
await browser.start();
const path = "state.json";
const { state, events } = await runPass({ browser, state: await loadState(path) });
await saveState(path, state);
```

`nbcBrowser` runs `nbc --profile <name> <command> … --format json` and reads nbc's `{ok, data, error}` envelope. By default it uses the app's own setup:

| Setting | Default |
| --- | --- |
| Runtime root | `~/.nextbrowser/runtime` on macOS, `<userData>/runtime` elsewhere |
| Environment | the same `CLAWBROWSER_*`, `NBC_PROFILE_ROOT` and `NEXTBROWSER_CONFIG_DIR` values the app passes |
| Binary | the app's managed `nextctl`, otherwise `nbc` from `PATH` |

With these defaults it can drive the profiles the app manages. Override the runtime root with `runtimeRoot`, the binary with `binary`, and add browser switches with `browserArgs`. Note that nbc 1.2.24 refuses browser switches on proxied profiles.
