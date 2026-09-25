// X post ids are snowflakes: ordered by creation time, and wider than a
// JavaScript number can hold exactly. They are compared as digit strings and
// never parsed into a Number.

/** Twitter's snowflake epoch, 2010-11-04T01:42:54.657Z. */
const SNOWFLAKE_EPOCH_MS = 1288834974657n;
const TIMESTAMP_SHIFT = 22n;
const ID_PATTERN = /^\d{1,20}$/;

/** compareIds orders two numeric post ids without losing precision. */
export function compareIds(left: string, right: string): number {
  const a = left.trim().replace(/^0+/, "");
  const b = right.trim().replace(/^0+/, "");
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** maxId returns the larger of two ids; an empty id loses to anything. */
export function maxId(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right || undefined;
  if (!right) return left;
  return compareIds(left, right) >= 0 ? left : right;
}

/** snowflakeTime reads the creation time a post id carries, in milliseconds
 *  since the epoch. It is what dates a post on the rewritten x.com, which draws
 *  "9h" and no <time> element at all. Ids from before snowflakes (2010) carry
 *  no time and return undefined. */
export function snowflakeTime(id: string): number | undefined {
  const trimmed = id.trim();
  if (!ID_PATTERN.test(trimmed)) return undefined;
  const value = BigInt(trimmed);
  const ms = (value >> TIMESTAMP_SHIFT) + SNOWFLAKE_EPOCH_MS;
  // A small legacy id shifts down to the epoch itself; that is not a date.
  if (ms <= SNOWFLAKE_EPOCH_MS) return undefined;
  return Number(ms);
}
