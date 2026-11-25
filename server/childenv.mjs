// Variables the server must not pass on to consoles, CLI runs and git calls.
// NODE_ENV and PORT are the app's own: inherited, npm skips devDependencies and dev servers try the app's port.
const STRIP_ENV = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_JOB_DIR$|CLAUDE_PID$|ELECTRON_RUN_AS_NODE$|NODE_ENV$|PORT$)/
export const cleanEnv = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !STRIP_ENV.test(k)))
