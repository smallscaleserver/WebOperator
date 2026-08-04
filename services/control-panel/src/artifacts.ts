import { Client } from "minio";
import type { Readable } from "node:stream";

const client = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER ?? "weboperator",
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? "changeme123",
});

const BUCKET = process.env.MINIO_BUCKET ?? "weboperator-artifacts";

export async function getArtifactStream(objectName: string): Promise<Readable> {
  return client.getObject(BUCKET, objectName);
}

// Used by the XC Bank monitor's screenshot retention (keep only the 200
// most recent) -- best-effort by design, same posture as archival
// itself: a MinIO outage must not block retention from at least
// cleaning up the local copy.
export async function removeArtifact(objectName: string): Promise<void> {
  await client.removeObject(BUCKET, objectName);
}
