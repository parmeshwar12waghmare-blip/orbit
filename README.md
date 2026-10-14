# Orbit People

Orbit People is a React, TypeScript, Vite, and Tailwind web client backed by an Express API and PostgreSQL. Start with this file to navigate the source without scanning dependencies or generated output.

## Project map

| Directory | Responsibility | Current state |
| --- | --- | --- |
| `webApp/` | Auth screens, company setup, employee directory, admin/workflow screens | React + Vite + TypeScript + Tailwind; real API client |
| `backend/` | REST API, authentication/authorization middleware, database pool, migrations | Express + PostgreSQL; Supabase JWT verification and company-scoped routes |
| `androidApp/` | Reserved mobile project location | No Android source yet; `InBox/backend/` is an unrelated placeholder package folder |

## How the system connects

```text
Web browser (webApp)
  ├─ Supabase Auth: sign-in, signup, password reset, token refresh
  └─ JSON REST requests: bearer token + X-Company-Id
             ↓
Express API (backend, default port 5000)
  ├─ verifies Supabase JWT using the project's JWKS
  ├─ checks active company membership and permission
  └─ scopes database operations by company_id
             ↓
PostgreSQL (DATABASE_URL is server-only)
```

The browser does not connect to PostgreSQL. When the API is unreachable, the frontend shows an error; it does not replace API results with demo employees. The `VITE_SUPABASE_ANON_KEY` is a public browser key; never expose `DATABASE_URL` or a Supabase service-role key to Vite.

## Source tree

```text
.
├── README.md
├── .gitignore
├── webApp/
│   ├── .env.example                 # Browser-safe config template
│   ├── package.json                 # Frontend dependencies and scripts
│   ├── tailwind.config.cjs
│   ├── postcss.config.cjs
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx                 # React mount and stylesheet imports
│       ├── App.tsx                  # Authenticated shell and employee directory
│       ├── AuthScreens.tsx          # Sign-in, signup, reset, company setup/selection
│       ├── WorkspacePages.tsx      # Onboarding, departments, roles, invites, audit, settings
│       ├── lib/api.ts               # Supabase Auth REST calls, API client, refresh/session handling
│       ├── tailwind.css             # Tailwind directives
│       ├── styles.css               # Main visual system and responsive dashboard styles
│       ├── WorkspacePages.css       # Workflow and administration screen styles
│       └── vite-env.d.ts
└── backend/
    ├── .env.example                 # Server config template (placeholders only)
    ├── README.md                    # Detailed schema, run, route, and security notes
    ├── package.json
    ├── migrations/
    │   ├── 001_employee_onboarding.sql
    │   ├── 002_multi_tenant_foundation.sql
    │   └── seed.example.sql
    └── src/
        ├── server.js                 # Express composition, CORS, health, shutdown
        ├── config/db.js              # PostgreSQL pool and TLS settings
        ├── middleware/auth.js        # Supabase JWT/JWKS verification and permissions
        ├── middleware/company.js     # Membership and selected-company validation
        ├── routes/companies.js       # Registration, memberships, profile, locations
        ├── routes/employees-v2.js    # Tenant-scoped employee CRUD/search/paging
        ├── routes/reference-v2.js    # Departments, onboarding, tasks, approvals, audit
        ├── routes/admin-v2.js        # Roles, permissions, invitations
        ├── routes/employees.js       # Legacy route module (not mounted)
        ├── routes/reference.js       # Legacy route module (not mounted)
        └── scripts/
            ├── migrate.js             # Versioned transactional migration runner
            └── seed.js                # Optional example reference data
```

## Implemented API surface

