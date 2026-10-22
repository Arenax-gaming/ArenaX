const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
    'test-secret-should-be-long-enough-for-hs256-validation-12345';
process.env.ACCESS_TOKEN_TTL = '15m';
process.env.REFRESH_TOKEN_TTL = '7d';

const {
    enroll2FA,
    verifyAndEnable2FA,
    loginUser,
    login2FA,
    computeTotpCode,
    base32Decode,
    base32Encode,
    verifyTotpCode,
    getTwoFactorData
} = require('../dist/services/auth.service');
const { setDatabaseClientForTesting } = require('../dist/services/database.service');

test('Two-Factor Authentication (TOTP) flow: enroll, verify, 2-step login, backup codes (#1431)', async (t) => {
    const users = [];
    const refreshTokens = [];

    const mockPrisma = {
        user: {
            findUnique: async ({ where }) => {
                if (where.id) {
                    return users.find((u) => u.id === where.id) || null;
                }
                if (where.email) {
                    return users.find((u) => u.email === where.email) || null;
                }
                return null;
            },
            create: async ({ data }) => {
                const user = { ...data, id: 'user-2fa-1' };
                users.push(user);
                return user;
            }
        },
        refreshToken: {
            create: async ({ data }) => {
                const record = { ...data, id: 'token-1' };
                refreshTokens.push(record);
                return record;
            }
        }
    };

    setDatabaseClientForTesting(mockPrisma);

    const passwordHash = await bcrypt.hash('SecretPassword123!', 10);
    const testUser = {
        id: 'user-2fa-1',
        email: 'player@arenax.gg',
        username: 'player2fa',
        passwordHash,
        role: 'USER',
        isVerified: true,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    users.push(testUser);

    // 1. Initial login before 2FA is enabled should succeed directly
    const directLogin = await loginUser({
        email: 'player@arenax.gg',
        password: 'SecretPassword123!'
    });
    assert.equal(directLogin.requires2FA, undefined);
    assert.ok(directLogin.tokens.accessToken);

    // 2. Enroll 2FA
    const enrollResult = await enroll2FA(testUser.id);
    assert.ok(enrollResult.secret, 'Must generate TOTP secret');
    assert.ok(enrollResult.uri.startsWith('otpauth://totp/'), 'Must return valid otpauth URI');
    assert.ok(enrollResult.uri.includes('player%40arenax.gg') || enrollResult.uri.includes('player@arenax.gg'));

    // 3. Verify with an invalid code should fail
    await assert.rejects(
        () => verifyAndEnable2FA(testUser.id, '000000'),
        /Invalid 6-digit TOTP code/
    );

    // 4. Verify with valid TOTP code enables 2FA and generates backup codes
    const currentCounter = Math.floor(Date.now() / 1000 / 30);
    const validCode = computeTotpCode(enrollResult.secret, currentCounter);
    const verifyResult = await verifyAndEnable2FA(testUser.id, validCode);

    assert.equal(verifyResult.enabled, true);
    assert.ok(Array.isArray(verifyResult.backupCodes));
    assert.equal(verifyResult.backupCodes.length, 8);
    const backupCodeToUse = verifyResult.backupCodes[0];

    // 5. Login now requires a second step submitting a TOTP code
    const stepOneLogin = await loginUser({
        email: 'player@arenax.gg',
        password: 'SecretPassword123!'
    });
    assert.equal(stepOneLogin.requires2FA, true, 'Second step must be required for 2FA user');
    assert.ok(stepOneLogin.tempToken, 'Must provide tempToken for step two');
    assert.equal(stepOneLogin.tokens, undefined, 'Tokens must not be issued in step one');

    // 6. Step two login with invalid code should fail
    await assert.rejects(
        () => login2FA({ tempToken: stepOneLogin.tempToken, code: '123456' }),
        /Invalid 2FA code/
    );

    // 7. Step two login with valid TOTP code succeeds
    const codeForLogin = computeTotpCode(enrollResult.secret, Math.floor(Date.now() / 1000 / 30));
    const stepTwoLogin = await login2FA({
        tempToken: stepOneLogin.tempToken,
        code: codeForLogin
    });
    assert.ok(stepTwoLogin.tokens.accessToken, 'Must return accessToken after valid 2FA step two');
    assert.equal(stepTwoLogin.user.id, testUser.id);

    // 8. Test backup code recovery
    const backupStepOne = await loginUser({
        email: 'player@arenax.gg',
        password: 'SecretPassword123!'
    });
    assert.equal(backupStepOne.requires2FA, true);

    const backupStepTwo = await login2FA({
        tempToken: backupStepOne.tempToken,
        code: backupCodeToUse
    });
    assert.ok(backupStepTwo.tokens.accessToken, 'Backup code must succeed for 2FA login');

    // 9. Reusing the same backup code must fail (used once each)
    const reuseStepOne = await loginUser({
        email: 'player@arenax.gg',
        password: 'SecretPassword123!'
    });
    await assert.rejects(
        () => login2FA({ tempToken: reuseStepOne.tempToken, code: backupCodeToUse }),
        /Invalid 2FA code/,
        'Used backup code cannot be reused'
    );
});
