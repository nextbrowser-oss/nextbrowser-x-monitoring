// Page scripts, ported from the nextbrowser-x-reply-agent Go service
// (internal/xpage, internal/xtimeline/script.go) and the app's X reply engine,
// plus the reads that are new here: the Following feed and a profile's counts.
//
// Each script is one expression returning a JSON-serializable value, because
// it runs through CDP Runtime.evaluate with returnByValue. Values that come
// from outside the page — handles, selectors — are inserted as JSON literals,
// so nothing can break out of the expression.
//
// x.com is two front ends at once. The signed-in site is the one the reply
// agent knows, with a data-testid on everything. The signed-out site (and, by
// the look of it, the future signed-in one) is a rewrite with no test ids, no
// <time> elements, and the profile's exact counts in its router's loader data.
// Every read here tries the known markup first and falls back to what both
// share: <article>, and permalinks of the form /handle/status/id.

/** jsLiteral renders a value as a JavaScript literal safe to inline. */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value ?? "");
}

/** The account chrome a signed-in x.com renders. Any one of these means there
 *  is a session, even in layouts where none of them says whose it is. */
export const IDENTITY_ANCHOR_SELECTOR = `[data-testid="SideNav_AccountSwitcher_Button"], a[data-testid="AppTabBar_Profile_Link"], [data-testid="SideNav_NewTweet_Button"]`;
/** What a signed-out page draws instead of the chrome. */
export const LOGIN_MARKER_SELECTOR = `a[href="/i/flow/login"], input[autocomplete="username"]`;
/** What the home page draws once x.com has answered: the chrome, the feed
 *  tabs, a post, or the signed-out markers, so a signed-out page ends the wait
 *  at once and only a page that draws nothing pays for the whole window. */
export const HOME_READY_SELECTOR = `${IDENTITY_ANCHOR_SELECTOR}, [role="tablist"] [role="tab"], article, ${LOGIN_MARKER_SELECTOR}`;
/** What a feed draws once it has something to say, including nothing. */
export const FEED_READY_SELECTOR = `article, [data-testid="emptyState"]`;
/** What a profile page draws once its header is in: the counts, the name, or
 *  the empty state of an account that is gone. */
export const PROFILE_READY_SELECTOR = `a[href$="/verified_followers"], a[href$="/followers"], [data-testid="UserName"], [data-testid="emptyState"], ${LOGIN_MARKER_SELECTOR}`;

/** atLoginWall() is true on every gate a signed-out session is sent to —
 *  /i/flow/login, /login, single sign-on, the onboarding pages under /i/jf/,
 *  all of which carry redirect_after_login — and on a page that draws the
 *  sign-in controls in place. */
const LOGIN_WALL_HELPER = String.raw`
  const atLoginWall = () => {
    const path = location.pathname.toLowerCase();
    if (path.startsWith("/i/flow/") || path.startsWith("/i/jf/") || path.startsWith("/login") ||
        location.search.indexOf("redirect_after_login") >= 0) return true;
    return !!document.querySelector(${jsLiteral(LOGIN_MARKER_SELECTOR)});
  };`;

/** pageDiag() describes the page for the log. Every field is read
 *  defensively: a diagnostic must never be what breaks the read it describes. */
const DIAG_HELPER = String.raw`
  const pageDiag = () => {
    const count = (selector) => { try { return document.querySelectorAll(selector).length; } catch (error) { return 0; } };
    const view = typeof window === "object" && window ? window : {};
    const bodyText = String((document.body && document.body.innerText) || "");
    return {
      width: Number(view.innerWidth) || 0,
      height: Number(view.innerHeight) || 0,
      ready: String(document.readyState || ""),
      visible: String(document.visibilityState || ""),
      title: String(document.title || "").slice(0, 80),
      anchors: count(${jsLiteral(IDENTITY_ANCHOR_SELECTOR)}),
      login_markers: count(${jsLiteral(LOGIN_MARKER_SELECTOR)}),
      articles: count("article"),
      test_ids: count("[data-testid]"),
      text: bodyText.replace(/\s+/g, " ").trim().slice(0, 160)
    };
  };`;

