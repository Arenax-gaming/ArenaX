import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.service';

/** Expiry (seconds) for signed private-asset URLs (#1570). */
export const SIGNED_URL_EXPIRY_SECONDS = 3600;

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

/**
 * Derive the S3 object key from a URL previously returned by
 * `uploadMatchScreenshot` (public-base, endpoint-based, or raw bucket URL).
 * Returns `null` if the URL does not reference an object in the configured
 * bucket (e.g. it is already a fully external/public asset).
 */
export function extractAssetKey(assetUrl: string): string | null {
    const bucket = process.env.S3_BUCKET;

    const candidates = [
        process.env.S3_PUBLIC_URL?.replace(/\/$/, ''),
        process.env.S3_ENDPOINT && bucket
            ? `${process.env.S3_ENDPOINT.replace(/\/$/, '')}/${bucket}`
            : undefined,
        bucket ? `https://${bucket}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com` : undefined,
    ].filter(Boolean) as string[];

    for (const base of candidates) {
        if (assetUrl.startsWith(`${base}/`)) {
            return assetUrl.slice(base.length + 1);
        }
    }

    return null;
}

/**
 * Generate a short-lived signed URL for private asset access (evidence
 * files, replay data, etc.) rather than exposing the object via a public
 * S3 URL. Defaults to a 1-hour expiry (#1570).
 *
 * Callers are responsible for verifying the requesting user is permitted to
 * access `key` *before* calling this — this function performs no
 * authorization check of its own.
 */
export async function generateSignedAssetUrl(
    key: string,
    options: { userId: string; expirySeconds?: number }
): Promise<{ url: string; expiresAt: Date }> {
    const bucket = process.env.S3_BUCKET;

    if (!bucket) {
        throw new Error('Asset storage is not configured: S3_BUCKET is required');
    }

    const expirySeconds = options.expirySeconds ?? SIGNED_URL_EXPIRY_SECONDS;

    const url = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: expirySeconds }
    );

    const expiresAt = new Date(Date.now() + expirySeconds * 1000);

    logger.info('Signed asset URL generated', {
        assetKey: key,
        userId: options.userId,
        expiresAt: expiresAt.toISOString(),
    });

    return { url, expiresAt };
}
