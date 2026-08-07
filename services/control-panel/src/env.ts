import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The two host processes (src/server.ts, src/worker.ts) previously
// never actually loaded .env -- every process.env.X read elsewhere in
// this project just fell through to its hardcoded default (e.g.
// artifacts.ts's MINIO_ROOT_USER), which happened to match
// .env.example's own default, masking the gap. docker-compose loads
// .env on its own (a built-in feature) for the containerized
// services, but these two are plain host `npm start`/`npm run worker`
// processes -- they need this explicit load. Imported first, before
// anything else reads process.env, in both entry points.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// services/control-panel/src -> repo root
const REPO_ROOT = path.resolve(__dirname, "../../..");

config({ path: path.join(REPO_ROOT, ".env") });
