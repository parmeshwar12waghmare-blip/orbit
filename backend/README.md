# Orbit People API

Express 5 API backed by PostgreSQL via `pg`. Protected routes verify Supabase JWTs, active company membership, permissions, and company-scoped SQL predicates. Keep `DATABASE_URL` server-side; never put it or a service-role key in the frontend.

## Database setup

1. Create a PostgreSQL database, or a Supabase project, and copy its direct or session-pooler connection string. For Supabase, use the connection details from Project Settings → Database. Ensure the selected connection supports migrations and `pgcrypto`.
2. Copy `.env.example` to `.env`, fill in `DATABASE_URL`, and keep `.env` out of version control.
3. In PowerShell, from the `backend` folder:

```powershell
Copy-Item .env.example .env
# Edit .env and set the real DATABASE_URL before continuing.
npm install
npm run db:migrate
```

Migrations are versioned in `migrations/` and tracked in `schema_migrations`. The runner applies each file once inside a transaction. Files use idempotent DDL where practical. Back up an existing database before the initial migration. This first migration expects an empty schema or a schema without a pre-existing `employees` table. If your database already has the legacy `employees(full_name,email,department,...)` table from the previous API, export and reconcile that data into the new employee columns before applying; migration does not destructively alter or drop it.

Optional reference data (no employee records) can be loaded in Supabase SQL Editor by opening `migrations/seed.example.sql` and running its contents after the migration. It is safe to rerun.

### Supabase SQL Editor alternative

In Supabase Dashboard → SQL Editor → New query, paste and run `migrations/001_employee_onboarding.sql`. Then, if desired, run `migrations/seed.example.sql` as a separate query. SQL Editor does not use the Node migration tracker, so record manually that `001_employee_onboarding.sql` was applied before using the runner. Do not run the runner against a database whose legacy schema has not been reconciled.

### Schema and access model

The migration creates departments, designations, roles, users, employees, onboarding_templates, onboarding_processes, onboarding_tasks, document_types, employee_documents, notifications, audit_logs, offers, employee_addresses, emergency_contacts, employee_education, employee_experience, employee_assets, and task_assignments. UUID foreign keys have explicit delete behavior; employee code/email and account identities are unique; statuses use enums; temporal fields use `timestamptz`/`date`; salary uses `numeric`; onboarding progress is checked to 0–100. `updated_at` is trigger-maintained. Employee deletion is soft deletion through `deleted_at`; document storage references are private object paths, never public URLs.

`migrations/002_multi_tenant_foundation.sql` adds company, membership, permission, invitation, approval, and template-task records and assigns existing records to a `Legacy Workspace` without deleting employee data. Review and back up the database before applying; this workspace has not applied the migration. API queries scope by `company_id`; RLS policies provide additional protection for non-owner roles, but privileged PostgreSQL users can bypass RLS. Manager team-row scope, platform super-admin workflows, document storage, and email delivery are not implemented. Invitation tokens are currently returned for manual delivery. Do not deploy with personal data until those controls are completed and verified.

## Run and API

```powershell
npm run dev
# or
npm start
```

Routes include health and auth identity checks; company registration/profile/locations; employee list/search/create/read/update/soft-deactivate; department and designation read/write; onboarding template, process, task and approval operations; role and permission management; invitations; and audit log reads. Protected requests require `Authorization: Bearer <Supabase access token>` and, for company data, `X-Company-Id: <company UUID>`. Employee list accepts `limit`, `offset`, `q`, `status`, `department_id`, `sort_by`, and `sort_order`. Create requires `employee_code`, `first_name`, `last_name`, `email`, and `joining_date`. See the root README for the route summary.

Example PowerShell health check:

```powershell
Invoke-RestMethod http://localhost:5000/api/health
```

Protected endpoints also require a valid Supabase bearer token and an `X-Company-Id` header; an unauthenticated request to `/api/employees` correctly returns 401.

Required environment variables: `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY`. Optional `PORT`, `FRONTEND_URL`, `PGSSLMODE` (`require` for Supabase, `disable` only for local development), `PGSSL_REJECT_UNAUTHORIZED` (true by default), and `PGPOOL_MAX`. Copy `.env.example` to `.env`; it contains placeholders only. Fix CA trust errors rather than disabling TLS verification. The frontend uses `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`.
