-- Row-level security for multi-tenant tournament isolation (#1108).
--
-- Defence-in-depth: even if application-layer authorization has a bug, a
-- request scoped to tournament A cannot read or write tournament B's rows
-- at the database level.
--
-- Design notes (this app connects to Postgres as a single pooled role, not
-- one role per request, so a few things are deliberately different from a
-- textbook multi-role RLS setup):
--
--   * Policies are `TO PUBLIC` (every non-superuser role) rather than a
--     named `app_user` role. Naming a specific role here would make this
--     migration fail outright in any environment where that role doesn't
--     already exist; `PUBLIC` is unconditionally safe to apply and still
--     restricts every ordinary connection.
--   * `FORCE ROW LEVEL SECURITY` is set on every table. Without it, Postgres
--     exempts the table owner from RLS — and the migrating role, which owns
--     these tables, is exactly the role the app connects as. Forcing RLS
--     means it actually applies to the app's own connections.
--   * There is no separate Postgres superuser role for platform admins.
--     Bypass is instead a session GUC, `app.is_superadmin`, set alongside
--     `app.tournament_id` by the same middleware — checked in every policy's
--     USING/WITH CHECK clause. A real Postgres superuser still bypasses RLS
--     unconditionally regardless of this flag, per Postgres's own rules.
--   * `matches.tournament_id` is nullable (casual/ranked matches aren't tied
--     to any tournament) — those rows are not tenant data and remain visible
--     to everyone; only tournament-linked matches are scoped.
--   * There is no standalone `disputes` table in this schema — the closest
--     equivalent is `match_disputes`, scoped here via a join back to
--     `matches.tournament_id` since it has no tournament_id column of its own.

CREATE OR REPLACE FUNCTION app_tenant_matches(row_tournament_id UUID) RETURNS BOOLEAN AS $$
    SELECT
        current_setting('app.is_superadmin', true) = 'true'
        OR row_tournament_id IS NULL
        OR row_tournament_id::text = current_setting('app.tournament_id', true)
$$ LANGUAGE sql STABLE;

-- ── tournaments ──────────────────────────────────────────────────────────────
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tournaments;
CREATE POLICY tenant_isolation ON tournaments
    USING (app_tenant_matches(id))
    WITH CHECK (app_tenant_matches(id));

-- ── tournament_participants ──────────────────────────────────────────────────
ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_participants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tournament_participants;
CREATE POLICY tenant_isolation ON tournament_participants
    USING (app_tenant_matches(tournament_id))
    WITH CHECK (app_tenant_matches(tournament_id));

-- ── matches ──────────────────────────────────────────────────────────────────
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON matches;
CREATE POLICY tenant_isolation ON matches
    USING (app_tenant_matches(tournament_id))
    WITH CHECK (app_tenant_matches(tournament_id));

-- ── match_disputes (this schema's "disputes" table) ──────────────────────────
ALTER TABLE match_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_disputes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON match_disputes;
CREATE POLICY tenant_isolation ON match_disputes
    USING (
        current_setting('app.is_superadmin', true) = 'true'
        OR match_id IN (
            SELECT id FROM matches WHERE app_tenant_matches(tournament_id)
        )
    )
    WITH CHECK (
        current_setting('app.is_superadmin', true) = 'true'
        OR match_id IN (
            SELECT id FROM matches WHERE app_tenant_matches(tournament_id)
        )
    );
