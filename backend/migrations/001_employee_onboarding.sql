CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE TYPE account_status AS ENUM ('invited','active','suspended','disabled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE employment_type AS ENUM ('full_time','part_time','contract','intern','temporary'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE employment_status AS ENUM ('preboarding','active','on_leave','terminated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE onboarding_status AS ENUM ('not_started','in_progress','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE task_status AS ENUM ('pending','in_progress','completed','blocked','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE document_verification_status AS ENUM ('pending','verified','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE offer_status AS ENUM ('draft','sent','accepted','declined','expired','withdrawn'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE asset_status AS ENUM ('assigned','returned','lost','damaged'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE address_type AS ENUM ('residential','permanent','mailing'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE IF NOT EXISTS departments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE CHECK (length(trim(name)) > 0), description text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS designations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL CHECK (length(trim(title)) > 0), department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
 description text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(department_id,title)
);
CREATE TABLE IF NOT EXISTS roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE CHECK (length(trim(name)) > 0), description text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_code text NOT NULL UNIQUE CHECK (length(trim(employee_code)) > 0), first_name text NOT NULL CHECK (length(trim(first_name)) > 0),
 last_name text NOT NULL CHECK (length(trim(last_name)) > 0), email text NOT NULL UNIQUE CHECK (email = lower(email)), phone text,
 date_of_birth date, department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
 designation_id uuid REFERENCES designations(id) ON DELETE SET NULL,
 manager_id uuid REFERENCES employees(id) ON DELETE SET NULL, joining_date date NOT NULL,
 employment_type employment_type NOT NULL DEFAULT 'full_time', employment_status employment_status NOT NULL DEFAULT 'preboarding',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 CHECK (date_of_birth IS NULL OR date_of_birth < CURRENT_DATE), CHECK (manager_id IS NULL OR manager_id <> id)
);
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid UNIQUE, employee_id uuid UNIQUE REFERENCES employees(id) ON DELETE SET NULL,
 role_id uuid REFERENCES roles(id) ON DELETE RESTRICT, email text NOT NULL UNIQUE CHECK (email = lower(email)), account_status account_status NOT NULL DEFAULT 'invited',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS onboarding_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (length(trim(name)) > 0), description text,
 department_id uuid REFERENCES departments(id) ON DELETE SET NULL, designation_id uuid REFERENCES designations(id) ON DELETE SET NULL,
 is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS onboarding_processes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
 template_id uuid REFERENCES onboarding_templates(id) ON DELETE SET NULL, assigned_hr_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 start_date date NOT NULL DEFAULT CURRENT_DATE, target_completion_date date, completed_at timestamptz,
 status onboarding_status NOT NULL DEFAULT 'not_started', progress_percentage smallint NOT NULL DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (target_completion_date IS NULL OR target_completion_date >= start_date), CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS onboarding_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), onboarding_process_id uuid NOT NULL REFERENCES onboarding_processes(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (length(trim(title)) > 0), description text, category text, assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 due_date date, status task_status NOT NULL DEFAULT 'pending', is_required boolean NOT NULL DEFAULT true, completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS document_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE CHECK (length(trim(name)) > 0), description text,
 is_required boolean NOT NULL DEFAULT false, allowed_file_types text[] NOT NULL DEFAULT ARRAY['application/pdf']::text[],
 max_file_size bigint NOT NULL DEFAULT 10485760 CHECK (max_file_size BETWEEN 1 AND 104857600), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employee_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 document_type_id uuid NOT NULL REFERENCES document_types(id) ON DELETE RESTRICT, storage_path text NOT NULL UNIQUE,
 original_filename text NOT NULL, mime_type text NOT NULL, file_size bigint NOT NULL CHECK (file_size > 0),
 verification_status document_verification_status NOT NULL DEFAULT 'pending', verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
 verified_at timestamptz, rejection_reason text, uploaded_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((verification_status = 'verified') = (verified_at IS NOT NULL)), CHECK (verification_status <> 'rejected' OR rejection_reason IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL, message text NOT NULL, notification_type text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action text NOT NULL, entity_type text NOT NULL, entity_id uuid, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 job_title text NOT NULL, offered_salary numeric(14,2) NOT NULL CHECK (offered_salary >= 0), currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 offer_date date NOT NULL, expiry_date date, status offer_status NOT NULL DEFAULT 'draft', document_storage_path text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (expiry_date IS NULL OR expiry_date >= offer_date)
);
CREATE TABLE IF NOT EXISTS employee_addresses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 address_type address_type NOT NULL, address_line_1 text NOT NULL, address_line_2 text, city text NOT NULL, state text, postal_code text, country text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(employee_id,address_type)
);
CREATE TABLE IF NOT EXISTS emergency_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 name text NOT NULL, relationship text NOT NULL, phone text NOT NULL, email text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employee_education (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 qualification text NOT NULL, institution text NOT NULL, field_of_study text, graduation_year smallint CHECK (graduation_year BETWEEN 1900 AND 2200), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employee_experience (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 company_name text NOT NULL, job_title text NOT NULL, start_date date NOT NULL, end_date date, description text,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE TABLE IF NOT EXISTS employee_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 asset_name text NOT NULL, asset_type text NOT NULL, asset_serial_number text UNIQUE, assigned_at timestamptz NOT NULL DEFAULT now(),
 returned_at timestamptz, status asset_status NOT NULL DEFAULT 'assigned', notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((status = 'returned') = (returned_at IS NOT NULL))
);

-- Current assignee is authoritative on onboarding_tasks; history is retained here only when reassignment audit is needed.
CREATE TABLE IF NOT EXISTS task_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), onboarding_task_id uuid NOT NULL REFERENCES onboarding_tasks(id) ON DELETE CASCADE,
 assigned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, assigned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 assigned_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS designations_department_idx ON designations(department_id);
CREATE INDEX IF NOT EXISTS employees_department_idx ON employees(department_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS employees_designation_idx ON employees(designation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS employees_manager_idx ON employees(manager_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS employees_status_idx ON employees(employment_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role_id);
CREATE INDEX IF NOT EXISTS onboarding_processes_status_idx ON onboarding_processes(status);
CREATE INDEX IF NOT EXISTS onboarding_tasks_process_status_idx ON onboarding_tasks(onboarding_process_id,status);
CREATE INDEX IF NOT EXISTS onboarding_tasks_assignee_idx ON onboarding_tasks(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_documents_employee_idx ON employee_documents(employee_id,verification_status);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type,entity_id,created_at DESC);
CREATE INDEX IF NOT EXISTS offers_employee_idx ON offers(employee_id,created_at DESC);
CREATE INDEX IF NOT EXISTS emergency_contacts_employee_idx ON emergency_contacts(employee_id);
CREATE INDEX IF NOT EXISTS employee_education_employee_idx ON employee_education(employee_id);
CREATE INDEX IF NOT EXISTS employee_experience_employee_idx ON employee_experience(employee_id);
CREATE INDEX IF NOT EXISTS employee_assets_employee_idx ON employee_assets(employee_id,status);
CREATE INDEX IF NOT EXISTS task_assignments_task_idx ON task_assignments(onboarding_task_id,assigned_at DESC);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['departments','designations','employees','users','onboarding_templates','onboarding_processes','onboarding_tasks','employee_documents','offers','employee_addresses','emergency_contacts','employee_assets'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_updated_at', t);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
 END LOOP;
END $$;
