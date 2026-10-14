const express = require("express");
const pool = require("../config/db");
const { requirePermission } = require("../middleware/auth");

const router = express.Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const taskStatuses = ["pending", "in_progress", "completed", "blocked", "cancelled"];
const string = (value, max = 240) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
const companyId = req => req.membership.company_id;

router.get("/departments", requirePermission("employees.read"), async (req, res, next) => {
  try { const result = await pool.query("SELECT id,name,description,created_at,updated_at FROM departments WHERE company_id=$1 ORDER BY name", [companyId(req)]); res.json({ data: result.rows }); }
  catch (error) { next(error); }
});
router.post("/departments", requirePermission("departments.manage"), async (req, res, next) => {
  const { name, description } = req.body || {};
  if (!string(name, 120) || (description != null && (typeof description !== "string" || description.length > 2000))) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A department name is required" } });
  try { const result = await pool.query("INSERT INTO departments(company_id,name,description) VALUES($1,$2,$3) RETURNING *", [companyId(req), name.trim(), description?.trim() || null]); res.status(201).json({ data: result.rows[0] }); }
  catch (error) { next(error); }
});
router.patch("/departments/:id", requirePermission("departments.manage"), async (req, res, next) => {
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid department ID" } });
  const fields = ["name", "description"].filter(key => req.body?.[key] !== undefined);
  if (!fields.length || (req.body.name !== undefined && !string(req.body.name, 120))) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide a valid department name or description" } });
  try {
    const result = await pool.query(`UPDATE departments SET ${fields.map((key, i) => `${key}=$${i + 1}`).join(",")},updated_at=now() WHERE id=$${fields.length + 1} AND company_id=$${fields.length + 2} RETURNING *`, [...fields.map(key => typeof req.body[key] === "string" ? req.body[key].trim() : req.body[key]), req.params.id, companyId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Department not found" } });
    res.json({ data: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/designations", requirePermission("employees.read"), async (req, res, next) => {
  try { const result = await pool.query("SELECT g.id,g.title,g.department_id,g.description,d.name AS department_name FROM designations g LEFT JOIN departments d ON d.id=g.department_id AND d.company_id=g.company_id WHERE g.company_id=$1 ORDER BY g.title", [companyId(req)]); res.json({ data: result.rows }); }
  catch (error) { next(error); }
});
router.post("/designations", requirePermission("departments.manage"), async (req, res, next) => {
  const { title, department_id, description } = req.body || {};
  if (!string(title, 160) || (department_id && !uuid.test(department_id))) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid job title is required" } });
  try {
    if (department_id && !(await pool.query("SELECT 1 FROM departments WHERE id=$1 AND company_id=$2", [department_id, companyId(req)])).rowCount) return res.status(400).json({ error: { code: "INVALID_REFERENCE", message: "Department is not in the selected company" } });
    const result = await pool.query("INSERT INTO designations(company_id,title,department_id,description) VALUES($1,$2,$3,$4) RETURNING *", [companyId(req), title.trim(), department_id || null, description?.trim() || null]); res.status(201).json({ data: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/onboarding/templates", requirePermission("onboarding.manage"), async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT t.*,count(tt.id)::int AS task_count FROM onboarding_templates t LEFT JOIN onboarding_template_tasks tt ON tt.template_id=t.id AND tt.company_id=t.company_id WHERE t.company_id=$1 GROUP BY t.id ORDER BY t.name`, [companyId(req)]);
    res.json({ data: result.rows });
  } catch (error) { next(error); }
});
router.post("/onboarding/templates", requirePermission("onboarding.manage"), async (req, res, next) => {
  const { name, description, department_id, designation_id, tasks = [] } = req.body || {};
  if (!string(name, 160) || !Array.isArray(tasks) || tasks.length > 100) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Template name and a valid task list are required" } });
  if (tasks.some(task => !string(task.title, 200) || (task.due_days_after_start != null && (!Number.isInteger(task.due_days_after_start) || task.due_days_after_start < 0 || task.due_days_after_start > 3650)))) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Template tasks need a title and valid due-day offset" } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [id, table] of [[department_id, "departments"], [designation_id, "designations"]]) if (id && (!(uuid.test(id)) || !(await client.query(`SELECT 1 FROM ${table} WHERE id=$1 AND company_id=$2`, [id, companyId(req)])).rowCount)) { await client.query("ROLLBACK"); return res.status(400).json({ error: { code: "INVALID_REFERENCE", message: "Template reference is not in this company" } }); }
    const template = await client.query("INSERT INTO onboarding_templates(company_id,name,description,department_id,designation_id) VALUES($1,$2,$3,$4,$5) RETURNING *", [companyId(req), name.trim(), description?.trim() || null, department_id || null, designation_id || null]);
    for (const task of tasks) await client.query("INSERT INTO onboarding_template_tasks(company_id,template_id,title,description,category,assignee_role,due_days_after_start,is_required,requires_approval) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [companyId(req), template.rows[0].id, task.title.trim(), task.description?.trim() || null, task.category || null, task.assignee_role || null, task.due_days_after_start ?? 7, task.is_required !== false, task.requires_approval === true]);
    await client.query("COMMIT");
    res.status(201).json({ data: { ...template.rows[0], tasks } });
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

router.get("/onboarding", requirePermission("onboarding.manage"), async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT p.*,e.employee_code,e.first_name,e.last_name,
      COALESCE(round(100.0*count(t.id) FILTER(WHERE t.is_required AND t.status='completed')/NULLIF(count(t.id) FILTER(WHERE t.is_required),0))::int,0) AS calculated_progress,
      count(t.id) FILTER(WHERE t.status<>'completed' AND t.due_date<CURRENT_DATE)::int AS overdue_tasks
      FROM onboarding_processes p JOIN employees e ON e.id=p.employee_id AND e.company_id=p.company_id
      LEFT JOIN onboarding_tasks t ON t.onboarding_process_id=p.id AND t.company_id=p.company_id
      WHERE p.company_id=$1 AND e.deleted_at IS NULL GROUP BY p.id,e.id ORDER BY p.created_at DESC`, [companyId(req)]);
    res.json({ data: result.rows });
  } catch (error) { next(error); }
});

router.get("/onboarding/tasks", requirePermission("onboarding.manage"), async (req, res, next) => {
  try {
    const values = [companyId(req)];
    let statusClause = "";
    if (taskStatuses.includes(req.query.status)) { values.push(req.query.status); statusClause = ` AND t.status=$${values.length}`; }
    const result = await pool.query(`SELECT t.*,e.employee_code,e.first_name,e.last_name,p.employee_id FROM onboarding_tasks t JOIN onboarding_processes p ON p.id=t.onboarding_process_id AND p.company_id=t.company_id JOIN employees e ON e.id=p.employee_id WHERE t.company_id=$1${statusClause} ORDER BY t.due_date NULLS LAST,t.created_at DESC LIMIT 200`, values);
    res.json({ data: result.rows });
  } catch (error) { next(error); }
});
router.get("/onboarding/:id/tasks", requirePermission("onboarding.manage"), async (req, res, next) => {
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid onboarding ID" } });
  try {
    const process = await pool.query("SELECT id FROM onboarding_processes WHERE id=$1 AND company_id=$2", [req.params.id, companyId(req)]);
    if (!process.rowCount) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Onboarding process not found" } });
    const tasks = await pool.query("SELECT * FROM onboarding_tasks WHERE onboarding_process_id=$1 AND company_id=$2 ORDER BY due_date NULLS LAST,created_at", [req.params.id, companyId(req)]);
    res.json({ data: tasks.rows });
  } catch (error) { next(error); }
});

router.post("/onboarding/tasks", requirePermission("onboarding.tasks.assign"), async (req, res, next) => {
  const { onboarding_process_id, title, description, category, assigned_user_id, due_date, priority = "normal", requires_approval = false } = req.body || {};
  if (!uuid.test(onboarding_process_id || "") || !string(title, 200) || !["low", "normal", "high", "urgent"].includes(priority) || (assigned_user_id && !uuid.test(assigned_user_id))) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide a process, title, and valid task options" } });
  try {
    const process = await pool.query("SELECT id FROM onboarding_processes WHERE id=$1 AND company_id=$2", [onboarding_process_id, companyId(req)]);
    if (!process.rowCount) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Onboarding process not found" } });
    if (assigned_user_id && !(await pool.query("SELECT 1 FROM users u JOIN company_memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.company_id=$2 AND m.status='active'", [assigned_user_id, companyId(req)])).rowCount) return res.status(400).json({ error: { code: "INVALID_REFERENCE", message: "Assignee is not a member of this company" } });
    const result = await pool.query("INSERT INTO onboarding_tasks(company_id,onboarding_process_id,title,description,category,assigned_user_id,due_date,priority,requires_approval) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *", [companyId(req), onboarding_process_id, title.trim(), description?.trim() || null, category || null, assigned_user_id || null, due_date || null, priority, requires_approval === true]);
    res.status(201).json({ data: result.rows[0] });
  } catch (error) { next(error); }
});

router.patch("/onboarding/tasks/:id", requirePermission("onboarding.tasks.complete"), async (req, res, next) => {
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid task ID" } });
  const fields = ["status", "due_date", "assigned_user_id", "priority"].filter(key => req.body?.[key] !== undefined);
  if (!fields.length || (req.body.status !== undefined && !taskStatuses.includes(req.body.status)) || (req.body.priority !== undefined && !["low", "normal", "high", "urgent"].includes(req.body.priority)) || (req.body.assigned_user_id && !uuid.test(req.body.assigned_user_id))) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide valid task fields" } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (req.body.status === "completed") {
      const task = await client.query("SELECT requires_approval FROM onboarding_tasks WHERE id=$1 AND company_id=$2", [req.params.id, companyId(req)]);
      if (!task.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } }); }
      if (task.rows[0].requires_approval) {
        const approval = await client.query("SELECT 1 FROM approvals WHERE onboarding_task_id=$1 AND company_id=$2 AND status='approved'", [req.params.id, companyId(req)]);
        if (!approval.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: { code: "APPROVAL_REQUIRED", message: "This task requires an approved decision before completion" } }); }
      }
    }
    if (req.body.assigned_user_id && !(await client.query("SELECT 1 FROM users u JOIN company_memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.company_id=$2 AND m.status='active'", [req.body.assigned_user_id, companyId(req)])).rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: { code: "INVALID_REFERENCE", message: "Assignee is not a member of this company" } }); }
    const set = fields.map((key, i) => `${key}=$${i + 1}`);
    const values = fields.map(key => req.body[key]);
    if (req.body.status !== undefined) { set.push(`completed_at=CASE WHEN $${fields.indexOf("status") + 1}='completed' THEN COALESCE(completed_at,now()) ELSE NULL END`); }
    const result = await client.query(`UPDATE onboarding_tasks SET ${set.join(",")},updated_at=now() WHERE id=$${values.length + 1} AND company_id=$${values.length + 2} RETURNING *`, [...values, req.params.id, companyId(req)]);
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } }); }
    const processId = result.rows[0].onboarding_process_id;
    await client.query(`UPDATE onboarding_processes p SET progress_percentage=COALESCE((SELECT round(100.0*count(*) FILTER(WHERE status='completed')/NULLIF(count(*),0))::int FROM onboarding_tasks WHERE onboarding_process_id=p.id AND company_id=p.company_id AND is_required),0),
      status=CASE WHEN EXISTS(SELECT 1 FROM onboarding_tasks WHERE onboarding_process_id=p.id AND company_id=p.company_id AND is_required AND status<>'completed') THEN 'in_progress'::onboarding_status ELSE 'completed'::onboarding_status END,
      completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM onboarding_tasks WHERE onboarding_process_id=p.id AND company_id=p.company_id AND is_required AND status<>'completed') THEN COALESCE(p.completed_at,now()) ELSE NULL END
      WHERE p.id=$1 AND p.company_id=$2`, [processId, companyId(req)]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'onboarding.task.updated','onboarding_task',$3)", [companyId(req), req.membership.user_id, req.params.id]);
    await client.query("COMMIT");
    res.json({ data: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

router.post("/onboarding/tasks/:id/approve", requirePermission("onboarding.approve"), async (req, res, next) => {
  if (!uuid.test(req.params.id) || !["approved", "rejected"].includes(req.body?.decision)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide a valid task ID and approval decision" } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const task = await client.query("SELECT id FROM onboarding_tasks WHERE id=$1 AND company_id=$2 FOR UPDATE", [req.params.id, companyId(req)]);
    if (!task.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } }); }
    const result = await client.query(`INSERT INTO approvals(company_id,onboarding_task_id,requested_by,decided_by,status,comment,decided_at)
      VALUES($1,$2,$3,$3,$4,$5,now()) RETURNING *`, [companyId(req), req.params.id, req.membership.user_id, req.body.decision, typeof req.body.comment === "string" ? req.body.comment.slice(0,2000) : null]);
    if (req.body.decision === "approved") await client.query("UPDATE onboarding_tasks SET status='completed',completed_at=COALESCE(completed_at,now()),updated_at=now() WHERE id=$1 AND company_id=$2", [req.params.id, companyId(req)]);
    else await client.query("UPDATE onboarding_tasks SET status='in_progress',completed_at=NULL,updated_at=now() WHERE id=$1 AND company_id=$2", [req.params.id, companyId(req)]);
    await client.query("COMMIT");
    res.status(201).json({ data: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

router.get("/audit-logs", requirePermission("audit_logs.read"), async (req, res, next) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  try { const result = await pool.query("SELECT id,actor_user_id,action,entity_type,entity_id,metadata,created_at FROM audit_logs WHERE company_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3", [companyId(req), limit, offset]); res.json({ data: result.rows, pagination: { limit, offset } }); }
  catch (error) { next(error); }
});

module.exports = router;