/** What pageDiag() reports. */
export interface PageDiag {
  width: number;
  height: number;
  ready: string;
  visible: string;
  title: string;
  anchors: number;
  login_markers: number;
  articles: number;
  test_ids: number;
  text: string;
}

/** What a page did after load: whether x.com drew anything, whether the whole
 *  page is its own error screen, and whether it is the sign-in wall. */
export interface PageHealth {
  url: string;
  rendered: boolean;
  error_screen: boolean;
  login_wall: boolean;
  diag?: PageDiag;
}

/** pageHealthScript tells a page x.com drew from one it gave up on.
 *
 *  The error screen — "Something went wrong … Try again" — is judged on the
 *  content, not the chrome: x.com draws its sidebar around the failure, so a
 *  page with every account anchor on it can still be the error screen. An
 *  error module beside drawn content is not. (Go: internal/xpage/load.go.) */
export function pageHealthScript(): string {
  return String.raw`(() => {${LOGIN_WALL_HELPER}${DIAG_HELPER}
  const drew = (selector) => { try { return !!document.querySelector(selector); } catch (error) { return false; } };
  const content = drew("article") || drew('[data-testid="cellInnerDiv"], [data-testid="emptyState"]')
    || drew('a[href$="/verified_followers"], a[href$="/followers"]');
  const rendered = drew(${jsLiteral(IDENTITY_ANCHOR_SELECTOR)}) || content;
  const text = String((document.body && document.body.innerText) || "").replace(/\s+/g, " ");
  const errorText = /something went wrong/i.test(text) && /try again|retry/i.test(text);
  return { url: location.href, rendered: rendered, error_screen: errorText && !content, login_wall: atLoginWall(), diag: pageDiag() };
})()`;
}

/** existsScript asks whether anything in the document matches a selector.
 *  Not nbc's own wait, on purpose: that one wants the first match inside the
 *  viewport, and a long profile header pushes the first post below it.
 *
 *  With orLoginWall, landing on a sign-in gate also ends the wait. x.com's
 *  newer onboarding gate (/i/jf/onboarding) draws none of the old sign-in
 *  markers, and a wait that only looked for them ran its whole window on every
 *  pass of a signed-out profile — 41 seconds in the first live run. */
export function existsScript(selector: string, orLoginWall = false): string {
  if (!orLoginWall) {
    return `(() => { try { return { found: !!document.querySelector(${jsLiteral(selector)}) }; } catch (error) { return { found: false }; } })()`;
  }
  return String.raw`(() => {${LOGIN_WALL_HELPER}
  try { return { found: atLoginWall() || !!document.querySelector(${jsLiteral(selector)}) }; } catch (error) { return { found: false }; }
})()`;
}

/** Who the page is signed in as. `session` is whether x.com drew a signed-in
 *  shell at all, which is a separate question from whether it named the
 *  account: a delegated account and a collapsed sidebar are signed in without
 *  saying so. */
export interface Identity {
  session: boolean;
  handle: string;
}

export interface IdentitySnapshot {
  url: string;
  login_wall: boolean;
  identity: Identity;
  diag?: PageDiag;
}

/** identityScript reads who is signed in, from the account chrome only: every
 *  post on the page carries an avatar too, and those belong to strangers. */
export function identityScript(): string {
  return String.raw`(() => {${LOGIN_WALL_HELPER}${DIAG_HELPER}
  const AVATAR = "UserAvatar-Container-";
  const valid = (handle) => /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : "";
  const testIdHandle = (node) => {
    const id = node ? (node.getAttribute("data-testid") || "") : "";
    return id.indexOf(AVATAR) === 0 ? valid(id.slice(AVATAR.length)) : "";
  };
  const avatarHandle = (root) => testIdHandle(root) || testIdHandle(root.querySelector('[data-testid^="' + AVATAR + '"]'));
  const textHandle = (node) => {
    const match = /@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/.exec(node.innerText || node.getAttribute("aria-label") || "");
    return match ? match[1] : "";
  };
  const hrefHandle = (node) => {
    const match = /^\/([A-Za-z0-9_]{1,15})\/?(?:[?#]|$)/.exec(node.getAttribute("href") || "");
    return match ? match[1] : "";
  };
  const read = () => {
    const nodes = Array.from(document.querySelectorAll(${jsLiteral(IDENTITY_ANCHOR_SELECTOR)}));
    for (const node of nodes) {
      const handle = avatarHandle(node) || textHandle(node) || hrefHandle(node);
      if (handle) return { session: true, handle: handle };
    }
    // A layout that drops the switcher still draws the account's avatar in
    // the side navigation.
    const sideNav = document.querySelector('header[role="banner"]');
    const fromSideNav = sideNav ? avatarHandle(sideNav) : "";
    if (fromSideNav) return { session: true, handle: fromSideNav };
    return { session: nodes.length > 0, handle: "" };
  };
  return { url: location.href, login_wall: atLoginWall(), identity: read(), diag: pageDiag() };
})()`;
}

