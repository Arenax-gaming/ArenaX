import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express, Request, Response } from 'express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ArenaX API',
      version: '1.0.0',
      description: `
ArenaX Gaming Platform API — comprehensive endpoints for match management,
tournaments, user profiles, wallets, governance, and blockchain interactions.

## Authentication
Most endpoints require a Bearer JWT token in the Authorization header.
\`\`\`
Authorization: Bearer <token>
\`\`\`

## Rate Limiting
API requests are rate-limited using Token Bucket algorithm. Limits vary by endpoint type:
- Auth endpoints: 5 req/min
- Payment endpoints: 10 req/min
- Game actions: 30 req/min
- General API: 100 req/min

Rate limit headers are returned with every response.
      `,
      contact: {
        name: 'ArenaX Support',
        url: 'https://arenax.gg/support',
        email: 'support@arenax.gg',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001/api',
        description: 'Development server',
      },
      {
        url: 'https://api.arenax.gg/api',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'API key for public endpoints',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        RateLimitError: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Rate limit exceeded' },
            code: { type: 'string', example: 'TOKEN_BUCKET_RATE_LIMIT' },
            retryAfter: { type: 'integer', example: 12 },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Users', description: 'User profile management' },
      { name: 'Matches', description: 'Match operations' },
      { name: 'Tournaments', description: 'Tournament management' },
      { name: 'Wallet', description: 'Wallet and payment operations' },
      { name: 'Governance', description: 'DAO governance proposals' },
      { name: 'Admin', description: 'Admin-only operations' },
      { name: 'Leaderboard', description: 'Leaderboard queries' },
      { name: 'Health', description: 'Health check endpoints' },
    ],
  },
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'],
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: Express, path = '/api-docs'): void {
  app.use(
    path,
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      customSiteTitle: 'ArenaX API Documentation',
      customfavIcon: '/favicon.ico',
      swaggerOptions: {
        docExpansion: 'list',
        filter: true,
        showRequestDuration: true,
        persistAuthorization: true,
      },
    })
  );

  // Expose raw OpenAPI spec at /api-docs.json
  app.get('/api-docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  console.log(`[Swagger] API docs available at ${path}`);
}

// Setup Redoc for beautiful API documentation
export function setupRedoc(app: Express, path = '/redoc'): void {
  app.get(path, (_req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>ArenaX API Documentation</title>
          <meta charset="utf-8"/>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
          <style>
            body {
              margin: 0;
              padding: 0;
            }
            .redoc-container {
              display: flex;
              height: 100vh;
            }
          </style>
        </head>
        <body>
          <div id="redoc" class="redoc-container"></div>
          <script src="https://cdn.jsdelivr.net/npm/redoc@2.0.0/bundles/redoc.standalone.js"></script>
          <script>
            Redoc.init(
              "/api-docs.json",
              {
                theme: {
                  colors: {
                    primary: {
                      main: '#3b82f6'
                    },
                    success: {
                      main: '#10b981'
                    },
                    warning: {
                      main: '#f59e0b'
                    },
                    error: {
                      main: '#ef4444'
                    }
                  },
                  typography: {
                    fontFamily: 'Montserrat, Arial, sans-serif',
                    fontSize: '14px',
                    lineHeight: '1.5'
                  },
                  sidebar: {
                    backgroundColor: '#1e293b',
                    textColor: '#f1f5f9',
                    activeTextColor: '#3b82f6'
                  }
                },
                scrollYOffset: 60,
                hideHostname: true,
                expandResponses: '200,201',
                requiredPropsFirst: true,
                noAutoAuth: false,
                pathInMiddlePanel: true,
                jsonSampleExpandLevel: 2
              },
              document.getElementById('redoc')
            );
          </script>
        </body>
      </html>
    `);
  });

  console.log(`[Redoc] API docs available at ${path}`);
}

export { swaggerSpec, swaggerUi };