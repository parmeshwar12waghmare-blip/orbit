const express = require("express");
const pool = require("../config/db");
const router = express.Router();

router.get("/departments", async (_req, res, next) => {
  try { res.json((await pool.query("SELECT id,name,description,created_at,updated_at FROM departments ORDER BY name")).rows); } catch (e) { next(e); }
});
router.get("/designations", async (_req, res, next) => {
  try { res.json((await pool.query("SELECT g.id,g.title,g.department_id,g.description,g.created_at,g.updated_at,d.name AS department_name FROM designations g LEFT JOIN departments d ON d.id=g.department_id ORDER BY g.title")).rows); } catch (e) { next(e); }
});
router.get("/onboarding", async (_req, res, next) => {
  try { res.json((await pool.query("SELECT p.*,e.employee_code,e.first_name,e.last_name FROM onboarding_processes p JOIN employees e ON e.id=p.employee_id WHERE e.deleted_at IS NULL ORDER BY p.created_at DESC")).rows); } catch (e) { next(e); }
});
router.get("/onboarding/:id/tasks", async (req, res, next) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid onboarding id" });
  try {
    const process = await pool.query("SELECT id FROM onboarding_processes WHERE id=$1", [req.params.id]);
    if (!process.rowCount) return res.status(404).json({ error: "Onboarding process not found" });
    res.json((await pool.query("SELECT * FROM onboarding_tasks WHERE onboarding_process_id=$1 ORDER BY due_date NULLS LAST,created_at", [req.params.id])).rows);
  } catch (e) { next(e); }
});
router.patch("/onboarding/tasks/:id", async (req, res, next) => {
  const { status } = req.body || {};
  const statuses = ["pending", "in_progress", "completed", "blocked", "cancelled"];
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid task id" });
  if (!statuses.includes(status)) return res.status(400).json({ error: "Invalid task status" });
  try {
    const result = await pool.query("UPDATE onboarding_tasks SET status=$1,completed_at=CASE WHEN $1='completed' THEN COALESCE(completed_at,now()) ELSE NULL END,updated_at=now() WHERE id=$2 RETURNING *", [status, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Onboarding task not found" });
    res.json(result.rows[0]);
  } catch (e) { next(e); }
});
module.exports = router;
