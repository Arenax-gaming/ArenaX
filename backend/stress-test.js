import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Performance Requirement: Validate 10,000+ concurrent users
 */
export const options = {
  stages: [
    { duration: '2m', target: 2000 },  // Ramp up
    { duration: '5m', target: 10000 }, // Stay at 10k users
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'], // 95% of requests must be under 200ms
    http_req_failed: ['rate<0.01'],   // Less than 1% failure rate
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:8080';

export default function () {
  // Simulate match browsing
  const res = http.get(`${BASE_URL}/api/v1/tournaments`);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'body contains tournaments': (r) => r.body.includes('id'),
  });

  // Simulated think time
  sleep(1);
}