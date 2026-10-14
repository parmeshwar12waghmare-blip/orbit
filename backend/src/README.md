# Backend source map

`server.js` assembles Express, security middleware, CORS, public health/auth routes, and protected tenant route groups. `config/` owns shared infrastructure such as the PostgreSQL connection pool. `middleware/` verifies Supabase identity, company membership and permissions, plus basic rate limits. `routes/` contains endpoint handlers grouped by domain. `scripts/` contains operational database migration and seed commands.

Request path: browser bearer token → JWT verification → selected company membership → permission gate → SQL using explicit `company_id` predicates → audit record where applicable. See the root README for the client/API/DB relationship.
