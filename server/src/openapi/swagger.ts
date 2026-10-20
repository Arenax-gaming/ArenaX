import swaggerUi from 'swagger-ui-express';
import { Express, Request, Response } from 'express';

/**
 * The shared OpenAPI base definition and source globs live in
 * `openapi.config.js` so `scripts/openapi.js` (which generates and checks the
 * committed `openapi.json`) builds exactly the same spec as the running server.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildSpec } = require('../../openapi.config.js') as { buildSpec: () => object };

const swaggerSpec = buildSpec();

// Swagger UI ships an inline <style> block, which the app-wide Helmet CSP
// (`style-src 'self'`) would strip — relax style-src for the docs page only.
function docsCsp(_req: Request, res: Response, next: () => void): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  );
  next();
}

export function setupSwagger(app: Express, path = '/docs'): void {
  app.use(
    path,
    docsCsp,
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

  // Expose raw OpenAPI spec at /docs.json (and the legacy /api-docs.json)
  app.get(['/docs.json', '/api-docs.json'], (_req, res) => {
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
              "/docs.json",
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