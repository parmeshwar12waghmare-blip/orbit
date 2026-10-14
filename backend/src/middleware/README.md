# Middleware

- `auth.js`: verifies Supabase JWT signature and claims, exposes signed-in user context, and enforces permission keys.
- `company.js`: validates the `X-Company-Id` selection against the caller's active company membership and loads granted permissions.
- `rate-limit.js`: applies in-memory limits to selected sensitive operations; use a shared store before running multiple production instances.

The server mounts auth before company and permission checks. Tenant routes still need explicit company-scoped SQL predicates.
