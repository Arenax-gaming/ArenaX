import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 }, // below normal load
    { duration: '5m', target: 100 },
    { duration: '2m', target: 200 }, // normal load
    { duration: '5m', target: 200 },
    { duration: '2m', target: 300 }, // around the breaking point
    { duration: '5m', target: 300 },
    { duration: '2m', target: 400 }, // beyond the breaking point
    { duration: '5m', target: 400 },
    { duration: '10m', target: 0 }, // scale down. Recovery stage.
  ],
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
  const responses = http.batch([
    ['GET', `${BASE_URL}/api/v1/health`],
    ['GET', `${BASE_URL}/api/v1/tournaments`],
    ['POST', `${BASE_URL}/api/v1/auth/login`, JSON.stringify({
      email: 'test@example.com',
      password: 'password'
    }), { headers: { 'Content-Type': 'application/json' } }],
  ]);

  check(responses[0], {
    'health check status is 200': (r) => r.status === 200,
  });

  check(responses[1], {
    'tournaments status is 200': (r) => r.status === 200,
  });

  check(responses[2], {
    'login status is 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  sleep(1);
}