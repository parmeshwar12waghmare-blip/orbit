INSERT INTO departments(company_id,name,description)
SELECT c.id,v.name,v.description FROM companies c CROSS JOIN (VALUES
 ('Human Resources','People operations'),('Engineering','Software engineering'),('Finance','Finance and accounting')
) AS v(name,description) WHERE c.slug='legacy-workspace'
ON CONFLICT(company_id,name) DO NOTHING;

INSERT INTO designations(company_id,title,department_id,description)
SELECT d.company_id,v.title,d.id,v.description FROM (VALUES
 ('HR Generalist','Human Resources','People operations generalist'),('Software Engineer','Engineering','Software product development'),('Accountant','Finance','Accounting and reporting')
) AS v(title,department_name,description)
JOIN departments d ON d.name=v.department_name JOIN companies c ON c.id=d.company_id AND c.slug='legacy-workspace'
ON CONFLICT(department_id,title) DO NOTHING;

INSERT INTO roles(company_id,name,description)
SELECT c.id,v.name,v.description FROM companies c CROSS JOIN (VALUES
 ('admin','Company administration'),('hr','Human resources operations'),('manager','Team manager'),('employee','Employee self-service')
) AS v(name,description) WHERE c.slug='legacy-workspace'
ON CONFLICT(company_id,name) DO NOTHING;

INSERT INTO document_types(name,description,is_required,allowed_file_types,max_file_size) VALUES
 ('Government ID','Government-issued identity document',true,ARRAY['application/pdf','image/jpeg','image/png'],10485760),
 ('Tax Form','Employee tax form',true,ARRAY['application/pdf'],10485760),
 ('Education Certificate','Education credential',false,ARRAY['application/pdf','image/jpeg','image/png'],10485760)
ON CONFLICT(name) DO NOTHING;