/** The feed tab switch on the home page. */
export interface FollowingTabState {
  url: string;
  login_wall: boolean;
  found: boolean;
  selected: boolean;
  /** How the tab was recognised: by its label, or as the second tab. */
  matched: "" | "label" | "position";
  labels: string[];
  /** Click point, when the tab is visible and not covered. */
  x: number;
  y: number;
  visible: boolean;
  clicked: boolean;
}

/** followingTabScript finds the home page's "Following" tab — the
 *  chronological feed of the accounts the profile follows — and reports
 *  whether it is the selected one. With click set it presses the tab through
 *  the page; otherwise it measures a click point for a real mouse click.
 *
 *  The label is matched in the languages x.com is most used in; anything else
 *  falls back to position, since "For you" is first and "Following" second. */
export function followingTabScript(click: boolean): string {
  return String.raw`(() => {${LOGIN_WALL_HELPER}
  const FOLLOWING = /^(following|подписки|читаемые|стежу|abonnements|siguiendo|seguindo|seguiti|gefolgt|folgt|obserwowani|takip edilenler|mengikuti|フォロー中|关注|正在关注|跟隨中|팔로잉)$/i;
  const label = (tab) => String(tab.innerText || tab.textContent || "").replace(/\s+/g, " ").trim();
  const tabs = Array.from(document.querySelectorAll('[role="tablist"] [role="tab"]'));
  const result = { url: location.href, login_wall: atLoginWall(), found: false, selected: false, matched: "",
    labels: tabs.map(label).slice(0, 8), x: 0, y: 0, visible: false, clicked: false };
  let tab = tabs.find((candidate) => FOLLOWING.test(label(candidate)));
  if (tab) result.matched = "label";
  if (!tab && location.pathname.replace(/\/$/, "") === "/home" && tabs.length >= 2) {
    tab = tabs[1];
    result.matched = "position";
  }
  if (!tab) return result;
  result.found = true;
  result.selected = tab.getAttribute("aria-selected") === "true";
  if (result.selected) return result;
  if (${click ? "true" : "false"}) {
    tab.click();
    result.clicked = true;
    return result;
  }
  const rect = tab.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = rect.width > 0 && rect.height > 0 ? document.elementFromPoint(x, y) : null;
  result.visible = !!hit && (hit === tab || tab.contains(hit) || hit.contains(tab));
  result.x = x;
  result.y = y;
  return result;
})()`;
}

/** A post as the page reports it. */
export interface RawPost {
  id: string;
  url: string;
  author: string;
  text: string;
  /** The <time> the post carries, when the front end draws one. */
  created_at: string;
  social_context: string;
  /** Who reposted it into the feed, for a repost. */
  reposted_by: string;
  reply_context: string;
  repost: boolean;
  reply: boolean;
  promoted: boolean;
  photos: number;
  video: boolean;
  card: boolean;
  /** The post this one quotes, if any. */
  quoted_url: string;
}

export interface FeedSnapshot {
  url: string;
  login_wall: boolean;
  empty: boolean;
  posts: RawPost[];
  diag?: PageDiag;
}

