# Contributing to ArenaX

## Branches

| Pattern | Purpose |
|---|---|
| `main` | Production-ready code |
| `dev` | Integration branch |
| `feat/<name>` | New features |
| `fix/<name>` | Bug fixes |
| `chore/<name>` | Tooling, deps, config |
| `contract/<name>` | Smart contract changes |
| `migration/<name>` | DB schema changes |

All PRs target `dev`. Only `dev` → `main` merges go to production.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(contracts): add match escrow vault dispute resolution
fix(backend): correct varchar/integer comparison in tournament view
chore(deps): bump next to 14.2.25
migration: add governance tables
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `migration`, `contract`

## Development setup

### Backend (Rust)
```bash
cd backend
cp env.example .env          # fill in DATABASE_URL, JWT_SECRET, etc.
cargo sqlx migrate run
cargo build
cargo test
```

### Contracts (Soroban)
```bash
cd contracts
rustup target add wasm32-unknown-unknown
cargo test
cargo build --target wasm32-unknown-unknown --release
```

### Server (TypeScript)
```bash
cd server
npm ci
npm run prisma:generate
npm run build
```

### Frontend (Next.js)
```bash
cd frontend
npm ci
npm run build
```

## Pull requests

- Keep PRs focused — one concern per PR
- All CI checks must pass before merge
- Smart contract changes require two approvals
- DB migrations must include a `.down.sql`
- Never force-push to `main` or `dev`

## Smart contract guidelines

- All public functions must have tests in `test.rs`
- Use `#[contracttype]` for all storage keys
- Bump the contract version constant on any interface change
- Document breaking changes in the PR description

## Database migrations

- Migrations are append-only — never edit an existing migration file
- Test both `up` and `down` migrations locally before opening a PR
- Column/type changes require a multi-step migration (add → backfill → drop)
