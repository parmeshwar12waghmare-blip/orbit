require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../config/db");

async function main() {
  const sql = await fs.readFile(path.join(__dirname, "..", "..", "migrations", "seed.example.sql"), "utf8");
  await pool.query(sql);
  console.log("Reference data seeded");
}
main().catch((error) => { console.error("Seed failed:", error.message); process.exitCode = 1; }).finally(() => pool.end());