/** readPost(article, seen) reads one post, in either front end. */
const POST_READER = String.raw`
  const PERMALINK = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,20})\/?$/;
  const HANDLE_LINK = /^\/([A-Za-z0-9_]{1,15})\/?$/;
  // A quoted post sits inside a card that is a link of its own; what is in
  // there belongs to the quoted author, not to this post.
  const inQuote = (node, article) => {
    for (let current = node; current && current !== article; current = current.parentElement) {
      if (current.getAttribute && current.getAttribute("role") === "link" && current.tagName !== "A") return true;
      if (current !== node && current.tagName === "ARTICLE") return true;
    }
    return false;
  };
  const own = (article, selector) => Array.from(article.querySelectorAll(selector)).filter((node) => !inQuote(node, article));
  // textOf reads a post body the way a reader sees it: the text, its line
  // breaks, and the emoji x.com draws as images, which innerText leaves out.
  const textOf = (root) => {
    let out = "";
    const walk = (node) => {
      if (node.nodeType === 3) { out += node.data; return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === "IMG") { out += node.getAttribute("alt") || ""; return; }
      if (tag === "BR") { out += "\n"; return; }
      let block = false;
      try { block = getComputedStyle(node).display === "block"; } catch (error) {}
      if (block && out && !out.endsWith("\n")) out += "\n";
      for (const child of node.childNodes) walk(child);
      if (block && !out.endsWith("\n")) out += "\n";
    };
    walk(root);
    return out.replace(/\n{3,}/g, "\n\n").trim();
  };
  const permalinkOf = (article) => {
    const stamp = own(article, 'a[href*="/status/"] time[datetime]')[0];
    const anchor = stamp ? stamp.closest('a[href*="/status/"]') : null;
    const fromStamp = anchor ? PERMALINK.exec(anchor.getAttribute("href") || "") : null;
    if (fromStamp) return { match: fromStamp, time: stamp.getAttribute("datetime") || "" };
    for (const link of own(article, 'a[href*="/status/"]')) {
      const match = PERMALINK.exec(link.getAttribute("href") || "");
      if (match) return { match: match, time: "" };
    }
    return null;
  };
  const PROMOTED_LABELS = /^(ad|promoted|реклама|рекламная запись|anzeige|publicité|anuncio|promocionado|annuncio|reklama|広告|프로모션|推广)$/i;
  const REPLY_PREFIX = /^(replying to|в ответ|antwort an|en réponse à|respondiendo a|em resposta a)/i;
  const readPost = (article, seen) => {
    const permalink = permalinkOf(article);
    if (!permalink) return null;
    const author = permalink.match[1];
    const id = permalink.match[2];
    const social = own(article, '[data-testid="socialContext"]')[0] || null;
    const socialText = social ? String(social.innerText || social.textContent || "").trim() : "";
    const socialLink = social ? social.closest("a[href]") || social.querySelector("a[href]") : null;
    const socialHandle = socialLink ? HANDLE_LINK.exec(socialLink.getAttribute("href") || "") : null;
    const repostedBy = socialHandle && socialHandle[1].toLowerCase() !== author.toLowerCase()
      && !/pinned|закреп/i.test(socialText) ? socialHandle[1] : "";
    const key = repostedBy ? id + "@" + repostedBy.toLowerCase() : id;
    if (seen.has(key)) return null;
    seen.add(key);
    const body = own(article, '[data-testid="tweetText"]')[0]
      || own(article, 'div[dir="auto"].whitespace-pre-wrap, div[dir="auto"][class*="whitespace-pre-wrap"]')[0] || null;
    let replyContext = "";
    for (const node of own(article, 'div[dir="ltr"], div[dir="auto"], span')) {
      const value = String(node.textContent || "").trim();
      if (REPLY_PREFIX.test(value)) { replyContext = value.slice(0, 120); break; }
    }
    const promoted = own(article, '[data-testid="placementTracking"]').length > 0
      || own(article, "span").some((node) => PROMOTED_LABELS.test(String(node.textContent || "").trim()));
    let quotedUrl = "";
    for (const link of Array.from(article.querySelectorAll('a[href*="/status/"]'))) {
      if (!inQuote(link, article)) continue;
      const match = PERMALINK.exec(link.getAttribute("href") || "");
      if (match && match[2] !== id) { quotedUrl = "https://x.com/" + match[1] + "/status/" + match[2]; break; }
    }
    const photoLinks = new Set(own(article, 'a[href*="/photo/"]').map((node) => node.getAttribute("href")));
    return {
      id: id,
      url: "https://x.com/" + author + "/status/" + id,
      author: author,
      text: body ? textOf(body) : "",
      created_at: permalink.time,
      social_context: socialText.slice(0, 120),
      reposted_by: repostedBy,
      reply_context: replyContext,
      repost: repostedBy !== "",
      reply: replyContext !== "",
      promoted: promoted,
      photos: Math.max(own(article, '[data-testid="tweetPhoto"]').length, photoLinks.size),
      video: own(article, '[data-testid="videoPlayer"], [data-testid="videoComponent"], video').length > 0,
      card: own(article, '[data-testid="card.wrapper"], [data-testid^="card.layout"]').length > 0,
      quoted_url: quotedUrl
    };
  };`;

