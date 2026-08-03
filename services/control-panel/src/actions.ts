// Fixed allowlist of docker compose invocations. Requests only ever supply a
// key into this table, never argv — there is no path from request input to
// a shell string, so there is no injection surface regardless of what a
// request body contains.
export const ACTIONS = {
  startChrome: ["compose", "up", "-d", "browser-worker-chrome"],
  startFirefox: ["compose", "up", "-d", "browser-worker-firefox"],
  stopChrome: ["compose", "stop", "browser-worker-chrome"],
  stopFirefox: ["compose", "stop", "browser-worker-firefox"],
  runStart: ["compose", "run", "--rm", "worker", "npm", "run", "start"],
  runSave: ["compose", "run", "--rm", "worker", "npm", "run", "save"],
  runRestore: ["compose", "run", "--rm", "worker", "npm", "run", "restore"],
  runAdapter: ["compose", "run", "--rm", "worker", "npm", "run", "adapter"],
  runFirefoxDemo: ["compose", "run", "--rm", "worker-firefox", "npm", "run", "firefox-demo"],
} as const;

export type ActionName = keyof typeof ACTIONS;

export function isActionName(value: string): value is ActionName {
  return Object.prototype.hasOwnProperty.call(ACTIONS, value);
}
