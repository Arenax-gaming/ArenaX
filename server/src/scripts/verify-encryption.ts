import crypto from 'crypto';
// Mock environment for pure logic test
process.env.ENCRYPTION_SECRET = 'a_very_secret_32_char_testing_key_!!';

import encryptionService from '../services/encryption.service';

function verifyEncryption() {
    console.log('\n--- Verifying Encryption Service (Logic only) ---');
    const secret = 'SDAXMDSQ6XTKUNRXG3L6DDTXFOTW7EXOUIO67T4C6U25KUIW3XN5SQPS';
    console.log('Original Secret Key:', secret.substring(0, 4) + '...');

    const encrypted = encryptionService.encrypt(secret);
    console.log('Encrypted Value Generated:', !!encrypted);

    const parsed = JSON.parse(encrypted);
    if (
        parsed.format !== 'arenax-wallet-v1' ||
        !parsed.iv ||
        !parsed.authTag ||
        !parsed.ciphertext
    ) {
        throw new Error('Encryption format invalid');
    }
    console.log('Format Check (versioned JSON payload): PASS');

    const decrypted = encryptionService.decrypt(encrypted);
    if (decrypted === secret) {
        console.log('Decryption Integrity: PASS');
    } else {
        throw new Error('Decryption Integrity: FAIL. Expected ' + secret + ' but got ' + decrypted);
    }

    // Verify tampering detection
    try {
        const tamperedPayload = JSON.parse(encrypted);
        const cipherBuf = Buffer.from(tamperedPayload.ciphertext, 'base64');
        cipherBuf[0] = cipherBuf[0] ^ 0xFF; // Flip all bits in first byte
        tamperedPayload.ciphertext = cipherBuf.toString('base64');
        const tampered = JSON.stringify(tamperedPayload);
        encryptionService.decrypt(tampered);
        throw new Error('Tampering detection failed! (Ciphertext modification)');
    } catch (e: any) {
        if (e.message === 'Tampering detection failed! (Ciphertext modification)') throw e;
        console.log('Tampering Detection (Ciphertext): PASS');
    }

    try {
        const tamperedPayload = JSON.parse(encrypted);
        const tagBuf = Buffer.from(tamperedPayload.authTag, 'base64');
        tagBuf[0] = tagBuf[0] ^ 0xFF; // Flip all bits in first byte
        tamperedPayload.authTag = tagBuf.toString('base64');
        const tampered = JSON.stringify(tamperedPayload);
        encryptionService.decrypt(tampered);
        throw new Error('Tampering detection failed! (Tag modification)');
    } catch (e: any) {
        if (e.message === 'Tampering detection failed! (Tag modification)') throw e;
        console.log('Tampering Detection (Auth Tag): PASS');
    }
}

try {
    verifyEncryption();
    console.log('\n✅ ENCRYPTION SERVICE IS PRODUCTION READY');
} catch (error: any) {
    console.error('\n❌ ENCRYPTION VERIFICATION FAILED:', error.message);
    process.exit(1);
}