/** feedScript reads the visible posts of a feed, top to bottom, which on the
 *  Following feed is newest first. A quoted post nested inside another is read
 *  as part of it, never as a post of its own. */
export function feedScript(limit: number): string {
  return String.raw`(() => {${LOGIN_WALL_HELPER}${DIAG_HELPER}${POST_READER}
  const limit = ${Math.max(1, Math.floor(limit))};
  const snapshot = { url: location.href, login_wall: false, empty: false, posts: [] };
  if (atLoginWall()) { snapshot.login_wall = true; snapshot.diag = pageDiag(); return snapshot; }
  const articles = Array.from(document.querySelectorAll("article"))
    .filter((article) => !(article.parentElement && article.parentElement.closest("article")));
  if (articles.length === 0) {
    snapshot.empty = !!document.querySelector('[data-testid="emptyState"]');
    snapshot.diag = pageDiag();
    return snapshot;
  }
  const seen = new Set();
  for (const article of articles) {
    if (snapshot.posts.length >= limit) break;
    const post = readPost(article, seen);
    if (post) snapshot.posts.push(post);
  }
  if (snapshot.posts.length === 0) snapshot.diag = pageDiag();
  return snapshot;
})()`;
}

/** Where scrollScript left the page. */
export interface ScrollState {
  before: number;
  after: number;
  height: number;
}

/** scrollScript advances the page by most of a viewport, which loads the next
 *  batch of a virtualized feed, and says whether it moved. */
export function scrollScript(): string {
  return `(() => {
  const before = window.scrollY;
  const distance = Math.max(Math.floor(window.innerHeight * 0.85), 640);
  window.scrollBy(0, distance);
  return { before: before, after: window.scrollY, height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) };
})()`;
}

/** A profile's counts as the page gave them. */
export interface ProfileStatsSnapshot {
  url: string;
  login_wall: boolean;
  rendered: boolean;
  /** The account is suspended, deleted or never existed. */
  unavailable: boolean;
  handle: string;
  /** Exact figures, when the page holds them: the rewritten site's router
   *  data, or the user object behind the header on the classic one. */
  followers: number | null;
  following: number | null;
  posts: number | null;
  exact: boolean;
  source: "" | "router" | "react";
  /** The labels as drawn, for a figure the page only holds rounded. */
  followers_text: string;
  following_text: string;
  diag?: PageDiag;
}

/** profileStatsScript reads a profile's follower and following counts.
 *
 *  The drawn label is rounded above ten thousand ("92.3M"), so the exact
 *  figure is looked for first: the rewritten x.com keeps the profile in its
 *  router's loader data, and the classic one keeps the user object in the
 *  props of the components that draw the header. Both are read, never
 *  written; the label is the fallback when neither is there. */
