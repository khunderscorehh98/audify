import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function createR2Storage(config) {
  const { accountId, accessKeyId, secretAccessKey, bucket } = config.r2;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // Newer SDKs add checksum parameters to presigned URLs by default. A browser
    // PUT can't satisfy them, and R2 doesn't support all of them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    presignGet: (key, expiresIn = config.presignGetSeconds) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn }),

    // Signing Content-Type means the browser must send exactly that type.
    presignPut: (key, contentType, expiresIn = config.presignPutSeconds) =>
      getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn, signableHeaders: new Set(['content-type']) },
      ),

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (error.$metadata?.httpStatusCode === 404) return false;
        throw error;
      }
    },

    // S3 delete succeeds for a missing key, so retries are harmless.
    async deleteKey(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    /** Deletes one page under the prefix; returns true when nothing is left. */
    async deletePrefix(prefix) {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
      for (const object of listed.Contents ?? []) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
      }
      return !listed.IsTruncated;
    },
  };
}
