const express = require("express");
const pool = require("../config/db");

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const employeeFields = ["employee_code", "first_name", "last_name", "email", "phone", "date_of_birth", "department_id", "designation_id", "manager_id", "joining_date", "employment_type", "employment_status"];
const requiredFields = ["employee_code", "first_name", "last_name", "email", "joining_date"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateId(req, res, next) {
  if (!uuidPattern.test(req.params.id)) return res.status(400).json({ error: "Invalid employee id" });
  next();
}

function validateBody(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Request body must be a JSON object";
  const unknown = Object.keys(body).filter((key) => !employeeFields.includes(key));
  if (unknown.length) return `Unsupported field: ${unknown[0]}`;
  if (!partial) {
    const missing = requiredFields.filter((key) => body[key] === undefined || body[key] === null || body[key] === "");
    if (missing.length) return `Required fields: ${missing.join(", ")}`;
  } else if (!Object.keys(body).length) return "At least one employee field is required";
  if (body.email !== undefined && (typeof body.email !== "string" || !emailPattern.test(body.email))) return "A valid email is required";
  for (const field of ["employee_code", "first_name", "last_name"]) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || !body[field].trim())) return `${field} must be a non-empty string`;
  }
  for (const field of ["department_id", "designation_id", "manager_id"]) {
    if (body[field] != null && !uuidPattern.test(body[field])) return `${field} must be a UUID or null`;
  }
  return null;
}

router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const result = await pool.query(
      `SELECT e.*, d.name AS department_name, g.title AS designation_title
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN designations g ON g.id = e.designation_id
       WHERE e.deleted_at IS NULL ORDER BY e.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

router.get("/:id", validateId, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Employee not found" });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  const issue = validateBody(req.body);
  if (issue) return res.status(400).json({ error: issue });
  const body = { ...req.body, email: req.body.email.trim().toLowerCase() };
  const columns = employeeFields.filter((key) => body[key] !== undefined);
  try {
    const result = await pool.query(
      `INSERT INTO employees (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      columns.map((key) => typeof body[key] === "string" ? body[key].trim() : body[key])
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

router.put("/:id", validateId, async (req, res, next) => {
  const issue = validateBody(req.body, { partial: true });
  if (issue) return res.status(400).json({ error: issue });
  const body = { ...req.body };
  if (body.email !== undefined) body.email = body.email.trim().toLowerCase();
  const columns = employeeFields.filter((key) => body[key] !== undefined);
  try {
    const result = await pool.query(
      `UPDATE employees SET ${columns.map((key, i) => `${key} = $${i + 1}`).join(", ")}, updated_at = now()
       WHERE id = $${columns.length + 1} AND deleted_at IS NULL RETURNING *`,
      [...columns.map((key) => typeof body[key] === "string" ? body[key].trim() : body[key]), req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Employee not found" });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

module.exports = router;
