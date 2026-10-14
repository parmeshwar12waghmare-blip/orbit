const crypto = require("node:crypto");

let jwksCache = { keys: [], expiresAt: 0 };
let jwksRequest;

function unauthorized(res) {
  return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "A valid Supabase access token is required" } });
}

async function getSigningKey(kid) {
  if (!process.env.SUPABASE_URL) throw new Error("Authentication is not configured");
  if (jwksCache.expiresAt < Date.now()) {
    if (!jwksRequest) {
      jwksRequest = fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) })
        .then(async response => {
          if (!response.ok) throw new Error("Unable to retrieve auth signing keys");
          const body = await response.json();
          if (!Array.isArray(body.keys)) throw new Error("Invalid auth signing keys response");
          jwksCache = { keys: body.keys, expiresAt: Date.now() + 10 * 60 * 1000 };
        }).finally(() => { jwksRequest = undefined; });
    }
    await jwksRequest;
  }
  return jwksCache.keys.find(key => key.kid === kid);
}

async function verifyToken(token) {
  const chunks = token.split(".");
  if (chunks.length !== 3) throw new Error("Malformed token");
  const header = JSON.parse(Buffer.from(chunks[0], "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(chunks[1], "base64url").toString("utf8"));
  if (!["ES256", "RS256"].includes(header.alg) || typeof header.kid !== "string") throw new Error("Unsupported token signing method");
  const jwk = await getSigningKey(header.kid);
  if (!jwk || jwk.alg && jwk.alg !== header.alg) throw new Error("Unknown token signing key");
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const data = Buffer.from(`${chunks[0]}.${chunks[1]}`);
  const signature = Buffer.from(chunks[2], "base64url");
  const valid = header.alg === "ES256"
    ? crypto.verify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature)
    : crypto.verify("RSA-SHA256", data, key, signature);
  const issuer = `${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.iss !== issuer || !audience.includes("authenticated") || !Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf && claims.nbf > now) || !/^[0-9a-f-]{36}$/i.test(claims.sub || "")) throw new Error("Invalid or expired token");
  return claims;
}

async function requireAuth(req, res, next) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "");
  if (!match) return unauthorized(res);
  try {
    req.auth = await verifyToken(match[1]);
    if (!req.auth.email) return unauthorized(res);
    next();
  } catch (error) {
    if (error.message === "Authentication is not configured") return res.status(503).json({ error: { code: "AUTH_NOT_CONFIGURED", message: "Supabase authentication is not configured on the server" } });
    return unauthorized(res);
  }
}

async function verifySupabaseIdentity(req) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, authorization: req.get("authorization") },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user.id === req.auth?.sub && user.email_confirmed_at ? user : null;
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.membership) return res.status(400).json({ error: { code: "COMPANY_REQUIRED", message: "Select an active company using the X-Company-Id header" } });
    if (!req.membership.permissions.includes(permission)) return res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action" } });
    next();
  };
}

module.exports = { requireAuth, requirePermission, verifySupabaseIdentity };
