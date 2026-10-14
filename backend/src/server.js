
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const pool = require("./config/db");
const employees = require("./routes/employees-v2");
const reference = require("./routes/reference-v2");
const companies = require("./routes/companies");
const admin = require("./routes/admin-v2");
const { requireAuth } = require("./middleware/auth");
const { requireCompany } = require("./middleware/company");

const app = express();

app.use(helmet());
const allowedOrigins = new Set((process.env.FRONTEND_URL || "http://localhost:5173").split(",").map(origin => origin.trim()).filter(Boolean));
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.has(origin)) return callback(null, true);
  return callback(new Error("Origin is not allowed by CORS"));
} }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    message: "Employee Onboarding API is running",
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});

app.use("/api/companies", companies);
app.get("/api/auth/me", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id,email,account_status FROM users WHERE auth_user_id=$1", [req.auth.sub]);
    res.json({ data: { id: req.auth.sub, email: req.auth.email, account_status: result.rows[0]?.account_status || "active" } });
  } catch (error) { next(error); }
});
app.use("/api/employees", requireAuth, requireCompany, employees);
app.use("/api", requireAuth, requireCompany, reference);
app.use("/api", requireAuth, (req, res, next) => req.path === "/invitations/accept" ? next() : requireCompany(req, res, next), admin);

app.use((req, res) => res.status(404).json({ error: "Route not found" }));
app.use((error, _req, res, _next) => {
  if (error.message === "Origin is not allowed by CORS") return res.status(403).json({ error: { code: "CORS_ORIGIN_DENIED", message: "This origin is not allowed" } });
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON request body" });
  if (error.code === "23505") return res.status(409).json({ error: { code: "CONFLICT", message: "A record with one of these values already exists" } });
  if (error.code === "23503") return res.status(400).json({ error: { code: "INVALID_REFERENCE", message: "A referenced record does not exist" } });
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007") return res.status(400).json({ error: { code: "INVALID_VALUE", message: "Request contains an invalid value" } });
  if (error.code === "42P01" || error.code === "42703") return res.status(503).json({ error: { code: "MIGRATION_REQUIRED", message: "The database schema is not up to date. Apply the migrations and retry." } });
  console.error("Request failed:", error.message);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed" } });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; closing HTTP server and database pool`);
  const timeout = setTimeout(() => { console.error("Graceful shutdown timed out"); process.exit(1); }, 10000);
  timeout.unref();
  server.close(async error => {
    try { await pool.end(); }
    catch (poolError) { console.error("Database pool shutdown failed:", poolError.message); process.exitCode = 1; }
    if (error) { console.error("HTTP server shutdown failed:", error.message); process.exitCode = 1; }
    clearTimeout(timeout);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