export function profileStatsScript(handle: string): string {
  return String.raw`(() => {${LOGIN_WALL_HELPER}${DIAG_HELPER}
  const wanted = String(${jsLiteral(handle)}).replace(/^@+/, "").toLowerCase();
  const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const out = { url: location.href, login_wall: atLoginWall(), rendered: false, unavailable: false, handle: "",
    followers: null, following: null, posts: null, exact: false, source: "", followers_text: "", following_text: "" };
  if (out.login_wall) { out.diag = pageDiag(); return out; }

  try {
    const router = window.__TSR_ROUTER__;
    const matches = (router && router.state && router.state.matches) || [];
    for (const match of matches) {
      const data = match && match.loaderData;
      if (!data || typeof data !== "object" || String(data.screenName || "").toLowerCase() !== wanted) continue;
      if (number(data.followers) === null) continue;
      out.handle = String(data.screenName);
      out.followers = number(data.followers);
      out.following = number(data.following);
      out.posts = number(data.tweets);
      out.exact = true;
      out.source = "router";
      out.unavailable = data.isUnavailable === true;
    }
  } catch (error) {}

  const hrefIs = (link, suffixes) => {
    const href = String(link.getAttribute("href") || "").toLowerCase().replace(/\/$/, "");
    return suffixes.some((suffix) => href === "/" + wanted + suffix);
  };
  const links = Array.from(document.querySelectorAll("a[href]"));
  const followersLink = links.find((link) => hrefIs(link, ["/verified_followers", "/followers"])) || null;
  const followingLink = links.find((link) => hrefIs(link, ["/following"])) || null;
  const labelOf = (link) => link ? String(link.innerText || link.textContent || "").trim().slice(0, 80) : "";
  out.followers_text = labelOf(followersLink);
  out.following_text = labelOf(followingLink);

  // The classic front end: walk up from the header to the component that was
  // handed the user, and read the counts off it.
  const userIn = (start) => {
    const key = Object.keys(start).find((name) => name.indexOf("__reactFiber$") === 0 || name.indexOf("__reactInternalInstance$") === 0);
    let fiber = key ? start[key] : null;
    const visited = new Set();
    let budget = 5000;
    const matchUser = (value) => {
      const legacy = value.legacy && typeof value.legacy === "object" ? value.legacy : value;
      const core = value.core && typeof value.core === "object" ? value.core : {};
      const name = String(legacy.screen_name || core.screen_name || value.screen_name || value.screenName || "").toLowerCase();
      if (name !== wanted) return null;
      const followers = number(legacy.followers_count);
      if (followers === null) return null;
      return { handle: String(legacy.screen_name || core.screen_name || value.screen_name || value.screenName),
        followers: followers, following: number(legacy.friends_count), posts: number(legacy.statuses_count) };
    };
    const search = (value, depth) => {
      if (!value || typeof value !== "object" || visited.has(value) || budget-- <= 0) return null;
      visited.add(value);
      if (value.$$typeof || value.nodeType) return null;
      const hit = matchUser(value);
      if (hit || depth <= 0) return hit;
      for (const name of Object.keys(value)) {
        if (name === "children" || name === "_owner" || name.indexOf("__") === 0) continue;
        let child = null;
        try { child = value[name]; } catch (error) { continue; }
        const found = search(child, depth - 1);
        if (found) return found;
      }
      return null;
    };
    for (let level = 0; fiber && level < 40; level += 1, fiber = fiber.return) {
      const found = search(fiber.memoizedProps, 3);
      if (found) return found;
    }
    return null;
  };
  if (!out.exact) {
    const start = followersLink || document.querySelector('[data-testid="UserName"]');
    let user = null;
    try { user = start ? userIn(start) : null; } catch (error) {}
    if (user) {
      out.handle = user.handle;
      out.followers = user.followers;
      out.following = user.following;
      out.posts = user.posts;
      out.exact = true;
      out.source = "react";
    }
  }

  out.rendered = out.source !== "" || !!followersLink || !!document.querySelector('[data-testid="UserName"]');
  if (!out.rendered && document.querySelector('[data-testid="emptyState"]')) out.unavailable = true;
  if (!out.rendered || out.followers === null) out.diag = pageDiag();
  return out;
})()`;
}

/** Every script with a label, for the tests that make sure each one is at
 *  least a valid expression. */
export function allScripts(): Record<string, string> {
  return {
    health: pageHealthScript(),
    exists: existsScript(FEED_READY_SELECTOR),
    existsOrLoginWall: existsScript(HOME_READY_SELECTOR, true),
    identity: identityScript(),
    followingTab: followingTabScript(false),
    followingTabClick: followingTabScript(true),
    feed: feedScript(20),
    scroll: scrollScript(),
    profileStats: profileStatsScript("someone"),
  };
}
