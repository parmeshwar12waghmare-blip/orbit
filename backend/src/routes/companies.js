const crypto = require("node:crypto");
const express = require("express");
const pool = require("../config/db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { requireCompany } = require("../middleware/company");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const asString = (value, max = 160) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;

async function verifiedSupabaseUser(req) {
  if (!process.env.SUPABASE_ANON_KEY) throw new Error("Supabase Auth is not fully configured");
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, authorization: req.get("authorization") },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user.id === req.auth.sub && user.email_confirmed_at ? user : null;
}

// A company is provisioned only for a signed-in, email-verified Supabase user.
// The first Company Owner role and permission grants are server-assigned.
router.post("/", rateLimit({ limit: 5, windowMs: 60 * 60 * 1000, keyPrefix: "company-register" }), requireAuth, async (req, res, next) => {
  const body = req.body;
  if (!body || !asString(body.legal_name) || !asString(body.display_name) || !emailPattern.test(body.official_email || "") || !asString(body.country, 100)) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Legal name, display name, official email, and country are required" } });
  }
  for (const key of ["industry", "company_size", "headquarters", "contact_phone"]) {
    if (body[key] != null && !asString(body[key], 200)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `${key} must be a non-empty string` } });
  }
  if (body.official_email.toLowerCase() !== req.auth.email.toLowerCase()) return res.status(403).json({ error: { code: "EMAIL_MISMATCH", message: "Register using the verified account email" } });
  try {
    const verified = await verifiedSupabaseUser(req);
    if (!verified) return res.status(403).json({ error: { code: "EMAIL_UNVERIFIED", message: "Verify your email address before registering a company" } });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `INSERT INTO users(auth_user_id,email,account_status) VALUES($1,lower($2),'active')
         ON CONFLICT(email) DO UPDATE SET auth_user_id=COALESCE(users.auth_user_id,EXCLUDED.auth_user_id),account_status='active'
         WHERE users.auth_user_id IS NULL OR users.auth_user_id=EXCLUDED.auth_user_id RETURNING id`, [req.auth.sub, req.auth.email]
      );
      if (!userResult.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: { code: "ACCOUNT_CONFLICT", message: "This email is already linked to another account" } }); }
      const userId = userResult.rows[0].id;
      const slugBase = body.display_name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "company";
      const companyResult = await client.query(
        `INSERT INTO companies(legal_name,display_name,slug,industry,company_size,official_email,country,headquarters,contact_phone,status)
         VALUES($1,$2,$3,$4,$5,lower($6),$7,$8,$9,'active') RETURNING id,legal_name,display_name,slug,status,created_at`,
        [body.legal_name.trim(), body.display_name.trim(), `${slugBase}-${crypto.randomBytes(4).toString("hex")}`, body.industry?.trim() || null, body.company_size?.trim() || null, body.official_email, body.country.trim(), body.headquarters?.trim() || null, body.contact_phone?.trim() || null]
      );
      const company = companyResult.rows[0];
      const role = await client.query("INSERT INTO roles(company_id,name,description) VALUES($1,'Company Owner','Initial verified company administrator') RETURNING id", [company.id]);
      const membership = await client.query("INSERT INTO company_memberships(company_id,user_id,status) VALUES($1,$2,'active') RETURNING id", [company.id, userId]);
      await client.query("INSERT INTO membership_roles(membership_id,role_id) VALUES($1,$2)", [membership.rows[0].id, role.rows[0].id]);
      await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions", [role.rows[0].id]);
      await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'company.registered','company',$3)", [company.id, userId, company.id]);
      await client.query("COMMIT");
      res.status(201).json({ company, membership_id: membership.rows[0].id });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error) { next(error); }
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id,c.legal_name,c.display_name,c.slug,c.status,m.status AS membership_status,
        COALESCE(array_agg(DISTINCT r.name) FILTER(WHERE r.id IS NOT NULL),'{}') AS roles
       FROM users u JOIN company_memberships m ON m.user_id=u.id AND m.status='active'
       JOIN companies c ON c.id=m.company_id AND c.status='active'
       LEFT JOIN membership_roles mr ON mr.membership_id=m.id LEFT JOIN roles r ON r.id=mr.role_id
       WHERE u.auth_user_id=$1 GROUP BY c.id,m.id ORDER BY c.display_name`, [req.auth.sub]
    );
    res.json({ data: result.rows });
  } catch (error) { next(error); }
});

router.get("/current", requireAuth, requireCompany, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id,legal_name,display_name,industry,company_size,official_email,country,headquarters,contact_phone,status,settings,created_at,updated_at FROM companies WHERE id=$1", [req.membership.company_id]);
    res.json({ data: { ...result.rows[0], roles: req.membership.roles, permissions: req.membership.permissions } });
  } catch (error) { next(error); }
});

router.patch("/current", requireAuth, requireCompany, requirePermission("companies.manage"), async (req, res, next) => {
  const allowed = ["legal_name", "display_name", "industry", "company_size", "official_email", "country", "headquarters", "contact_phone"];
  const fields = allowed.filter(key => req.body?.[key] !== undefined);
  if (!fields.length || fields.some(key => !asString(req.body[key], 200)) || (req.body.official_email && !emailPattern.test(req.body.official_email))) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide valid company fields to update" } });
  try {
    const result = await pool.query(`UPDATE companies SET ${fields.map((key, i) => `${key}=$${i + 1}`).join(", ")},updated_at=now() WHERE id=$${fields.length + 1} RETURNING id,legal_name,display_name,industry,company_size,official_email,country,headquarters,contact_phone,status,settings`, [...fields.map(key => typeof req.body[key] === "string" ? req.body[key].trim() : req.body[key]), req.membership.company_id]);
    res.json({ data: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/current/locations", requireAuth, requireCompany, requirePermission("companies.read"), async (req, res, next) => {
  try { const result = await pool.query("SELECT id,name,country,address,timezone,created_at FROM company_locations WHERE company_id=$1 ORDER BY name", [req.membership.company_id]); res.json({ data: result.rows }); }
  catch (error) { next(error); }
});

router.post("/current/locations", requireAuth, requireCompany, requirePermission("locations.manage"), async (req, res, next) => {
  const { name, country, address, timezone } = req.body || {};
  if (!asString(name) || !asString(country, 100) || [address, timezone].some(value => value != null && !asString(value, 200))) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Location name and country are required" } });
  try {
    const result = await pool.query("INSERT INTO company_locations(company_id,name,country,address,timezone) VALUES($1,$2,$3,$4,$5) RETURNING *", [req.membership.company_id, name.trim(), country.trim(), address?.trim() || null, timezone?.trim() || null]);
    res.status(201).json({ data: result.rows[0] });
  } catch (error) { next(error); }
});

module.exports = router;
