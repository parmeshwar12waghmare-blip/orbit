# API route modules

- `companies.js`: company registration, active company memberships, company profile and locations.
- `employees-v2.js`: company-scoped employee search, paging, creation, update and soft deactivation.
- `reference-v2.js`: departments, designations, onboarding templates/processes/tasks, approvals and audit reads.
- `admin-v2.js`: custom roles, permission grants, membership roles and invitations.
- `employees.js` and `reference.js`: legacy modules retained for reference; the current server does not mount them.

`server.js` owns route mounting and applies authentication, company context, and permission middleware. Use the root README for endpoint paths and required headers.
