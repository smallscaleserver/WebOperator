// Fixed allowlist of docker compose invocations. Requests only ever supply a
// key into this table, never argv — there is no path from request input to
// a shell string, so there is no injection surface regardless of what a
// request body contains.
// "demo" and "adapter" retired from here -- the Control Panel now runs
// them as workflows ("demo"/"the-internet-login") instead of a fixed
// docker-compose invocation; the underlying npm scripts
// (services/worker: `npm run start`/`npm run adapter`) still exist and
// still work directly via CLI, just no longer routed through this table.
export const ACTIONS = {
  startChrome: ["compose", "up", "-d", "browser-worker-chrome"],
  startFirefox: ["compose", "up", "-d", "browser-worker-firefox"],
  stopChrome: ["compose", "stop", "browser-worker-chrome"],
  stopFirefox: ["compose", "stop", "browser-worker-firefox"],
  runSave: ["compose", "run", "--rm", "worker", "npm", "run", "save"],
  runRestore: ["compose", "run", "--rm", "worker", "npm", "run", "restore"],
  runFirefoxDemo: ["compose", "run", "--rm", "worker-firefox", "npm", "run", "firefox-demo"],
} as const;

export type ActionName = keyof typeof ACTIONS;

export function isActionName(value: string): value is ActionName {
  return Object.prototype.hasOwnProperty.call(ACTIONS, value);
}
