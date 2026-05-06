import express from 'express';

const app = express();

app.use(express.json());

// Mock routes for testing
app.post('/api/v1/auth/register', (req, res) => {
  res.status(201).json({ token: 'mock-token' });
});

app.post('/api/v1/auth/login', (req, res) => {
  res.status(200).json({ token: 'mock-token' });
});

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

export { app };