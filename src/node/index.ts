// @nextbrowser-oss/x-monitoring/node — running the monitor from Node: a
// browser over the nbc CLI, the state as a file, and the command line.

export {
  AUTOPLAY_POLICY_ARG,
  NbcError,
  appDataDir,
  defaultBinary,
  defaultRuntimeRoot,
  execCli,
  nbcBrowser,
  parseEnvelope,
  runtimeEnv,
  sessionUnavailable,
  type Exec,
  type ExecResult,
  type NbcBrowser,
  type NbcOptions,
} from "./nbc.js";
export { defaultStatePath, loadState, saveState } from "./store.js";
export { describeEvent, main } from "./cli.js";
