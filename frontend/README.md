# ArenaX Frontend Structure

This frontend follows a consistent Next.js App Router structure with reusable layout and navigation components.

## Folder layout
```
src/
|-- app/                  # App router pages and route groups
|   |-- layout.tsx         # Root layout (ThemeProvider + AppLayout)
|   |-- page.tsx           # Landing page
|   |-- tournaments/       # /tournaments route
|   |-- leaderboard/       # /leaderboard route
|   |-- profile/           # /profile route
|   |-- wallet/            # /wallet route
|   |-- login/             # /login route
|   `-- register/          # /register route
|-- components/
|   |-- layout/            # Global layout and navigation
|   |   |-- AppLayout.tsx
|   |   |-- Navbar.tsx
|   |   `-- MobileNav.tsx
|   |-- ui/                # Reusable UI primitives
|   |   |-- Button.tsx
|   |   |-- Card.tsx
|   |   `-- ThemeToggle.tsx
|   |-- common/            # Shared, domain-agnostic components
|   |   `-- Logo.tsx
|   `-- landing/           # Landing page sections
|-- hooks/
|   `-- useAuth.tsx         # Mock auth state (frontend-only)
|-- lib/
|   `-- routes.ts           # Central navigation config
|-- styles/
|   `-- globals.css         # Tailwind base styles + theme tokens
`-- types/
    `-- index.ts            # Shared type exports
```

## Conventions
- Add new routes under `src/app` and keep layout/navigation inside `src/components/layout`.
- Use `src/lib/routes.ts` to register navigation links instead of hardcoding.
- Reuse UI primitives from `src/components/ui` before creating new components.
- Keep auth state frontend-only unless a backend API is explicitly introduced.
