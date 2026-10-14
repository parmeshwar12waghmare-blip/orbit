require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../config/db");

async function main() {
  const dir = path.join(__dirname, "..", "..", "migrations");
  const files = (await fs.readdir(dir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const filename of files) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [filename]);
    if (applied.rowCount) continue;
    const sql = await fs.readFile(path.join(dir, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`Applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
main().catch((error) => { console.error("Migration failed:", error.message); process.exitCode = 1; }).finally(() => pool.end());
