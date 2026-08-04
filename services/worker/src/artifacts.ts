import { Client } from "minio";

const client = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER ?? "weboperator",
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? "changeme123",
});

const BUCKET = process.env.MINIO_BUCKET ?? "weboperator-artifacts";

async function ensureBucket(): Promise<void> {
  const exists = await client.bucketExists(BUCKET).catch(() => false);
  if (exists) return;
  try {
    await client.makeBucket(BUCKET);
  } catch (err) {
    // Tolerate a race where another process created it between our
    // exists-check and this call.
    const nowExists = await client.bucketExists(BUCKET).catch(() => false);
    if (!nowExists) throw err;
  }
}

// Best-effort artifact mirror to S3-compatible storage, on top of (not
// instead of) the local file the caller already wrote. Callers should wrap
// this in stepBestEffort() from steps.ts -- a MinIO hiccup must not fail an
// otherwise-successful automation job.
export async function uploadArtifact(localPath: string, objectName: string): Promise<void> {
  await ensureBucket();
  await client.fPutObject(BUCKET, objectName, localPath);
}
