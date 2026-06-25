import { Router, Request, Response } from 'express';
import { metricsService } from '../services/metrics.service';
import { logger } from '../services/logger.service';

const router: Router = Router();

// Serve the metrics dashboard HTML
router.get('/', (_req: Request, res: Response) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ArenaX Metrics Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            color: white;
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.5rem;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .card {
            background: white;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            transition: transform 0.2s;
        }
        .card:hover {
            transform: translateY(-2px);
        }
        .card h2 {
            color: #333;
            margin-bottom: 16px;
            font-size: 1.25rem;
            border-bottom: 2px solid #667eea;
            padding-bottom: 8px;
        }
        .metric {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid #eee;
        }
        .metric:last-child {
            border-bottom: none;
        }
        .metric-label {
            color: #666;
            font-weight: 500;
        }
        .metric-value {
            color: #333;
            font-weight: bold;
            font-size: 1.1rem;
        }
        .metric-value.success {
            color: #10b981;
        }
        .metric-value.warning {
            color: #f59e0b;
        }
        .metric-value.error {
            color: #ef4444;
        }
        .refresh-btn {
            background: white;
            color: #667eea;
            border: 2px solid #667eea;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.2s;
            margin: 20px auto;
            display: block;
        }
        .refresh-btn:hover {
            background: #667eea;
            color: white;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.875rem;
            font-weight: 600;
        }
        .status-badge.online {
            background: #10b981;
            color: white;
        }
        .status-badge.offline {
            background: #ef4444;
            color: white;
        }
        .loading {
            text-align: center;
            color: white;
            font-size: 1.2rem;
            margin: 40px 0;
        }
        .error {
            background: #fee2e2;
            color: #991b1b;
            padding: 16px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .last-updated {
            text-align: center;
            color: white;
            margin-top: 20px;
            font-size: 0.9rem;
            opacity: 0.9;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 ArenaX Metrics Dashboard</h1>
        <div id="loading" class="loading">Loading metrics...</div>
        <div id="error" class="error" style="display: none;"></div>
        <div id="dashboard" style="display: none;">
            <div class="grid">
                <div class="card">
                    <h2>📊 HTTP Requests</h2>
                    <div class="metric">
                        <span class="metric-label">Total Requests</span>
                        <span class="metric-value" id="http-total">0</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">2xx Responses</span>
                        <span class="metric-value success" id="http-2xx">0</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">4xx Responses</span>
                        <span class="metric-value warning" id="http-4xx">0</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">5xx Responses</span>
                        <span class="metric-value error" id="http-5xx">0</span>
                    </div>
                </div>
                <div class="card">
                    <h2>🗄️ Database Queries</h2>
                    <div class="metric">
                        <span class="metric-label">Total Queries</span>
                        <span class="metric-value" id="db-total">0</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Success Rate</span>
                        <span class="metric-value success" id="db-success">0%</span>
                    </div>
                </div>
                <div class="card">
                    <h2>⚠️ Errors</h2>
                    <div class="metric">
                        <span class="metric-label">Total Errors</span>
                        <span class="metric-value error" id="errors-total">0</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Critical</span>
                        <span class="metric-value error" id="errors-critical">0</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">High</span>
                        <span class="metric-value warning" id="errors-high">0</span>
                    </div>
                </div>
                <div class="card">
                    <h2>🔗 Connections</h2>
                    <div class="metric">
                        <span class="metric-label">Active Connections</span>
                        <span class="metric-value" id="connections">0</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Status</span>
                        <span class="status-badge online" id="status">Online</span>
                    </div>
                </div>
            </div>
            <button class="refresh-btn" onclick="loadMetrics()">🔄 Refresh Metrics</button>
            <div class="last-updated" id="last-updated">Last updated: Never</div>
        </div>
    </div>

    <script>
        async function loadMetrics() {
            const loading = document.getElementById('loading');
            const error = document.getElementById('error');
            const dashboard = document.getElementById('dashboard');
            
            loading.style.display = 'block';
            error.style.display = 'none';
            dashboard.style.display = 'none';

            try {
                const response = await fetch('/api/metrics/summary');
                if (!response.ok) throw new Error('Failed to fetch metrics');
                
                const data = await response.json();
                
                // Update HTTP metrics
                document.getElementById('http-total').textContent = data.httpRequests.total.toLocaleString();
                document.getElementById('http-2xx').textContent = (data.httpRequests.byStatus['2'] || 0).toLocaleString();
                document.getElementById('http-4xx').textContent = (data.httpRequests.byStatus['4'] || 0).toLocaleString();
                document.getElementById('http-5xx').textContent = (data.httpRequests.byStatus['5'] || 0).toLocaleString();
                
                // Update DB metrics
                document.getElementById('db-total').textContent = data.dbQueries.total.toLocaleString();
                const successRate = data.dbQueries.total > 0 
                    ? ((data.dbQueries.byTable?.success || 0) / data.dbQueries.total * 100).toFixed(1)
                    : '100';
                document.getElementById('db-success').textContent = successRate + '%';
                
                // Update error metrics
                document.getElementById('errors-total').textContent = data.errors.total.toLocaleString();
                document.getElementById('errors-critical').textContent = (data.errors.bySeverity?.critical || 0).toLocaleString();
                document.getElementById('errors-high').textContent = (data.errors.bySeverity?.high || 0).toLocaleString();
                
                // Update connections
                document.getElementById('connections').textContent = data.activeConnections.toLocaleString();
                
                loading.style.display = 'none';
                dashboard.style.display = 'block';
                document.getElementById('last-updated').textContent = 'Last updated: ' + new Date().toLocaleString();
                
            } catch (err) {
                loading.style.display = 'none';
                error.style.display = 'block';
                error.textContent = 'Error loading metrics: ' + err.message;
            }
        }

        // Load metrics on page load
        loadMetrics();
        
        // Auto-refresh every 30 seconds
        setInterval(loadMetrics, 30000);
    </script>
</body>
</html>
  `);
});

export default router;
