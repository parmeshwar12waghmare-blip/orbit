-- Additive tenant foundation. Existing records are assigned to one legacy workspace
-- so this migration preserves them; no business rows are deleted.
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL CHECK (length(trim(legal_name)) > 0),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  slug text NOT NULL UNIQUE,
  industry text,
  company_size text,
  official_email text NOT NULL,
  country text,
  headquarters text,
  contact_phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','suspended')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL, country text NOT NULL, address text, timezone text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,name)
);
CREATE TABLE IF NOT EXISTS company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('invited','active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,user_id)
);
CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE, description text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id,permission_id)
);
CREATE TABLE IF NOT EXISTS membership_roles (
  membership_id uuid NOT NULL REFERENCES company_memberships(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY(membership_id,role_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email text NOT NULL, role_id uuid REFERENCES roles(id) ON DELETE SET NULL, invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,email)
);
CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  onboarding_task_id uuid NOT NULL REFERENCES onboarding_tasks(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL, decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  comment text, decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status='pending') = (decided_at IS NULL))
);
CREATE TABLE IF NOT EXISTS onboarding_template_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
  title text NOT NULL CHECK(length(trim(title))>0), description text, category text, assignee_role text,
  due_days_after_start integer NOT NULL DEFAULT 7 CHECK(due_days_after_start BETWEEN 0 AND 3650),
  is_required boolean NOT NULL DEFAULT true, requires_approval boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent'));

-- A single legacy workspace keeps all pre-tenant rows together during adoption.
INSERT INTO companies(legal_name,display_name,slug,official_email,status)
VALUES ('Legacy Workspace','Legacy Workspace','legacy-workspace','admin@example.invalid','active')
ON CONFLICT(slug) DO NOTHING;

DO $$
DECLARE legacy_company uuid;
BEGIN
  SELECT id INTO legacy_company FROM companies WHERE slug='legacy-workspace';

  ALTER TABLE departments ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE designations ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE roles ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE employees ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES company_locations(id) ON DELETE SET NULL;
  ALTER TABLE onboarding_templates ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE onboarding_processes ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE onboarding_tasks ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE offers ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE employee_addresses ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE emergency_contacts ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE employee_education ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE employee_experience ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE employee_assets ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
  ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

  UPDATE departments SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE designations SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE roles SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE employees SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE onboarding_templates SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE onboarding_processes SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE onboarding_tasks SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE employee_documents SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE notifications SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE audit_logs SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE offers SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE employee_addresses SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE emergency_contacts SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE employee_education SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE employee_experience SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE employee_assets SET company_id=legacy_company WHERE company_id IS NULL;
  UPDATE task_assignments SET company_id=legacy_company WHERE company_id IS NULL;

  ALTER TABLE departments ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE designations ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE roles ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE employees ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE onboarding_templates ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE onboarding_processes ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE onboarding_tasks ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE employee_documents ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE notifications ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE audit_logs ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE offers ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE employee_addresses ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE emergency_contacts ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE employee_education ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE employee_experience ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE employee_assets ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE task_assignments ALTER COLUMN company_id SET NOT NULL;
END $$;

-- Scope identifiers and names to a tenant while retaining existing row IDs.
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employee_code_key;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS employees_company_code_uq ON employees(company_id,employee_code);
CREATE UNIQUE INDEX IF NOT EXISTS employees_company_email_uq ON employees(company_id,email);
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS departments_company_name_uq ON departments(company_id,name);
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS roles_company_name_uq ON roles(company_id,name);
CREATE INDEX IF NOT EXISTS employees_company_created_idx ON employees(company_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS departments_company_idx ON departments(company_id,name);
CREATE INDEX IF NOT EXISTS onboarding_company_status_idx ON onboarding_processes(company_id,status);
CREATE INDEX IF NOT EXISTS template_tasks_company_template_idx ON onboarding_template_tasks(company_id,template_id);
CREATE INDEX IF NOT EXISTS audit_company_created_idx ON audit_logs(company_id,created_at DESC);

INSERT INTO permissions(key,description) VALUES
 ('companies.read','View company profile'),('companies.manage','Manage company settings'),
 ('employees.read','View employee records'),('employees.create','Create employee records'),
 ('employees.update','Update employee records'),('employees.deactivate','Deactivate employees'),
 ('departments.manage','Manage departments'),('locations.manage','Manage office locations'),
 ('roles.read','View company roles'),('roles.manage','Manage company roles'),
 ('permissions.assign','Assign company permissions'),('onboarding.manage','Manage onboarding workflows'),
 ('onboarding.tasks.assign','Assign onboarding tasks'),('onboarding.tasks.complete','Complete onboarding tasks'),
 ('onboarding.approve','Approve onboarding items'),('audit_logs.read','View audit records')
ON CONFLICT(key) DO NOTHING;

-- Provision memberships for identities already linked to Supabase Auth. Accounts
-- without an Auth identity remain data records and cannot authenticate.
INSERT INTO company_memberships(company_id,user_id,status)
SELECT c.id,u.id,CASE WHEN u.account_status='active' THEN 'active' ELSE 'suspended' END
FROM users u CROSS JOIN companies c
WHERE c.slug='legacy-workspace' AND u.auth_user_id IS NOT NULL
ON CONFLICT(company_id,user_id) DO NOTHING;

-- Existing role records are preserved and become roles in the legacy workspace.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.company_id=(SELECT id FROM companies WHERE slug='legacy-workspace')
  AND (lower(r.name)='admin' OR (lower(r.name) IN ('hr','hr admin') AND p.key IN
    ('employees.read','employees.create','employees.update','departments.manage','locations.manage','onboarding.manage','onboarding.tasks.assign','onboarding.tasks.complete','onboarding.approve','audit_logs.read')))
ON CONFLICT DO NOTHING;

INSERT INTO membership_roles(membership_id,role_id)
SELECT m.id,u.role_id FROM company_memberships m JOIN users u ON u.id=m.user_id
WHERE u.role_id IS NOT NULL ON CONFLICT DO NOTHING;

-- RLS provides defense in depth for app roles that do not own tables. API SQL must
-- still include company_id predicates when using a privileged pool connection.
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['departments','designations','roles','employees','onboarding_templates','onboarding_template_tasks','onboarding_processes','onboarding_tasks','employee_documents','notifications','audit_logs','offers','employee_addresses','emergency_contacts','employee_education','employee_experience','employee_assets','task_assignments','approvals'] LOOP
   EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('DROP POLICY IF EXISTS tenant_company_isolation ON %I',t);
   EXECUTE format('CREATE POLICY tenant_company_isolation ON %I USING (company_id = nullif(current_setting(''app.company_id'',true),'''')::uuid) WITH CHECK (company_id = nullif(current_setting(''app.company_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
