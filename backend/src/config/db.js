
const { Pool } = require("pg");
require("dotenv").config();

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured before the API can start");

const sslMode = (process.env.PGSSLMODE || "require").toLowerCase();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.parseInt(process.env.PGPOOL_MAX || "10", 10),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl: sslMode === "disable" ? false : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" },
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err.message);
});

module.exports = pool;
