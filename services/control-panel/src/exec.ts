import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ACTIONS, type ActionName } from "./actions.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// services/control-panel/src -> repo root
export const REPO_ROOT = path.resolve(__dirname, "../../..");

export const EXEC_OPTS = { cwd: REPO_ROOT, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 };

export interface ActionResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export async function runAction(name: ActionName): Promise<ActionResult> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", ACTIONS[name], EXEC_OPTS);
    return { ok: true, stdout, stderr };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message: string };
    return {
      ok: false,
      stdout: execErr.stdout ?? "",
      stderr: execErr.stderr ?? "",
      error: execErr.message,
    };
  }
}

export async function composePs(): Promise<string> {
  const { stdout } = await execFileAsync("docker", ["compose", "ps", "--format", "json"], EXEC_OPTS);
  return stdout;
}
