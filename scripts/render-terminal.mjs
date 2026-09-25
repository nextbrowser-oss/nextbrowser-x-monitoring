// Renders assets/x-monitor-terminal.svg, the terminal shown at the top of the
// README. Every line comes from the CLI's own formatters (dist/node/cli.js), so
// the picture shows exactly what `x-monitor run` prints; the accounts and
// numbers are sample data.
//
//   npm run build && npm run render:terminal

import { writeFile } from "node:fs/promises";
import { describeEvent, describePass } from "../dist/node/cli.js";

const at = (hour, minute) => new Date(2026, 8, 25, hour, minute).getTime();
const post = (author, id, text, extra = {}) => ({
  key: id, id, url: `https://x.com/${author}/status/${id}`, author, text,
  repost: false, reply: false, photos: 0, video: false, card: false, ...extra,
});
const pass = (patch) => ({
  signedIn: true, handle: "acme_labs", loginRequired: false, feedRead: true, baseline: false, entriesRead: 0,
  scrolls: 0, newPosts: 0, gap: false, followerChecks: 0, followerChanges: 0, stopped: false, notes: [], ...patch,
});

const lines = [
  describeEvent({ type: "signed_in", at: at(9, 0), handle: "acme_labs" }),
  describePass(pass({ baseline: true, entriesRead: 18, followerChecks: 3 }), at(9, 0)),
  describeEvent({ type: "new_post", at: at(9, 5), post: post("jane_builds", "2103250011", "Shipped the new release: 40% faster cold starts.") }),
  describeEvent({ type: "new_post", at: at(9, 5), post: post("devtools_daily", "2103250012", "", { photos: 2 }) }),
  describeEvent({ type: "new_post", at: at(9, 5), post: post("sam_ops", "2103250013", "Agreed, pin the version and move on.", { reply: true }) }),
  describePass(pass({ entriesRead: 21, scrolls: 1, newPosts: 3 }), at(9, 5)),
  describeEvent({ type: "followers_changed", at: at(9, 30), handle: "acme_labs", own: true, previous: 12480, current: 12517, delta: 37, exact: true }),
  describeEvent({ type: "followers_changed", at: at(9, 30), handle: "bigco", own: false, previous: 1230000, current: 1240000, delta: 10000, exact: false }),
  describePass(pass({ entriesRead: 19, followerChecks: 3, followerChanges: 2 }), at(9, 30)),
];

const COLORS = {
  background: "#0b1120",
  bar: "#111827",
  border: "#1f2937",
  text: "#e5e7eb",
  dim: "#6b7280",
  prompt: "#2dd4bf",
  post: "#34d399",
  followers: "#60a5fa",
  pass: "#94a3b8",
  handle: "#c4b5fd",
  up: "#34d399",
  down: "#f87171",
  rounded: "#fbbf24",
  link: "#64748b",
};

const TOKEN = /(\bnew post\b|\bfollowers(?= @)|\bsigned in\b|\bpass(?= @)|@[A-Za-z0-9_]+|https:\/\/\S+|\(\+[\d,]+\)|\(-[\d,]+\)|\(rounded\)|\(you\))/g;

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function colorOf(token) {
  if (token === "new post") return COLORS.post;
  if (token === "followers" || token === "signed in") return COLORS.followers;
  if (token === "pass") return COLORS.pass;
  if (token.startsWith("@")) return COLORS.handle;
  if (token.startsWith("https://")) return COLORS.link;
  if (token.startsWith("(+")) return COLORS.up;
  if (token.startsWith("(-")) return COLORS.down;
  if (token === "(rounded)") return COLORS.rounded;
  return COLORS.dim;
}

function spans(line) {
  const time = line.slice(0, 5);
  const rest = line.slice(5);
  const parts = [`<tspan fill="${COLORS.dim}">${escape(time)}</tspan>`];
  let last = 0;
  for (const match of rest.matchAll(TOKEN)) {
    if (match.index > last) parts.push(escape(rest.slice(last, match.index)));
    parts.push(`<tspan fill="${colorOf(match[0])}">${escape(match[0])}</tspan>`);
    last = match.index + match[0].length;
  }
  parts.push(escape(rest.slice(last)));
  return parts.join("");
}

const FONT_SIZE = 14;
const LINE = 26;
const CHAR = FONT_SIZE * 0.6;
const PAD = 28;
const BAR = 40;
const command = "$ x-monitor run --profile acme --followers bigco --interval 5m";
const longest = Math.max(command.length, ...lines.map((line) => line.length));
const width = Math.ceil(PAD * 2 + longest * CHAR);
const height = BAR + PAD + LINE * (lines.length + 1) + PAD - 6;

const rows = [
  `<text x="${PAD}" y="${BAR + PAD + 4}"><tspan fill="${COLORS.prompt}">$</tspan> ${escape(command.slice(2))}</text>`,
  ...lines.map((line, index) => `<text x="${PAD}" y="${BAR + PAD + 4 + LINE * (index + 1)}" xml:space="preserve">${spans(line)}</text>`),
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Example x-monitor output: new posts from followed accounts and follower-count changes">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  <path d="M12.5 0.5h${width - 25}a12 12 0 0 1 12 12v${BAR - 12}h-${width - 1}v-${BAR - 12}a12 12 0 0 1 12-12z" fill="${COLORS.bar}"/>
  <circle cx="24" cy="20" r="6" fill="#ff5f57"/>
  <circle cx="44" cy="20" r="6" fill="#febc2e"/>
  <circle cx="64" cy="20" r="6" fill="#28c840"/>
  <text x="${width / 2}" y="25" text-anchor="middle" fill="${COLORS.dim}" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">x-monitor — sample output</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="${FONT_SIZE}" fill="${COLORS.text}">
    ${rows.join("\n    ")}
  </g>
</svg>
`;

await writeFile(new URL("../assets/x-monitor-terminal.svg", import.meta.url), svg);
console.log(`assets/x-monitor-terminal.svg: ${width}x${height}, ${lines.length} lines`);
