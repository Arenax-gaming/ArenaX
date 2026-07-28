// k6 Stress Test for ArenaX API
// This script performs stress testing to find API limits and breaking points

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const timeoutRate = new Rate('timeouts');

// Configuration
export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up to 100 users
    { duration: '3m', target: 200 },   // Ramp up to 200 users
    { duration: '3m', target: 500 },   // Ramp up to 500 users
    { duration: '5m', target: 1000 },  // Ramp up to 1000 users (stress level)
    { duration: '5m', target: 2000 },  // Ramp up to 2000 users (extreme stress)
    { duration: '3m', target: 3000 },  // Ramp up to 3000 users (breaking point)
    { duration: '5m', target: 3000 },  // Stay at 3000 users
    { duration: '5m', target: 0 },     // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'], // More lenient thresholds for stress test
    http_req_failed: ['rate<0.05'], // Allow up to 5% errors during stress
    errors: ['rate<0.05'],
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
    timeout: '30s', // Longer timeout for stress test
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
  console.log('Starting stress test...');
  console.log(`Target: ${BASE_URL}`);
  console.log('This test will push the API to its limits.');
}

export default function () {
  // Randomly select endpoints to test
  const endpoints = [
    { method: 'GET', path: '/health', name: 'Health Check' },
    { method: 'GET', path: '/users/profile', name: 'User Profile' },
    { method: 'GET', path: '/matches', name: 'Matches List' },
    { method: 'GET', path: '/tournaments', name: 'Tournaments' },
    { method: 'GET', path: '/leaderboard', name: 'Leaderboard' },
    { method: 'GET', path: '/wallet/balance', name: 'Wallet Balance' },
  ];

  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = authenticatedRequest(endpoint.method, endpoint.path);

  check(res, {
    [`${endpoint.name} status is 200 or 401`]: (r) => r.status === 200 || r.status === 401,
    [`${endpoint.name} response time < 2000ms`]: (r) => r.timings.duration < 2000,
  }) || errorRate.add(1);

  // Check for timeouts
  if (res.status === 0 || res.timings.duration > 30000) {
    timeoutRate.add(1);
  }

  // Random sleep to simulate real user behavior
  sleep(Math.random() * 2 + 0.5);
}

export function teardown(data) {
  console.log('Stress test complete');
  console.log('Review the results to identify breaking points and bottlenecks.');
}
