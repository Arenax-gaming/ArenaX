import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const GCM_IV_BYTES = 12;
const KEY_LENGTH = 32;

interface ConfiguredMasterKey {
    version: number;
    key: Buffer;
}

interface EncryptedPayload {
    format: 'arenax-wallet-v1';
    algorithm: typeof ALGORITHM;
    keyVersion: number;
    iv: string;
    authTag: string;
    ciphertext: string;
}

export interface DecryptionResult {
    plainText: string;
    keyVersion: number;
    usedLegacyFormat: boolean;
}

const isEncryptedPayload = (value: unknown): value is EncryptedPayload => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const payload = value as Record<string, unknown>;
    return (
        payload.format === 'arenax-wallet-v1' &&
        payload.algorithm === ALGORITHM &&
        typeof payload.keyVersion === 'number' &&
        typeof payload.iv === 'string' &&
        typeof payload.authTag === 'string' &&
        typeof payload.ciphertext === 'string'
    );
};

const deriveKey = (secret: string, version: number): Buffer =>
    crypto.scryptSync(secret, `arenax-wallet-master-key:v${version}`, KEY_LENGTH);

const toBase64 = (value: Buffer): string => value.toString('base64');

class EncryptionService {
    private readonly algorithm = ALGORITHM;
    private readonly masterKeys = new Map<number, Buffer>();
    private readonly activeKeyVersion: number;

    constructor() {
        const configuredKeys = this.loadConfiguredKeys();
        configuredKeys.forEach((entry) => {
            this.masterKeys.set(entry.version, entry.key);
        });

        if (configuredKeys.length === 0) {
            throw new Error(
                'Wallet encryption master keys are not configured. Set WALLET_MASTER_KEYS or ENCRYPTION_SECRET.'
            );
        }

        const configuredActiveVersion = process.env.WALLET_ACTIVE_MASTER_KEY_VERSION
            ? Number(process.env.WALLET_ACTIVE_MASTER_KEY_VERSION)
            : null;
        const fallbackVersion = Math.max(...configuredKeys.map((entry) => entry.version));
        const activeVersion = configuredActiveVersion ?? fallbackVersion;

        if (!Number.isInteger(activeVersion) || !this.masterKeys.has(activeVersion)) {
            throw new Error(
                'WALLET_ACTIVE_MASTER_KEY_VERSION must reference a configured wallet master key version.'
            );
        }

        this.activeKeyVersion = activeVersion;
    }

    encrypt(plainText: string, keyVersion = this.activeKeyVersion): string {
        const key = this.getKeyByVersion(keyVersion);
        const iv = crypto.randomBytes(GCM_IV_BYTES);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);

        const ciphertext = Buffer.concat([
            cipher.update(Buffer.from(plainText, 'utf8')),
            cipher.final()
        ]);

        const payload: EncryptedPayload = {
            format: 'arenax-wallet-v1',
            algorithm: this.algorithm,
            keyVersion,
            iv: toBase64(iv),
            authTag: toBase64(cipher.getAuthTag()),
            ciphertext: toBase64(ciphertext)
        };

        return JSON.stringify(payload);
    }

    decrypt(encryptedData: string): string {
        return this.decryptWithMetadata(encryptedData).plainText;
    }

    decryptWithMetadata(encryptedData: string): DecryptionResult {
        try {
            const parsedPayload = this.tryParsePayload(encryptedData);
            if (parsedPayload) {
                return {
                    plainText: this.decryptPayload(parsedPayload),
                    keyVersion: parsedPayload.keyVersion,
                    usedLegacyFormat: false
                };
            }

            return {
                plainText: this.decryptLegacyPayload(encryptedData),
                keyVersion: 1,
                usedLegacyFormat: true
            };
        } catch (error) {
            throw new Error(this.maskError(error));
        }
    }

    needsRotation(encryptedData: string): boolean {
        try {
            const payload = this.tryParsePayload(encryptedData);
            if (!payload) {
                return true;
            }

            return payload.keyVersion !== this.activeKeyVersion;
        } catch {
            return true;
        }
    }

    rotate(encryptedData: string): { encrypted: string; previousVersion: number; keyVersion: number } {
        const decrypted = this.decryptWithMetadata(encryptedData);
        return {
            encrypted: this.encrypt(decrypted.plainText, this.activeKeyVersion),
            previousVersion: decrypted.keyVersion,
            keyVersion: this.activeKeyVersion
        };
    }

    getActiveKeyVersion(): number {
        return this.activeKeyVersion;
    }

    private tryParsePayload(encryptedData: string): EncryptedPayload | null {
        try {
            const parsed = JSON.parse(encryptedData);
            return isEncryptedPayload(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    private decryptPayload(payload: EncryptedPayload): string {
        const decipher = crypto.createDecipheriv(
            this.algorithm,
            this.getKeyByVersion(payload.keyVersion),
            Buffer.from(payload.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

        return Buffer.concat([
            decipher.update(Buffer.from(payload.ciphertext, 'base64')),
            decipher.final()
        ]).toString('utf8');
    }

    private decryptLegacyPayload(encryptedData: string): string {
        const legacySecret = process.env.ENCRYPTION_SECRET;
        if (!legacySecret) {
            throw new Error(
                'Legacy encrypted wallet secret encountered but ENCRYPTION_SECRET is unavailable.'
            );
        }

        const [ivBase64, authTagBase64, ciphertextBase64] = encryptedData.split(':');
        if (!ivBase64 || !authTagBase64 || !ciphertextBase64) {
            throw new Error('Invalid encrypted wallet payload format.');
        }

        const decipher = crypto.createDecipheriv(
            this.algorithm,
            deriveKey(legacySecret, 1),
            Buffer.from(ivBase64, 'base64')
        );
        decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));

        return Buffer.concat([
            decipher.update(Buffer.from(ciphertextBase64, 'base64')),
            decipher.final()
        ]).toString('utf8');
    }

    private getKeyByVersion(version: number): Buffer {
        const key = this.masterKeys.get(version);
        if (!key) {
            throw new Error(`Wallet master key version ${version} is not configured.`);
        }

        return key;
    }

    private loadConfiguredKeys(): ConfiguredMasterKey[] {
        const configuredFromJson = process.env.WALLET_MASTER_KEYS;
        if (configuredFromJson) {
            const parsed = JSON.parse(configuredFromJson) as Array<{
                version: number;
                secret: string;
            }>;

            return parsed.map((entry) => ({
                version: entry.version,
                key: deriveKey(entry.secret, entry.version)
            }));
        }

        const legacySecret = process.env.ENCRYPTION_SECRET;
        if (!legacySecret) {
            return [];
        }

        return [
            {
                version: 1,
                key: deriveKey(legacySecret, 1)
            }
        ];
    }

    private maskError(error: unknown): string {
        const message =
            error instanceof Error ? error.message : 'Wallet cryptography operation failed';
        return message.replace(/S[A-Z2-7]{55}/g, '[REDACTED_STELLAR_SECRET]');
    }
}

export { EncryptionService };

export default new EncryptionService();
