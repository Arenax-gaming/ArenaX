-- Drop tournament row-level security (#1108)

DROP POLICY IF EXISTS tenant_isolation ON match_disputes;
ALTER TABLE match_disputes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE match_disputes DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON matches;
ALTER TABLE matches NO FORCE ROW LEVEL SECURITY;
ALTER TABLE matches DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tournament_participants;
ALTER TABLE tournament_participants NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tournament_participants DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tournaments;
ALTER TABLE tournaments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tournaments DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS app_tenant_matches(UUID);
