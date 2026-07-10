/**
 * Cloudflare R2 storage helper.
 *
 * R2 is S3-compatible. We use @aws-sdk/client-s3 with the R2 endpoint
 * configured as the S3 endpoint. Images are uploaded with a public
 * read ACL and served via the R2 public bucket URL.
 *
 * Env vars required:
 * - R2_ACCOUNT_ID (derived from endpoint)
 * - R2_ACCESS_KEY_ID
 * - R2_SECRET_ACCESS_KEY
 * - R2_BUCKET_NAME
 * - R2_PUBLIC_BASE_URL (e.g. https://pub-xxx.r2.dev)
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function readEnv(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env) return process.env[name];
  return undefined;
}

const R2_ACCESS_KEY_ID = readEnv("R2_ACCESS_KEY_ID")?.trim();
const R2_SECRET_ACCESS_KEY = readEnv("R2_SECRET_ACCESS_KEY")?.trim();
const R2_ENDPOINT = readEnv("R2_ENDPOINT")?.trim();
const R2_BUCKET_NAME = readEnv("R2_BUCKET_NAME")?.trim() || "teacherpro";
const R2_PUBLIC_BASE_URL = readEnv("R2_PUBLIC_BASE_URL")?.trim();

let s3Client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) return null;
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

/**
 * Check if R2 is configured (all env vars present).
 */
export function isR2Configured(): boolean {
  return Boolean(
    R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT && R2_PUBLIC_BASE_URL,
  );
}

/**
 * Upload an image buffer to R2 and return the public URL.
 *
 * @param key - The object key (e.g. "telegram/exam_page_12345_1.jpg")
 * @param body - The image bytes
 * @param contentType - e.g. "image/jpeg"
 * @returns The public URL, or null if R2 is not configured or upload fails.
 */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    // Build the public URL
    const base = R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
    return `${base}/${key}`;
  } catch (error) {
    console.warn("[R2] upload failed for key", key, error);
    return null;
  }
}

/**
 * Build the public R2 URL for a given key without uploading.
 * Useful for checking if a URL is an R2 URL.
 */
export function r2PublicUrlForKey(key: string): string {
  const base = R2_PUBLIC_BASE_URL?.replace(/\/$/, "") || "";
  return `${base}/${key}`;
}

/**
 * Check if a URL is an R2 public URL.
 */
export function isR2Url(url: string): boolean {
  return Boolean(R2_PUBLIC_BASE_URL && url.startsWith(R2_PUBLIC_BASE_URL));
}

/**
 * Generate a stable R2 key for a Telegram file.
 * Format: telegram/{fileId}.jpg
 */
export function r2KeyForTelegramFile(
  fileId: string,
  ext: string = "jpg",
): string {
  return `telegram/${fileId}.${ext}`;
}
