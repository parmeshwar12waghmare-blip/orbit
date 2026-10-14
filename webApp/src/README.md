# Frontend source map

- `main.tsx`: React entry point; imports Tailwind and global styles.
- `App.tsx`: session/company gate, navigation, employee listing/search, create/deactivate flows.
- `AuthScreens.tsx`: login, signup, password recovery initiation, company setup and selection.
- `WorkspacePages.tsx`: onboarding tasks/templates, departments, roles, invitations, approvals, audit and settings views.
- `lib/api.ts`: Supabase Auth REST integration, token refresh/session persistence, shared API fetch and company header.
- `tailwind.css`: Tailwind base/components/utilities directives.
- `styles.css`, `WorkspacePages.css`: application-wide and workflow page styling.
- `vite-env.d.ts`: Vite client type declarations.

Data requests go through `lib/api.ts` to the Express API. Components should not connect directly to PostgreSQL.
