import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

const client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
            ? {
                  accessKeyId: process.env.S3_ACCESS_KEY_ID,
                  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
              }
            : undefined,
});

export async function uploadMatchScreenshot(
    matchId: string,
    playerId: string,
    file: { buffer: Buffer; mimetype: string }
): Promise<string> {
    const bucket = process.env.S3_BUCKET;

    if (!bucket) {
        throw new Error('Screenshot storage is not configured: S3_BUCKET is required');
    }

    const extension = file.mimetype === 'image/png' ? 'png' : 'jpg';
    const key = `matches/${matchId}/${playerId}/${randomUUID()}.${extension}`;

    await client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
        })
    );

    const publicBase = process.env.S3_PUBLIC_URL?.replace(/\/$/, '');

    if (publicBase) {
        return `${publicBase}/${key}`;
    }

    const endpoint = process.env.S3_ENDPOINT?.replace(/\/$/, '');

    if (endpoint) {
        return `${endpoint}/${bucket}/${key}`;
    }

    return `https://${bucket}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com/${key}`;
}
