import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { seedUsers } from './db/seed.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
migrate(db);
seedUsers(db);

const app = buildApp({ db, logger: true });
app.addHook('onClose', async () => db.close());

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}
