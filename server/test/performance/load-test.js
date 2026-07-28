// k6 Load Test for ArenaX API
// This script performs load testing to measure API performance under normal traffic conditions

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Configuration
export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Ramp up to 200 users
    { duration: '5m', target: 200 },  // Stay at 200 users
    { duration: '2m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% of requests under 500ms, 99% under 1s
    http_req_failed: ['rate<0.01'], // Error rate less than 1%
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3001/api';
const API_TOKEN = __ENV.API_TOKEN || '';

// Helper function to make authenticated requests
function authenticatedRequest(method, endpoint, data = null) {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (API_TOKEN) {
    headers['Authorization'] = `Bearer ${API_TOKEN}`;
  }
  
  const params = {
    headers: headers,
    tags: { name: endpoint },
  };
  
  if (method === 'GET') {
    return http.get(`${BASE_URL}${endpoint}`, params);
  } else if (method === 'POST') {
    return http.post(`${BASE_URL}${endpoint}`, JSON.stringify(data), params);
  } else if (method === 'PUT') {
    return http.put(`${BASE_URL}${endpoint}`, JSON.stringify(data), params);
  } else if (method === 'DELETE') {
    return http.del(`${BASE_URL}${endpoint}`, params);
  }
}

export function setup() {
  // Setup logic - e.g., create test data
  console.log('Starting load test...');
  console.log(`Target: ${BASE_URL}`);
}

export default function () {
  // Test 1: Health check endpoint
  const healthRes = authenticatedRequest('GET', '/health');
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health response time < 100ms': (r) => r.timings.duration < 100,
  }) || errorRate.add(1);

  sleep(1);

  // Test 2: User profile endpoint
  const profileRes = authenticatedRequest('GET', '/users/profile');
  check(profileRes, {
    'profile status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'profile response time < 300ms': (r) => r.timings.duration < 300,
  }) || errorRate.add(1);

  sleep(1);

  // Test 3: Matches list endpoint
  const matchesRes = authenticatedRequest('GET', '/matches');
  check(matchesRes, {
    'matches status is 200': (r) => r.status === 200,
    'matches response time < 500ms': (r) => r.timings.duration < 500,
  }) || errorRate.add(1);

  sleep(1);

  // Test 4: Tournaments endpoint
  const tournamentsRes = authenticatedRequest('GET', '/tournaments');
  check(tournamentsRes, {
    'tournaments status is 200': (r) => r.status === 200,
    'tournaments response time < 500ms': (r) => r.timings.duration < 500,
  }) || errorRate.add(1);

  sleep(1);

  // Test 5: Leaderboard endpoint
  const leaderboardRes = authenticatedRequest('GET', '/leaderboard');
  check(leaderboardRes, {
    'leaderboard status is 200': (r) => r.status === 200,
    'leaderboard response time < 300ms': (r) => r.timings.duration < 300,
  }) || errorRate.add(1);

  sleep(2);
}

export function teardown(data) {
  // Cleanup logic - e.g., remove test data
  console.log('Load test complete');
}
