# Database migrations

`001_employee_onboarding.sql` establishes the original employee and onboarding schema. `002_multi_tenant_foundation.sql` adds companies, memberships and permission structures, then associates existing records with a legacy workspace. `seed.example.sql` is optional reference data. Apply migrations in numbered order using the backend migration runner, after reviewing and backing up the target. Migration 002 has not been applied in this project environment.
