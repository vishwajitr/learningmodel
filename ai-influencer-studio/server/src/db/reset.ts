import fs from 'node:fs';
import { config } from '../config.js';

// Deletes the SQLite database and generated media. Default data is re-seeded on next start.
for (const p of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) fs.rmSync(p, { force: true });
fs.rmSync(config.mediaDir, { recursive: true, force: true });
console.log(`Removed ${config.dbPath} and ${config.mediaDir}. Restart the server to re-install the default data.`);
