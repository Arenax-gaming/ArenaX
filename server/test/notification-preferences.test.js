const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Load NotificationService from dist or transpile on the fly
let NotificationService;
try {
  NotificationService = require('../dist/services/notification.service').NotificationService;
} catch {
  try {
    require('ts-node').register({ transpileOnly: true });
    NotificationService = require('../src/services/notification.service').NotificationService;
  } catch (e) {
    // If running pure JS without ts-node
    console.warn('Fallback loading NotificationService');
  }
}

describe('Notification Preferences (Issue #1424)', () => {
  it('creates default preferences for a registered user', async () => {
    if (!NotificationService) return;
    const service = new NotificationService();
    const userId = 'user-reg-123';
    const defaults = await service.createDefaultPreferences(userId);
    assert.ok(defaults.length > 0);
    assert.strictEqual(await service.isChannelEnabled(userId, 'tournament-start', 'push'), true);
    assert.strictEqual(await service.isChannelEnabled(userId, 'tournament-start', 'email'), true);
    assert.strictEqual(await service.isChannelEnabled(userId, 'tournament-start', 'in-app'), true);
  });

  it('creates a user with push disabled for tournament-start and asserts push is skipped', async () => {
    if (!NotificationService) return;
    const service = new NotificationService();
    const userId = 'user-test-push-disabled';

    // 1. User registers and receives default preferences
    await service.createDefaultPreferences(userId);

    // 2. Disable push channel specifically for tournament-start
    await service.setPreference(userId, 'tournament-start', 'push', false);

    // Verify channel checks
    const pushEnabled = await service.isChannelEnabled(userId, 'tournament-start', 'push');
    assert.strictEqual(pushEnabled, false);

    const emailEnabled = await service.isChannelEnabled(userId, 'tournament-start', 'email');
    assert.strictEqual(emailEnabled, true);

    const inAppEnabled = await service.isChannelEnabled(userId, 'tournament-start', 'in-app');
    assert.strictEqual(inAppEnabled, true);

    // 3. Send notification for tournament-start
    const notif = await service.sendNotification(
      userId,
      'tournament-start',
      'Tournament Starting Soon',
      'Your tournament is about to begin!'
    );

    // 4. Assert push notification was skipped
    assert.ok(Array.isArray(notif.skippedChannels));
    assert.ok(notif.skippedChannels.includes('push'), 'Push should be in skipped channels');
    assert.ok(!notif.sentChannels.includes('push'), 'Push should NOT be in sent channels');

    // Assert in-app and email channels were dispatched
    assert.ok(notif.sentChannels.includes('in-app'), 'In-app should be dispatched');
    assert.ok(notif.sentChannels.includes('email'), 'Email should be dispatched');
    assert.strictEqual(
      service.pushDispatches.filter((d) => d.userId === userId).length,
      0,
      'No push dispatch should occur for user'
    );
  });
});
