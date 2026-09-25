// Loading one x.com page and making sure it was actually drawn.
//
// The load event fires long before x.com renders anything — its shell comes
// from a service worker at once — and the part a read needs arrives from its
// own request. A read that does not wait meets an empty page, and an empty page
// reads exactly like a signed-out one. And a tab where x.com's app has failed —
// "Something went wrong … Try again" — keeps failing on every reload of the
// same URL while a fresh tab loads it at once. (Go: internal/xpage/load.go.)

import type { MonitorBrowser } from "./browser.js";
import { existsScript, pageHealthScript, type PageHealth } from "./scripts.js";
import type { Logger } from "./log.js";

export interface LoadedPage extends PageHealth {
  /** Whether the URL had to be reopened in a fresh tab to render. */
  reopened: boolean;
}

const LOAD_WAIT_SECONDS = 15;
/** How long x.com is given to draw what the page was opened for, after the
 *  document has loaded. The Go service measured ten seconds clipping against
 *  slow proxies: everything waited for here is x.com's own data calls. */
export const READY_WAIT_MS = 20_000;
const POLL_MS = 400;

export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** waitForElement asks the page whether anything matches the selector until it
 *  does or the time is up. It reports whether it was found; running out of time
 *  is an answer, not an error. */
export async function waitForElement(
  browser: MonitorBrowser,
  selector: string,
  timeoutMs: number,
  sleep: Sleep,
  now: () => number = Date.now,
  orLoginWall = false,
): Promise<boolean> {
  const script = existsScript(selector, orLoginWall);
  const deadline = now() + timeoutMs;
  for (;;) {
    const answer = await browser.evaluate<{ found?: boolean }>(script, "exists").catch(() => undefined);
    if (answer?.found) return true;
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleep(Math.min(POLL_MS, remaining));
  }
}

export interface LoadOptions {
  sleep: Sleep;
  log: Logger;
  now?: () => number;
}

/** loadPage lands on a URL and waits for x.com to draw it. When nothing
 *  rendered, or the page is x.com's error screen, the URL is reopened in a
 *  fresh tab once. The result says what the page finally showed: a caller that
 *  finds it still unrendered is looking at a page failure, not a sign-out. */
export async function loadPage(
  browser: MonitorBrowser,
  url: string,
  readySelector: string,
  options: LoadOptions,
): Promise<LoadedPage> {
  const started = (options.now ?? Date.now)();
  await browser.open(url);
  const first = await settle(browser, readySelector, options);
  if ((first.rendered && !first.error_screen) || first.login_wall) {
    return report({ ...first, reopened: false }, url, started, options);
  }
  try {
    await browser.reopen(url);
  } catch (error) {
    // The fresh tab is a repair, not the load: report what the first attempt
    // saw rather than losing it to a failed repair.
    options.log("page_reopen_failed", { url, error: String(error instanceof Error ? error.message : error) });
    return report({ ...first, reopened: false }, url, started, options);
  }
  const second = await settle(browser, readySelector, options);
  return report({ ...second, reopened: true }, url, started, options);
}

async function settle(browser: MonitorBrowser, readySelector: string, options: LoadOptions): Promise<PageHealth> {
  // Neither wait is fatal: a page that draws nothing is exactly what the
  // health read below exists to say.
  await browser.waitForLoad(LOAD_WAIT_SECONDS).catch(() => undefined);
  // A sign-in gate ends the wait too: there is nothing more to draw there.
  await waitForElement(browser, readySelector, READY_WAIT_MS, options.sleep, options.now, true);
  return browser.evaluate<PageHealth>(pageHealthScript(), "health");
}

function report(page: LoadedPage, wanted: string, started: number, options: LoadOptions): LoadedPage {
  options.log("page", {
    wanted,
    url: page.url,
    rendered: page.rendered,
    error_screen: page.error_screen,
    login_wall: page.login_wall,
    reopened: page.reopened,
    ms: (options.now ?? Date.now)() - started,
    ...(page.rendered && !page.error_screen ? {} : { diag: page.diag }),
  });
  return page;
}

/** unrendered describes a page x.com never drew, for a note a person reads. */
export function unrendered(page: LoadedPage, what: string): string {
  const screen = page.error_screen ? "its error screen" : "a blank page";
  return `x.com did not render ${what} (${screen}${page.reopened ? ", even in a fresh tab" : ""}).`;
}
