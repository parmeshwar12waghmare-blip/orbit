# Configuration

`db.js` creates and exports the PostgreSQL pool, applying connection limits, timeouts, and configured TLS validation. It reads server-only settings from `backend/.env`. Do not place database credentials in the web app or commit `.env`.
