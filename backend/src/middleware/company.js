const pool = require("../config/db");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireCompany(req, res, next) {
  const companyId = req.get("x-company-id");
  if (!uuid.test(companyId || "")) return res.status(400).json({ error: { code: "COMPANY_REQUIRED", message: "A valid X-Company-Id header is required" } });
  try {
    const result = await pool.query(
      `SELECT c.id AS company_id,c.display_name,c.status AS company_status,m.id AS membership_id,m.status AS membership_status,
        u.id AS user_id,COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.id IS NOT NULL),'{}') AS roles,
        COALESCE(array_agg(DISTINCT p.key) FILTER (WHERE p.key IS NOT NULL),'{}') AS permissions
       FROM companies c
       JOIN company_memberships m ON m.company_id=c.id
       JOIN users u ON u.id=m.user_id AND u.auth_user_id=$1
       LEFT JOIN membership_roles mr ON mr.membership_id=m.id
       LEFT JOIN roles r ON r.id=mr.role_id AND r.company_id=c.id
       LEFT JOIN role_permissions rp ON rp.role_id=r.id
       LEFT JOIN permissions p ON p.id=rp.permission_id
       WHERE c.id=$2 GROUP BY c.id,m.id,u.id`, [req.auth.sub, companyId]
    );
    const membership = result.rows[0];
    if (!membership || membership.company_status !== "active" || membership.membership_status !== "active") return res.status(403).json({ error: { code: "COMPANY_ACCESS_DENIED", message: "You do not have active membership in this company" } });
    req.membership = membership;
    next();
  } catch (error) { next(error); }
}

module.exports = { requireCompany };