Unless marked public, routes require `Authorization: Bearer <Supabase access token>`. Tenant routes also require `X-Company-Id: <UUID>` and a matching active membership. Permission names are checked server-side.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | API/database health check (public) |
| `GET /api/auth/me` | Verify current authenticated account |
| `POST /api/companies` | Register a company for a verified account; server assigns Company Owner |
| `GET /api/companies` | List active companies for the signed-in user |
| `GET/PATCH /api/companies/current` | Read or update selected company profile |
| `GET/POST /api/companies/current/locations` | List or add office locations |
| `GET/POST /api/employees` | Company-scoped list/search/create (`limit`, `offset`, `q`, `status`, `department_id`, `sort_by`, `sort_order`) |
| `GET/PATCH/DELETE /api/employees/:id` | Read, update, or soft-deactivate an employee |
| `GET/POST/PATCH /api/departments` | List, create, and update departments |
| `GET/POST /api/designations` | List or create job titles |
| `GET/POST /api/onboarding/templates` | List/create reusable task templates |
| `GET /api/onboarding` | Processes, calculated required-task progress, overdue count |
| `GET/POST /api/onboarding/tasks` | List/create tasks |
| `GET /api/onboarding/:id/tasks` | List process tasks |
| `PATCH /api/onboarding/tasks/:id` | Update task status, assignee, due date, or priority |
| `POST /api/onboarding/tasks/:id/approve` | Record an authorized approval decision |
| `GET /api/permissions`, `GET/POST /api/roles` | List permissions and roles; create custom roles |
| `PATCH /api/roles/:id` | Update a company role |
| `POST /api/roles/:id/permissions` | Replace role grants, limited to actor’s own permissions |
| `POST /api/roles/:id/members` | Assign a role to a company membership |
| `GET/POST /api/invitations` | List/create invitations (delivery is manual until email is configured) |
| `POST /api/invitations/accept` | Accept a token with the matching verified Supabase email |
| `GET /api/audit-logs` | Read company audit events with permission |

## Local setup

### Backend

From PowerShell:

```powershell
cd backend
Copy-Item .env.example .env
# Set DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, and FRONTEND_URL in .env
npm install
npm run db:migrate
npm run dev
```

### Frontend

In a second terminal:

```powershell
cd webApp
Copy-Item .env.example .env.local
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local
npm install
npm run dev
```

`VITE_API_BASE_URL` defaults to `http://localhost:5000/api`. For Supabase Auth, enable email verification and configure the local Vite URL as an allowed redirect in the Supabase project. Restart Vite after changing environment variables. Never put server secrets in `webApp/.env.local`.

Frontend checks: `npm run build` (TypeScript + production build), `npm run preview`.
Backend: `npm run dev`, `npm start`, `npm run db:migrate`, `npm run db:seed`.

## Migrations and preservation

`001_employee_onboarding.sql` defines the existing employee/onboarding schema. The additive `002_multi_tenant_foundation.sql` creates company, location, membership, role/permission, invitation, approval, and template-task tables; adds `company_id` to existing tenant-owned records; and assigns legacy rows to a `Legacy Workspace`. It does not delete existing business rows. Review the SQL and back up the database before applying it. The migration has **not been applied** in this workspace because the configured database connection could not be verified.

## Security and known gaps

- Supabase URL and anon key must be configured in both server and browser environments. Protected APIs fail closed when no access token is provided.
- PostgreSQL RLS policies are installed as defense in depth. A privileged database connection can bypass RLS, so backend queries also scope records explicitly by `company_id`.
- CORS uses `FRONTEND_URL`; TLS certificate verification is enabled by default. Fix the database certificate trust chain rather than turning verification off.
- No platform Super Admin, fine-grained manager-team row scope, private document storage/upload, email delivery provider, payroll, or native Android application is implemented yet.
- The UI does not yet include employee profile editing, hierarchy management, full authentication password-reset callback handling, or every requested workflow page.
- Do not expose the API publicly until Supabase configuration, migrations, permission seeding, tenant access, and the remaining authorization scopes have been tested in a properly configured environment.

For backend schema details and operational cautions, read [`backend/README.md`](backend/README.md). Avoid scanning `node_modules/`, `webApp/dist/`, and build output when locating maintained source.
"# orbit" 
