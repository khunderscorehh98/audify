// Sends a database dump to the private backups bucket. Used by infra/cron/backup.sh.
import { createReadStream, statSync } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const [file] = process.argv.slice(2);
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET } = process.env;
if (!file || !R2_BACKUP_BUCKET) {
  console.error('Usage: upload-backup.js <file>, with R2_BACKUP_BUCKET set');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const key = `backups/${new Date().toISOString().slice(0, 10)}.sql.gz`;
await client.send(
  new PutObjectCommand({
    Bucket: R2_BACKUP_BUCKET,
    Key: key,
    Body: createReadStream(file),
    ContentLength: statSync(file).size,
    ContentType: 'application/gzip',
  }),
);
console.log(`Backup stored as ${key}`);
