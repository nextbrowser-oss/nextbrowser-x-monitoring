// The browser surface the monitor needs.
//
// It is deliberately a subset of the X reply engine's XBrowser in
// nextbrowser-app (src/lib/xreply/browser.ts), so the app can hand the monitor
// the same nextctl-backed browser it already builds for a prepared profile.
// Outside the app, src/node/nbc.ts implements it over the nbc CLI.
//
// Nothing here may depend on Node: the app runs its engines in the renderer.

export interface MonitorBrowser {
  /** Navigate the active tab. */
  open(url: string): Promise<void>;
  /** Evaluate one expression on the active page and return its value. The
   *  label names the read in logs and lets test fakes route by it; the script
   *  itself would be pages long. */
  evaluate<T>(script: string, label?: string): Promise<T>;
  /** Wait until the active page finishes loading. */
  waitForLoad(timeoutSeconds?: number): Promise<void>;
  /** Load the URL in a fresh tab and close the tabs this site was in. A tab
   *  where x.com's app has failed keeps failing on every reload of the same
   *  URL; a new tab loads it at once. */
  reopen(url: string): Promise<void>;
  /** Dispatch a real mouse click at viewport coordinates. Optional: without it
   *  the monitor clicks through the page script instead. */
  clickAt?(x: number, y: number): Promise<void>;
}
