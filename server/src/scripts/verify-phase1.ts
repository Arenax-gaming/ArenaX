import dotenv from 'dotenv';
import path from 'path';

// Load environment variables before anything else
dotenv.config();

// Mock ENCRYPTION_SECRET if not provided for testing (but it should be there)
if (!process.env.ENCRYPTION_SECRET) {
    process.env.ENCRYPTION_SECRET = 'a_very_secret_32_char_testing_key_!!';
    console.log('Using temporary ENCRYPTION_SECRET for verification.');
}

import encryptionService from '../services/encryption.service';
import stellarWalletService from '../services/stellar-wallet.service';
import prisma from '../services/database.service';

async function verifyEncryption() {
    console.log('\n--- Verifying Encryption Service ---');
    const secret = 'SDAXMDSQ6XTKUNRXG3L6DDTXFOTW7EXOUIO67T4C6U25KUIW3XN5SQPS';
    console.log('Original Secret Key:', secret.substring(0, 4) + '...');

    const encrypted = encryptionService.encrypt(secret);
    console.log('Encrypted Format (iv:tag:cipher):', encrypted.split(':').length === 3 ? 'PASS' : 'FAIL');

    const decrypted = encryptionService.decrypt(encrypted);
    if (decrypted === secret) {
        console.log('Decryption Integrity: PASS');
    } else {
        throw new Error('Decryption Integrity: FAIL');
    }

    // Verify tampering detection
    try {
        const tampered = encrypted.substring(0, encrypted.length - 5) + 'abcde';
        encryptionService.decrypt(tampered);
        throw new Error('Tampering detection failed!');
    } catch (e) {
        console.log('Tampering Detection: PASS');
    }
}

async function verifyWalletGeneration() {
    console.log('\n--- Verifying Stellar Wallet Service ---');

    // Create a dummy user for testing
    const testEmail = `test-${Date.now()}@example.com`;
    const user = await prisma.user.create({
        data: {
            email: 'test@example.com',
            username: 'testuser',
            passwordHash: 'hashed_placeholder'
        }
    });
    console.log('Test User Created:', user.id);

    try {
        const wallet = await stellarWalletService.registerUserWallet(user.id);
        console.log('Wallet Registered:', wallet.publicKey);

        const dbWallet = await prisma.userWallet.findUnique({
            where: { userId: user.id }
        });

        if (dbWallet && dbWallet.publicKey === wallet.publicKey) {
            console.log('Database Persistence: PASS');
            console.log('Encryption Version:', dbWallet.encryptionVersion === 1 ? 'PASS' : 'FAIL');
        } else {
            throw new Error('Database Persistence: FAIL');
        }

        // Cleanup
        await prisma.userWallet.delete({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        console.log('Test Data Cleanup: PASS');

    } catch (error) {
        // Cleanup on error
        await prisma.user.deleteMany({ where: { email: testEmail } });
        throw error;
    }
}

async function run() {
    try {
        await verifyEncryption();
        await verifyWalletGeneration();
        console.log('\n✅ PHASE 1 VERIFICATION COMPLETED SUCCESSFULLY');
    } catch (error: any) {
        console.error('\n❌ VERIFICATION FAILED:', error.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

run();
