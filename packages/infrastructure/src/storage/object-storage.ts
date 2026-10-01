import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStorage } from '@atx/application';

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,500}$/;

const assertSafeKey = (key: string): void => {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) throw new Error('Invalid storage key');
};

/** Development/test storage on the local filesystem. Keys can never escape the base directory. */
export const createFilesystemStorage = (baseDirectory: string): ObjectStorage => {
  const root = path.resolve(baseDirectory);
  const resolve = (key: string): string => {
    assertSafeKey(key);
    const full = path.resolve(root, key);
    if (!full.startsWith(`${root}${path.sep}`)) throw new Error('Invalid storage key');
    return full;
  };
  return {
    async put(key, body) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body, { mode: 0o600 });
    },
    async get(key) {
      return new Uint8Array(await readFile(resolve(key)));
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
};

export interface S3StorageOptions {
  readonly bucket: string;
  readonly region: string;
  /** Custom endpoint for S3-compatible stores (MinIO, Ceph, R2). */
  readonly endpoint: string | null;
  readonly forcePathStyle: boolean;
}

/** S3 / S3-compatible object storage. Credentials come from the standard AWS provider chain. */
export const createS3Storage = (options: S3StorageOptions): ObjectStorage => {
  const client = new S3Client({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    forcePathStyle: options.forcePathStyle,
  });
  return {
    async put(key, body, contentType) {
      assertSafeKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: 'AES256',
        }),
      );
    },
    async get(key) {
      assertSafeKey(key);
      const result = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }));
      if (!result.Body) throw new Error('Empty object');
      return result.Body.transformToByteArray();
    },
    async delete(key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
    },
  };
};
