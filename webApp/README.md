# Web app

React + Vite + TypeScript frontend styled with Tailwind CSS. `src/App.tsx` is the authenticated workspace shell and employee directory. `src/AuthScreens.tsx` handles Supabase sign-in, signup, reset initiation, company creation and company selection. `src/WorkspacePages.tsx` contains the onboarding and administration views. Shared auth and API calls live in `src/lib/api.ts`.

Tailwind is configured in `tailwind.config.cjs`, processed by `postcss.config.cjs`, and its directives are in `src/tailwind.css`. Global visual styles live in `src/styles.css`; the workflow page-specific CSS is in `src/WorkspacePages.css`.

Copy `.env.example` to `.env.local` and set `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and the browser-safe `VITE_SUPABASE_ANON_KEY`. Start the API first, then run `npm install` and `npm run dev`. See the root README for the end-to-end request flow and API route list.
