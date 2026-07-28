// k6 Benchmark Test for ArenaX API
// This script performs performance benchmarking to establish baseline metrics

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Custom metrics for detailed benchmarking
const healthCheckDuration = new Trend('health_check_duration');
const profileDuration = new Trend('profile_duration');
const matchesDuration = new Trend('matches_duration');
const tournamentsDuration = new Trend('tournaments_duration');
const leaderboardDuration = new Trend('leaderboard_duration');
const errorRate = new Rate('errors');

// Configuration
export const options = {
  stages: [
    { duration: '1m', target: 10 },   // Warm up
    { duration: '5m', target: 50 },   // Benchmark at 50 users
    { duration: '5m', target: 50 },   // Sustained load
    { duration: '1m', target: 0 },    // Cool down
  ],
  thresholds: {
    http_req_duration: ['p(50)<200', 'p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
    health_check_duration: ['p(95)<100'],
    profile_duration: ['p(95)<300'],
    matches_duration: ['p(95)<500'],
    tournaments_duration: ['p(95)<500'],
    leaderboard_duration: ['p(95)<300'],
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
  console.log('Starting benchmark test...');
  console.log(`Target: ${BASE_URL}`);
  console.log('This test will establish baseline performance metrics.');
}

export default function () {
  // Benchmark 1: Health check
  const healthStart = new Date();
  const healthRes = authenticatedRequest('GET', '/health');
  healthCheckDuration.add(healthRes.timings.duration);
  
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health response time < 100ms': (r) => r.timings.duration < 100,
  }) || errorRate.add(1);

  sleep(1);

  // Benchmark 2: User profile
  const profileStart = new Date();
  const profileRes = authenticatedRequest('GET', '/users/profile');
  profileDuration.add(profileRes.timings.duration);
  
  check(profileRes, {
    'profile status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'profile response time < 300ms': (r) => r.timings.duration < 300,
  }) || errorRate.add(1);

  sleep(1);

  // Benchmark 3: Matches list
  const matchesStart = new Date();
  const matchesRes = authenticatedRequest('GET', '/matches');
  matchesDuration.add(matchesRes.timings.duration);
  
  check(matchesRes, {
    'matches status is 200': (r) => r.status === 200,
    'matches response time < 500ms': (r) => r.timings.duration < 500,
  }) || errorRate.add(1);

  sleep(1);

  // Benchmark 4: Tournaments
  const tournamentsStart = new Date();
  const tournamentsRes = authenticatedRequest('GET', '/tournaments');
  tournamentsDuration.add(tournamentsRes.timings.duration);
  
  check(tournamentsRes, {
    'tournaments status is 200': (r) => r.status === 200,
    'tournaments response time < 500ms': (r) => r.timings.duration < 500,
  }) || errorRate.add(1);

  sleep(1);

  // Benchmark 5: Leaderboard
  const leaderboardStart = new Date();
  const leaderboardRes = authenticatedRequest('GET', '/leaderboard');
  leaderboardDuration.add(leaderboardRes.timings.duration);
  
  check(leaderboardRes, {
    'leaderboard status is 200': (r) => r.status === 200,
    'leaderboard response time < 300ms': (r) => r.timings.duration < 300,
  }) || errorRate.add(1);

  sleep(2);
}

export function teardown(data) {
  console.log('Benchmark test complete');
  console.log('Review the custom metrics for detailed performance analysis.');
}
