// x-monitor: run the monitor against one NextBrowser profile from a terminal.
//
// Events go to stdout, one JSON object per line (or one readable line each
// with --format text), so another process can follow them; the log goes to
// stderr with --verbose. The state lives in a file between runs.

import { parseArgs } from "node:util";
import { runPass, type PassSummary } from "../engine.js";
import type { MonitorEvent } from "../events.js";
import type { LogEntry } from "../log.js";
import { DEFAULT_INTERVAL_MS, scheduleDelay } from "../schedule.js";
import { normalizeHandle, withSettings, type MonitorSettings, type MonitorState } from "../state.js";
import { nbcBrowser } from "./nbc.js";
import { defaultStatePath, loadState, saveState } from "./store.js";

const USAGE = `x-monitor — watch an X account through a NextBrowser profile

Usage:
  x-monitor run   --profile NAME [options]   pass after pass until stopped
  x-monitor once  --profile NAME [options]   one pass
  x-monitor state --profile NAME [--state FILE]   print the saved state

What is watched:
  --followers a,b          other accounts whose follower counts are tracked
  --no-posts               do not watch the Following feed
  --no-own-followers       do not track the signed-in account's followers
  --reposts / --no-reposts announce reposts by followed accounts (default: no)
  --replies / --no-replies announce their replies (default: yes)

How often:
  --interval 5m            between passes (min 1m, spread ±20%)
  --followers-interval 30m between reads of one account's counts (min 5m)
  --max-post-age 6h        older posts are not announced
  --feed-limit 60          feed entries one pass may read
  --max-scrolls 6          scrolls one pass may make

Browser:
  --nbc PATH               nbc or nextctl binary (default: the app's, then PATH)
  --runtime-root DIR       the app's runtime root (default: the app's)
  --runtime NAME           nbc --runtime for the profile
  --no-start               do not start the profile; fail if it is not running
  --keep-tab               leave the last page open instead of about:blank

Output:
  --state FILE             state file (default ~/.nextbrowser/x-monitoring/<profile>.json)
  --format json|text       stdout format (default: text on a terminal, json otherwise)
  --verbose                write the monitor's log to stderr as JSON lines

Settings given as flags are saved in the state file and kept for later runs.
`;

const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(value: string, flag: string): number {
  const match = DURATION.exec(value.trim());
  if (!match) throw new Error(`${flag}: "${value}" is not a duration like 90s, 5m or 2h`);
  return Math.round(Number(match[1]) * UNIT_MS[match[2] ?? "s"]!);
}

