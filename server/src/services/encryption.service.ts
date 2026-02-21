import crypto from 'crypto';

class EncryptionService {
    private readonly algorithm = 'aes-256-gcm';
    private readonly key: Buffer;

    constructor() {
        const secret = process.env.ENCRYPTION_SECRET;
        if (!secret) {
            console.error('CRITICAL ERROR: ENCRYPTION_SECRET is missing from environment variables.');
            process.exit(1);
        }

        // Derive 32-byte key from secret using SHA-256
        this.key = crypto.createHash('sha256').update(secret).digest();
    }

    /**
     * Encrypts plain text using AES-256-GCM.
     * Returns a colon-separated string: iv:authTag:ciphertext (base64)
     */
    encrypt(plainText: string): string {
        try {
            const iv = crypto.randomBytes(12); // GCM standard IV size
            const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

            let encrypted = cipher.update(plainText, 'utf8', 'base64');
            encrypted += cipher.final('base64');

            const authTag = cipher.getAuthTag().toString('base64');

            return `${iv.toString('base64')}:${authTag}:${encrypted}`;
        } catch (error: any) {
            console.error('Encryption failed:', this.maskError(error));
            throw new Error('Encryption process failed securely.');
        }
    }

    /**
     * Decrypts a colon-separated string: iv:authTag:ciphertext (base64)
     * Throws if authentication fails via decipher.final().
     */
    decrypt(encryptedData: string): string {
        try {
            const [ivBase64, authTagBase64, ciphertextBase64] = encryptedData.split(':');

            if (!ivBase64 || !authTagBase64 || !ciphertextBase64) {
                throw new Error('Invalid encrypted data format.');
            }

            const iv = Buffer.from(ivBase64, 'base64');
            const authTag = Buffer.from(authTagBase64, 'base64');
            const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);

            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(ciphertextBase64, 'base64', 'utf8');

            // decipher.final() will throw if the auth tag is invalid
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error: any) {
            console.error('Decryption failed:', this.maskError(error));
            throw new Error('Decryption process failed or data was tampered with.');
        }
    }

    /**
     * Minimal helper to ensure no sensitive info leaks in logs.
     */
    private maskError(error: any): string {
        // Redact any potential secret indicators from error messages
        return error?.message?.replace(/S[A-Z2-7]{55}/g, '[REDACTED_KEY]') || 'Internal cryptographic error';
    }
}

export default new EncryptionService();
