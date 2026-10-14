const crypto = require("node:crypto");
const express = require("express");
const pool = require("../config/db");
const { requireAuth, requirePermission, verifySupabaseIdentity } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validName = value => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 120;
const companyId = req => req.membership.company_id;

router.get("/permissions", requirePermission("roles.read"), async (_req, res, next) => {
  try { const result = await pool.query("SELECT key,description FROM permissions ORDER BY key"); res.json({ data: result.rows }); }
  catch (error) { next(error); }
});

router.get("/roles", requirePermission("roles.read"), async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT r.id,r.name,r.description,count(DISTINCT mr.membership_id)::int AS member_count,
      COALESCE(array_agg(DISTINCT p.key) FILTER(WHERE p.key IS NOT NULL),'{}') AS permissions
      FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id
      LEFT JOIN membership_roles mr ON mr.role_id=r.id WHERE r.company_id=$1 GROUP BY r.id ORDER BY r.name`, [companyId(req)]);
    res.json({ data: result.rows });
  } catch (error) { next(error); }
});

router.post("/roles", requirePermission("roles.manage"), async (req, res, next) => {
  const { name, description, permission_keys = [] } = req.body || {};
  if (!validName(name) || !Array.isArray(permission_keys) || permission_keys.length > 100) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Role name and a valid permission list are required" } });
  if (!req.membership.permissions.includes("permissions.assign") && permission_keys.length) return res.status(403).json({ error: { code: "FORBIDDEN", message: "You cannot assign permissions" } });
  const unauthorized = permission_keys.filter(key => !req.membership.permissions.includes(key));
  if (unauthorized.length) return res.status(403).json({ error: { code: "PRIVILEGE_ESCALATION", message: "You cannot grant permissions beyond your own authority" } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const role = await client.query("INSERT INTO roles(company_id,name,description) VALUES($1,$2,$3) RETURNING id,name,description", [companyId(req), name.trim(), description?.trim() || null]);
    if (permission_keys.length) await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key=ANY($2::text[])", [role.rows[0].id, permission_keys]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'role.created','role',$3)", [companyId(req), req.membership.user_id, role.rows[0].id]);
    await client.query("COMMIT");
    res.status(201).json({ data: { ...role.rows[0], permissions: permission_keys } });
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

router.patch("/roles/:id", requirePermission("roles.manage"), async (req, res, next) => {
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid role ID" } });
  const fields = ["name", "description"].filter(key => req.body?.[key] !== undefined);
  if (!fields.length || (req.body.name !== undefined && !validName(req.body.name))) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide a valid role name or description" } });
  try {
    const result = await pool.query(`UPDATE roles SET ${fields.map((key, i) => `${key}=$${i + 1}`).join(",")} WHERE id=$${fields.length + 1} AND company_id=$${fields.length + 2} RETURNING id,name,description`, [...fields.map(key => req.body[key]?.trim?.() ?? req.body[key]), req.params.id, companyId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Role not found" } });
    await pool.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'role.updated','role',$3,$4)", [companyId(req), req.membership.user_id, req.params.id, JSON.stringify({ fields })]);
    res.json({ data: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/roles/:id/permissions", requirePermission("permissions.assign"), async (req, res, next) => {
  if (!uuid.test(req.params.id) || !Array.isArray(req.body?.permission_keys)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide a role ID and permission keys" } });
  const keys = [...new Set(req.body.permission_keys)];
  if (keys.some(key => !req.membership.permissions.includes(key))) return res.status(403).json({ error: { code: "PRIVILEGE_ESCALATION", message: "You cannot grant permissions beyond your own authority" } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const role = await client.query("SELECT id FROM roles WHERE id=$1 AND company_id=$2 FOR UPDATE", [req.params.id, companyId(req)]);
    if (!role.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "NOT_FOUND", message: "Role not found" } }); }
    await client.query("DELETE FROM role_permissions WHERE role_id=$1", [req.params.id]);
    if (keys.length) await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key=ANY($2::text[])", [req.params.id, keys]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'role.permissions.updated','role',$3,$4)", [companyId(req), req.membership.user_id, req.params.id, JSON.stringify({ permission_keys: keys })]);
    await client.query("COMMIT");
    res.json({ data: { role_id: req.params.id, permissions: keys } });
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

router.post("/roles/:id/members", requirePermission("roles.manage"), async (req, res, next) => {
  if (!uuid.test(req.params.id) || !uuid.test(req.body?.membership_id || "")) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide a role and membership ID" } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const role = await client.query("SELECT id FROM roles WHERE id=$1 AND company_id=$2 FOR UPDATE", [req.params.id, companyId(req)]);
    if (!role.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "NOT_FOUND", message: "Role not found" } }); }
    const rolePermissions = await client.query("SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1", [req.params.id]);
    if (rolePermissions.rows.some(({ key }) => !req.membership.permissions.includes(key))) { await client.query("ROLLBACK"); return res.status(403).json({ error: { code: "PRIVILEGE_ESCALATION", message: "You cannot assign a role beyond your own authority" } }); }
    const result = await client.query(`INSERT INTO membership_roles(membership_id,role_id)
      SELECT m.id,r.id FROM company_memberships m JOIN roles r ON r.company_id=m.company_id
      WHERE m.id=$1 AND m.company_id=$2 AND m.status='active' AND r.id=$3
      ON CONFLICT DO NOTHING RETURNING membership_id,role_id`, [req.body.membership_id, companyId(req), req.params.id]);
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "NOT_FOUND", message: "Company membership or role not found" } }); }
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'role.assigned','membership',$3,$4)", [companyId(req), req.membership.user_id, req.body.membership_id, JSON.stringify({ role_id: req.params.id })]);
    await client.query("COMMIT");
    res.status(201).json({ data: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

router.get("/invitations", requirePermission("roles.manage"), async (req, res, next) => {
  try { const result = await pool.query("SELECT id,email,expires_at,accepted_at,created_at FROM invitations WHERE company_id=$1 ORDER BY created_at DESC", [companyId(req)]); res.json({ data: result.rows }); }
  catch (error) { next(error); }
});

router.post("/invitations", rateLimit({ limit: 30, windowMs: 60 * 60 * 1000, keyPrefix: "company-invite" }), requirePermission("roles.manage"), async (req, res, next) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid email is required" } });
  const roleId = req.body?.role_id || null;
  if (roleId && !uuid.test(roleId)) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid role ID" } });
  const raw = crypto.randomBytes(32).toString("base64url");
  try {
    if (roleId) {
      const granted = await pool.query("SELECT array_agg(p.key) AS permissions FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE r.id=$1 AND r.company_id=$2 GROUP BY r.id", [roleId, companyId(req)]);
      if (!granted.rowCount) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Role not found in this company" } });
      if ((granted.rows[0].permissions || []).some(key => !req.membership.permissions.includes(key))) return res.status(403).json({ error: { code: "PRIVILEGE_ESCALATION", message: "You cannot grant a role beyond your own authority" } });
    }
    const result = await pool.query(`INSERT INTO invitations(company_id,email,role_id,invited_by,token_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '7 days') RETURNING id,email,expires_at,created_at`, [companyId(req), email, roleId, req.membership.user_id, crypto.createHash("sha256").update(raw).digest("hex")]);
    await pool.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'invitation.created','invitation',$3,$4)", [companyId(req), req.membership.user_id, result.rows[0].id, JSON.stringify({ email })]);
    res.status(201).json({ data: result.rows[0], invite_token: raw, delivery: "manual" });
  } catch (error) { next(error); }
});

router.post("/invitations/accept", rateLimit({ limit: 15, windowMs: 60 * 60 * 1000, keyPrefix: "invitation-accept" }), requireAuth, async (req, res, next) => {
  const token = req.body?.token;
  if (typeof token !== "string" || token.length < 32 || token.length > 256) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "A valid invitation token is required" } });
  try {
    const verified = await verifySupabaseIdentity(req);
    if (!verified) return res.status(403).json({ error: { code: "EMAIL_UNVERIFIED", message: "Verify your account email before accepting an invitation" } });
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const invitation = await client.query("SELECT i.* FROM invitations i JOIN companies c ON c.id=i.company_id AND c.status='active' WHERE i.token_hash=$1 AND lower(i.email)=lower($2) AND i.accepted_at IS NULL AND i.expires_at>now() FOR UPDATE OF i", [hash, verified.email]);
      if (!invitation.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "INVITATION_INVALID", message: "Invitation is invalid or expired" } }); }
      const invite = invitation.rows[0];
      const account = await client.query(`INSERT INTO users(auth_user_id,email,account_status) VALUES($1,lower($2),'active')
        ON CONFLICT(email) DO UPDATE SET auth_user_id=COALESCE(users.auth_user_id,EXCLUDED.auth_user_id),account_status='active'
        WHERE users.auth_user_id IS NULL OR users.auth_user_id=EXCLUDED.auth_user_id RETURNING id`, [req.auth.sub, verified.email]);
      if (!account.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: { code: "ACCOUNT_CONFLICT", message: "This email is already linked to a different account" } }); }
      const member = await client.query("INSERT INTO company_memberships(company_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(company_id,user_id) DO UPDATE SET status='active' RETURNING id", [invite.company_id, account.rows[0].id]);
      if (invite.role_id) await client.query("INSERT INTO membership_roles(membership_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [member.rows[0].id, invite.role_id]);
      await client.query("UPDATE invitations SET accepted_at=now() WHERE id=$1", [invite.id]);
      await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'invitation.accepted','invitation',$3)", [invite.company_id, account.rows[0].id, invite.id]);
      await client.query("COMMIT");
      res.status(201).json({ data: { company_id: invite.company_id, membership_id: member.rows[0].id } });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error) { next(error); }
});

module.exports = router;
