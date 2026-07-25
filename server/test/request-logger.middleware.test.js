const assert = require('node:assert');
const { describe, it } = require('node:test');

const { sanitizeData, sanitizeHeaders } = require('../dist/middleware/request-logger.middleware.js');

describe('Request Logger Middleware', () => {
  it('should mask sensitive fields in objects and nested structures', () => {
    const input = {
      username: 'player1',
      password: 'SuperSecretPassword123',
      nested: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        creditCard: '4111111111111111',
        safeField: 'hello',
      },
    };

    const sanitized = sanitizeData(input);

    assert.strictEqual(sanitized.username, 'player1');
    assert.strictEqual(sanitized.password, '[REDACTED]');
    assert.strictEqual(sanitized.nested.token, '[REDACTED]');
    assert.strictEqual(sanitized.nested.creditCard, '[REDACTED]');
    assert.strictEqual(sanitized.nested.safeField, 'hello');
  });

  it('should mask sensitive headers', () => {
    const headers = {
      'content-type': 'application/json',
      'authorization': 'Bearer secret-token-123',
      'x-api-key': 'secret-api-key',
      'user-agent': 'Mozilla/5.0',
    };

    const sanitized = sanitizeHeaders(headers);

    assert.strictEqual(sanitized['content-type'], 'application/json');
    assert.strictEqual(sanitized['authorization'], '[REDACTED]');
    assert.strictEqual(sanitized['x-api-key'], '[REDACTED]');
    assert.strictEqual(sanitized['user-agent'], 'Mozilla/5.0');
  });
});
