import request from 'supertest';
import { app } from '@/app'; // Assuming Actix-web/Express app is exported
import { testEnv } from '../../infrastructure/TestEnvironment';

describe('Authentication API Integration', () => {
  beforeAll(async () => {
    await testEnv.start();
  });

  afterAll(async () => {
    await testEnv.stop();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'tester',
          email: 'test@arenax.gg',
          password: 'SecurePassword123!'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('token');
    });

    it('should return 400 for invalid email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'tester',
          email: 'invalid-email',
          password: 'pass'
        });
      expect(response.status).toBe(400);
    });
  });
});