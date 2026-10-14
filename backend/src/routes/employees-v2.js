const express = require("express");
const pool = require("../config/db");
const { requirePermission } = require("../middleware/auth");

const router = express.Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = ["employee_code", "first_name", "last_name", "email", "phone", "date_of_birth", "department_id", "designation_id", "manager_id", "joining_date", "employment_type", "employment_status", "location_id"];
const required = ["employee_code", "first_name", "last_name", "email", "joining_date"];
const sortFields = { created_at: "e.created_at", joining_date: "e.joining_date", last_name: "e.last_name", employee_code: "e.employee_code" };
const select = `SELECT e.*,d.name AS department_name,g.title AS designation_title,l.name AS location_name,
  concat_ws(' ',m.first_name,m.last_name) AS manager_name
  FROM employees e LEFT JOIN departments d ON d.id=e.department_id AND d.company_id=e.company_id
  LEFT JOIN designations g ON g.id=e.designation_id AND g.company_id=e.company_id
  LEFT JOIN company_locations l ON l.id=e.location_id AND l.company_id=e.company_id
  LEFT JOIN employees m ON m.id=e.manager_id AND m.company_id=e.company_id`;

function validate(body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Request body must be an object";
  const unknown = Object.keys(body).filter(key => !fields.includes(key) && key !== "onboarding_template_id");
  if (unknown.length) return `Unsupported field: ${unknown[0]}`;
  if (!partial && required.some(key => !String(body[key] ?? "").trim())) return `Required fields: ${required.join(", ")}`;
  if (partial && !Object.keys(body).length) return "At least one employee field is required";
  if (body.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return "A valid email is required";
  for (const key of ["employee_code", "first_name", "last_name"]) if (body[key] !== undefined && (typeof body[key] !== "string" || !body[key].trim())) return `${key} must be a non-empty string`;
  for (const key of ["department_id", "designation_id", "manager_id", "location_id", "onboarding_template_id"]) if (body[key] != null && !uuid.test(body[key])) return `${key} must be a UUID or null`;
  if (body.employment_type !== undefined && !["full_time", "part_time", "contract", "intern", "temporary"].includes(body.employment_type)) return "Invalid employment_type";
  if (body.employment_status !== undefined && !["preboarding", "active", "on_leave", "terminated"].includes(body.employment_status)) return "Invalid employment_status";
  return null;
}

async function referencesBelongToCompany(db, body, companyId) {
  for (const [field, table] of [["department_id", "departments"], ["designation_id", "designations"], ["location_id", "company_locations"], ["onboarding_template_id", "onboarding_templates"]]) {
    if (body[field] && !(await db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND company_id=$2`, [body[field], companyId])).rowCount) return `${field} is not in the active company`;
  }
  if (body.manager_id && !(await db.query("SELECT 1 FROM employees WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL", [body.manager_id, companyId])).rowCount) return "manager_id is not an active employee in this company";
  return null;
}

router.get("/", requirePermission("employees.read"), async (req, res, next) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const sort = sortFields[req.query.sort_by] || sortFields.created_at;
  const direction = String(req.query.sort_order).toLowerCase() === "asc" ? "ASC" : "DESC";
  const values = [req.membership.company_id];
  const clauses = ["e.company_id=$1", "e.deleted_at IS NULL"];
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    values.push(`%${req.query.q.trim().slice(0, 100)}%`);
    clauses.push(`(e.first_name ILIKE $${values.length} OR e.last_name ILIKE $${values.length} OR e.email ILIKE $${values.length} OR e.employee_code ILIKE $${values.length})`);
  }
  if (req.query.status && ["preboarding", "active", "on_leave", "terminated"].includes(req.query.status)) { values.push(req.query.status); clauses.push(`e.employment_status=$${values.length}`); }
  if (req.query.department_id && uuid.test(req.query.department_id)) { values.push(req.query.department_id); clauses.push(`e.department_id=$${values.length}`); }
  try {
    const where = clauses.join(" AND ");
    const count = await pool.query(`SELECT count(*)::int AS total FROM employees e WHERE ${where}`, values);
    const rows = await pool.query(`${select} WHERE ${where} ORDER BY ${sort} ${direction} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
    res.json({ data: rows.rows, pagination: { total: count.rows[0].total, limit, offset, has_more: offset + rows.rowCount < count.rows[0].total } });
  } catch (error) { next(error); }
});

router.get("/:id", requirePermission("employees.read"), async (req, res, next) => {
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid employee ID" } });
  try {
    const result = await pool.query(`${select} WHERE e.id=$1 AND e.company_id=$2 AND e.deleted_at IS NULL`, [req.params.id, req.membership.company_id]);
    if (!result.rowCount) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Employee not found" } });
    res.json({ data: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/", requirePermission("employees.create"), async (req, res, next) => {
  const issue = validate(req.body);
  if (issue) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: issue } });
  const companyId = req.membership.company_id;
  const body = { ...req.body, email: req.body.email.trim().toLowerCase() };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const referenceIssue = await referencesBelongToCompany(client, body, companyId);
    if (referenceIssue) { await client.query("ROLLBACK"); return res.status(400).json({ error: { code: "INVALID_REFERENCE", message: referenceIssue } }); }
    if (body.manager_id === undefined && req.body.manager_id) { await client.query("ROLLBACK"); return res.status(400).json({ error: { code: "INVALID_MANAGER", message: "Invalid manager relationship" } }); }
    const columns = fields.filter(key => body[key] !== undefined);
    const values = columns.map(key => typeof body[key] === "string" ? body[key].trim() : body[key]);
    const result = await client.query(`INSERT INTO employees(company_id,${columns.join(",")}) VALUES($${values.length + 1},${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, [...values, companyId]);
    const employee = result.rows[0];
    if (body.onboarding_template_id) {
      const process = await client.query("INSERT INTO onboarding_processes(company_id,employee_id,template_id,start_date,status) VALUES($1,$2,$3,$4,'in_progress') RETURNING id", [companyId, employee.id, body.onboarding_template_id, employee.joining_date]);
      await client.query(
        `INSERT INTO onboarding_tasks(company_id,onboarding_process_id,title,description,category,due_date,is_required,requires_approval)
         SELECT company_id,$2,title,description,category,$3 + due_days_after_start,is_required,requires_approval FROM onboarding_template_tasks
         WHERE company_id=$1 AND template_id=$4`, [companyId, process.rows[0].id, employee.joining_date, body.onboarding_template_id]
      );
      await client.query("UPDATE onboarding_processes SET status=CASE WHEN EXISTS(SELECT 1 FROM onboarding_tasks WHERE onboarding_process_id=$1) THEN 'in_progress'::onboarding_status ELSE 'not_started'::onboarding_status END WHERE id=$1", [process.rows[0].id]);
    }
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'employee.created','employee',$3)", [companyId, req.membership.user_id, employee.id]);
    await client.query("COMMIT");
    res.status(201).json({ data: employee });
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

router.patch("/:id", requirePermission("employees.update"), async (req, res, next) => {
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid employee ID" } });
  const issue = validate(req.body, true);
  if (issue) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: issue } });
  if (req.body.onboarding_template_id !== undefined) return res.status(400).json({ error: { code: "INVALID_FIELD", message: "Onboarding templates can only be assigned when creating an employee" } });
  const body = { ...req.body };
  if (body.email !== undefined) body.email = body.email.trim().toLowerCase();
  const columns = fields.filter(key => body[key] !== undefined);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const referenceIssue = await referencesBelongToCompany(client, body, req.membership.company_id);
    if (referenceIssue) { await client.query("ROLLBACK"); return res.status(400).json({ error: { code: "INVALID_REFERENCE", message: referenceIssue } }); }
    if (body.manager_id) {
      const cycle = await client.query(`WITH RECURSIVE chain(id,manager_id,path,cycle) AS (
        SELECT id,manager_id,ARRAY[id]::uuid[],false FROM employees WHERE id=$1 AND company_id=$2
        UNION ALL SELECT e.id,e.manager_id,c.path||e.id,e.id=ANY(c.path) FROM employees e JOIN chain c ON e.id=c.manager_id WHERE e.company_id=$2 AND NOT c.cycle
      ) SELECT 1 FROM chain WHERE id=$3 OR cycle LIMIT 1`, [body.manager_id, req.membership.company_id, req.params.id]);
      if (cycle.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: { code: "REPORTING_CYCLE", message: "Manager assignment would create a reporting cycle" } }); }
    }
    const result = await client.query(`UPDATE employees SET ${columns.map((key, i) => `${key}=$${i + 1}`).join(",")},updated_at=now() WHERE id=$${columns.length + 1} AND company_id=$${columns.length + 2} AND deleted_at IS NULL RETURNING *`, [...columns.map(key => typeof body[key] === "string" ? body[key].trim() : body[key]), req.params.id, req.membership.company_id]);
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "NOT_FOUND", message: "Employee not found" } }); }
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'employee.updated','employee',$3)", [req.membership.company_id, req.membership.user_id, req.params.id]);
    await client.query("COMMIT");
    res.json({ data: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

router.delete("/:id", requirePermission("employees.deactivate"), async (req, res, next) => {
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid employee ID" } });
  try {
    const result = await pool.query("UPDATE employees SET deleted_at=now(),employment_status='terminated',updated_at=now() WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL RETURNING id", [req.params.id, req.membership.company_id]);
    if (!result.rowCount) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Employee not found" } });
    await pool.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'employee.deactivated','employee',$3)", [req.membership.company_id, req.membership.user_id, req.params.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});

module.exports = router;
