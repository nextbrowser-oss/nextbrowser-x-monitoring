# CLI reference

`x-monitor` runs the engine against one Nextbrowser profile from a terminal. It exists for developing the engine and for running it without the app.

```bash
npm ci && npm run build
node dist/node/bin.js <command> --profile <name> [options]
```

After `npm link`, or when the package is installed with its bin, the same command is available as `x-monitor`.

## Commands

| Command | What it does |
| --- | --- |
| `run` | Runs passes until stopped. Waits `--interval` between them, with a random spread. |
| `once` | Runs one pass and exits. |
| `state` | Prints the saved state as JSON. |

## What is watched

| Flag | Default | Meaning |
| --- | --- | --- |
| `--followers a,b` | none | Other accounts whose follower counts are tracked. Replaces the saved list. |
| `--no-posts` / `--posts` | posts on | Whether to read the *Following* feed. |
| `--no-own-followers` / `--own-followers` | on | Whether to track the signed-in account's followers. |
| `--reposts` / `--no-reposts` | off | Whether to announce reposts by followed accounts. |
| `--replies` / `--no-replies` | on | Whether to announce their replies. |

## How often

| Flag | Default | Meaning |
| --- | --- | --- |
| `--interval 5m` | 5 min | Time between passes. Minimum 1 min, spread ±20%. |
| `--followers-interval 30m` | 30 min | Time between reads of one account's counts. Minimum 5 min. |
| `--max-post-age 6h` | 6 h | Older posts are not announced. |
| `--feed-limit 60` | 60 | Feed entries one pass may read. |
| `--max-scrolls 6` | 6 | Scrolls one pass may make. |

Durations accept `ms`, `s`, `m`, `h`, and `d`, and a plain number means seconds.

## Browser

| Flag | Default | Meaning |
| --- | --- | --- |
| `--nbc PATH` | app's `nextctl`, then `nbc` | The CLI that drives the profile. `NBC_BIN` and `NEXTCTL_BIN` are also honored. |
| `--runtime-root DIR` | the app's | Where the app keeps profiles and sessions. `NEXTBROWSER_RUNTIME_ROOT` also works. |
| `--runtime NAME` | profile's own | Passed to nbc as `--runtime`. |
| `--no-start` | starts | Do not start the profile. Fail if it is not running. |
| `--keep-tab` | parks | Leave the last page open instead of `about:blank`. |

## Output

| Flag | Default | Meaning |
| --- | --- | --- |
| `--state FILE` | `~/.nextbrowser/x-monitoring/<profile>.json` | Where the state is kept between runs. |
| `--format text\|json` | text on a terminal, JSON otherwise | The format of stdout. |
| `--verbose` | off | Write the engine's log and every nbc call to stderr as JSON lines. |

Settings given as flags are saved in the state file and apply to later runs too.

In `json` format, stdout carries one object per line:

- every [event](events-and-state.md#events);
- `{"type":"pass","at":…,"summary":{…}}` after each pass;
- `{"type":"error","at":…,"error":"…"}` when the profile would not start. `run` then tries again at the next interval.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Finished, or stopped with <kbd>Ctrl</kbd>+<kbd>C</kbd>. |
| `1` | An error, such as a profile that would not start under `once`, or a bad flag. |
| `2` | No command, or an unknown one. Usage is printed. |
| `3` | `once` found the profile signed out of x.com. |
| `130` | A second <kbd>Ctrl</kbd>+<kbd>C</kbd> while a pass was still finishing. |
