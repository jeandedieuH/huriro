-- 0009_users_visibility_role_scope.sql — keep auth-role user reads context-free (§8.3).
--
-- users_visibility (0004) applies to PUBLIC: its USING qual subqueries
-- memberships, which huriro_auth has no grant on. Postgres evaluates every
-- permissive policy's qual for the querying role, so huriro_auth user lookups
-- (session validation, sign-up) die on "permission denied for table
-- memberships" even though users_auth_access (0005) would pass.
-- Scoping the tenant policy to the roles that actually run tenant queries
-- leaves huriro_auth governed solely by users_auth_access — context-free
-- reads of non-deleted users, exactly as ADR-0003 intends.
-- (huriro_maint is BYPASSRLS — policy lists don't apply to it.)
--
-- Rollback note: ALTER POLICY users_visibility ON users TO PUBLIC;

ALTER POLICY users_visibility ON users TO huriro, huriro_app;
