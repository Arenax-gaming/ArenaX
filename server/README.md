# ArenaX Backend Server

This is the core TypeScript/Express backend for the ArenaX gaming ecosystem. It handles authentication, wallet management, tournament orchestration, and integration with the Stellar/Soroban blockchain.

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18 or later
- **npm**: v9 or later
- **PostgreSQL**: A running instance (local or remote)
- **Redis**: A running instance for matchmaking and real-time updates

### Installation

1. Navigate to the server directory:
   ```bash
   cd server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Configuration

1. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and configure your local environment (Database URL, JWT secrets, Stellar keys, etc.).

### Database Setup

1. Generate the Prisma client:
   ```bash
   npm run prisma:generate
   ```

2. Run migrations to set up your database schema:
   ```bash
   npm run prisma:migrate
   ```

---

## 🛠 Available Scripts

| Script | Description |
| :--- | :--- |
| `npm run dev` | Starts the development server with `ts-node-dev` (auto-reload). |
| `npm run build` | Compiles the TypeScript code to JavaScript in the `/dist` directory. |
| `npm start` | Runs the compiled server from `/dist/app.js`. |
| `npm run prisma:generate` | Generates the Prisma Client. |
| `npm run prisma:migrate` | Runs Prisma migrations for development. |

---

## 📂 Project Structure

- `src/app.ts`: Main entry point and Express configuration.
- `src/routes/`: API endpoint definitions.
- `src/controllers/`: Request handlers and logic orchestration.
- `src/services/`: Core business logic (Blockchain, Matchmaking, Wallets, etc.).
- `src/middleware/`: Express middleware (Auth, Error Handling).
- `prisma/`: Database schema and migrations.

## 📘 Roadmap & Migration

For detailed information on the migration from the legacy Rust backend and the specific feature roadmap, please refer to the [backend_migration_issues.md](../backend_migration_issues.md) in the project root.
