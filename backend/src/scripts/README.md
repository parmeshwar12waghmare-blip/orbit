# Backend scripts

- `migrate.js`: reads SQL migrations in order and records applied versions in `schema_migrations`.
- `seed.js`: loads optional example reference data.

Run via package scripts from `backend/`: `npm run db:migrate` or `npm run db:seed`. Back up and review the target database before migrations.