function positiveInteger(value: string, flag: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${flag}: "${value}" is not a whole number`);
  return number;
}

const OPTIONS = {
  profile: { type: "string" },
  state: { type: "string" },
  interval: { type: "string" },
  followers: { type: "string" },
  "followers-interval": { type: "string" },
  "max-post-age": { type: "string" },
  "feed-limit": { type: "string" },
  "max-scrolls": { type: "string" },
  posts: { type: "boolean" },
  "no-posts": { type: "boolean" },
  "own-followers": { type: "boolean" },
  "no-own-followers": { type: "boolean" },
  reposts: { type: "boolean" },
  "no-reposts": { type: "boolean" },
  replies: { type: "boolean" },
  "no-replies": { type: "boolean" },
  nbc: { type: "string" },
  "runtime-root": { type: "string" },
  runtime: { type: "string" },
  "no-start": { type: "boolean" },
  "keep-tab": { type: "boolean" },
  format: { type: "string" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

/** toggle reads a --x / --no-x pair; the negative wins when both are given. */
function toggle(values: Values, name: string): boolean | undefined {
  const record = values as Record<string, unknown>;
  if (record[`no-${name}`]) return false;
  if (record[name]) return true;
  return undefined;
}

/** settingsFromFlags is the settings patch the flags ask for. */
export function settingsFromFlags(values: Values): Partial<MonitorSettings> {
  const patch: Partial<MonitorSettings> = {};
  const posts = toggle(values, "posts");
  if (posts !== undefined) patch.watchPosts = posts;
  const own = toggle(values, "own-followers");
  if (own !== undefined) patch.trackOwnFollowers = own;
  const reposts = toggle(values, "reposts");
  if (reposts !== undefined) patch.includeReposts = reposts;
  const replies = toggle(values, "replies");
  if (replies !== undefined) patch.includeReplies = replies;
  if (values.followers !== undefined) {
    const handles = values.followers.split(/[\s,]+/).filter(Boolean);
    const invalid = handles.filter((handle) => !normalizeHandle(handle));
    if (invalid.length) throw new Error(`--followers: not an X handle: ${invalid.join(", ")}`);
    patch.followerHandles = handles.map(normalizeHandle);
  }
  if (values["followers-interval"] !== undefined) patch.followersIntervalMs = parseDuration(values["followers-interval"], "--followers-interval");
  if (values["max-post-age"] !== undefined) patch.maxPostAgeMs = parseDuration(values["max-post-age"], "--max-post-age");
  if (values["feed-limit"] !== undefined) patch.feedLimit = positiveInteger(values["feed-limit"], "--feed-limit");
  if (values["max-scrolls"] !== undefined) patch.maxScrolls = positiveInteger(values["max-scrolls"], "--max-scrolls");
  if (values["keep-tab"]) patch.parkTab = false;
  return patch;
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function oneLine(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** describeEvent is the readable line for an event. */
export function describeEvent(event: MonitorEvent): string {
  switch (event.type) {
    case "new_post": {
      const post = event.post;
      const kind = post.repost ? `@${post.repostedBy} reposted @${post.author}` : post.reply ? `@${post.author} replied` : `@${post.author}`;
      const media = [post.photos ? `${post.photos} photo${post.photos > 1 ? "s" : ""}` : "", post.video ? "video" : ""].filter(Boolean).join(", ");
      const body = oneLine(post.text) || (media ? `[${media}]` : "[no text]");
      return `${time(event.at)}  new post  ${kind}: ${body}  ${post.url}`;
    }
    case "followers_changed": {
      const sign = event.delta > 0 ? "+" : "";
      const approx = event.exact ? "" : " (rounded)";
      return `${time(event.at)}  followers @${event.handle}${event.own ? " (you)" : ""}: ${event.previous.toLocaleString()} → ${event.current.toLocaleString()} (${sign}${event.delta.toLocaleString()})${approx}`;
    }
    case "signed_in":
      return `${time(event.at)}  signed in${event.handle ? ` as @${event.handle}` : ""}`;
    case "signed_out":
      return `${time(event.at)}  signed out${event.handle ? ` (was @${event.handle})` : ""}: sign the profile in to x.com`;
    case "account_changed":
      return `${time(event.at)}  account changed: @${event.previous} → @${event.current}; the feed starts over`;
  }
}

function describePass(summary: PassSummary, at: number): string {
  const parts: string[] = [];
  if (summary.loginRequired) parts.push("not signed in");
  else if (summary.blocked) parts.push(summary.blocked);
  else {
    if (summary.feedRead) {
      parts.push(summary.baseline
        ? `feed baseline: ${summary.entriesRead} entries`
        : `feed: ${summary.newPosts} new of ${summary.entriesRead}${summary.scrolls ? `, ${summary.scrolls} scrolls` : ""}`);
    }
    if (summary.followerChecks) parts.push(`followers: ${summary.followerChecks} read, ${summary.followerChanges} changed`);
  }
  if (summary.stopped) parts.push("stopped");
  const notes = summary.notes.filter((note) => note !== summary.blocked);
  return `${time(at)}  pass${summary.handle ? ` @${summary.handle}` : ""}: ${parts.join("; ") || "nothing to do"}${notes.length ? `\n        ${notes.join("\n        ")}` : ""}`;
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  const command = positionals[0] ?? "";
  if (values.help || !["run", "once", "state"].includes(command)) {
    process.stdout.write(USAGE);
    return values.help ? 0 : 2;
  }
  const profile = values.profile?.trim();
  if (!profile && !(command === "state" && values.state)) throw new Error("--profile is required");
  const statePath = values.state ?? defaultStatePath(profile ?? "");
  let state: MonitorState = withSettings(await loadState(statePath), settingsFromFlags(values));
  if (command === "state") {
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return 0;
  }

  const format = values.format ?? (process.stdout.isTTY ? "text" : "json");
  if (format !== "json" && format !== "text") throw new Error(`--format: "${format}" is neither json nor text`);
  const intervalMs = values.interval !== undefined ? parseDuration(values.interval, "--interval") : DEFAULT_INTERVAL_MS;
  const print = (line: string) => process.stdout.write(`${line}\n`);
  const log = values.verbose ? (entry: LogEntry) => process.stderr.write(`${JSON.stringify(entry)}\n`) : undefined;
  const browser = nbcBrowser({
    profile: profile!,
    ...(values.nbc ? { binary: values.nbc } : {}),
    ...(values["runtime-root"] ? { runtimeRoot: values["runtime-root"] } : {}),
    ...(values.runtime ? { runtime: values.runtime } : {}),
    ...(values.verbose ? { trace: (entry) => process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), ev: "nbc", ...entry })}\n`) } : {}),
  });

  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    if (stopping) process.exit(130);
    stopping = true;
    wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await saveState(statePath, state);
  const wait = (delay: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      wake = undefined;
    });

  for (;;) {
    if (!values["no-start"]) {
      try {
        await browser.start();
      } catch (error) {
        // One pass is worth failing over a browser that will not start; a
        // monitor that runs for days is not: the next interval tries again.
        if (command === "once") throw error;
        const message = error instanceof Error ? error.message : String(error);
        const at = Date.now();
        print(format === "json" ? JSON.stringify({ type: "error", at, error: message }) : `${time(at)}  the profile did not start: ${message}`);
        await wait(scheduleDelay(intervalMs));
        if (stopping) return 0;
        continue;
      }
    }
    const result = await runPass({
      browser,
      state,
      ...(log ? { log } : {}),
      shouldStop: () => stopping,
      onEvent: (event) => print(format === "json" ? JSON.stringify(event) : describeEvent(event)),
    });
    state = result.state;
    await saveState(statePath, state);
    const at = state.lastPass?.at ?? Date.now();
    print(format === "json" ? JSON.stringify({ type: "pass", at, summary: result.summary }) : describePass(result.summary, at));
    if (command === "once" || stopping) return result.summary.loginRequired ? 3 : 0;
    await wait(scheduleDelay(intervalMs, { loginRequired: result.summary.loginRequired }));
    if (stopping) return 0;
  }
}
