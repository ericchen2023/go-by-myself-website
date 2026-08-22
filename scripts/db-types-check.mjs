import { readFile } from 'node:fs/promises';

const declarations = await readFile('src/production/database.types.js', 'utf8');
const migration = await readFile('supabase/migrations/202608220001_initial_schema.sql', 'utf8');

for (const table of ['deliveries', 'delivery_status_history', 'vehicle_commands', 'pickup_credentials']) {
  const migrationMentionsTable = new RegExp(`(?:public|private)\\.${table}\\b`).test(migration);
  if (!declarations.includes(table) || !migrationMentionsTable) {
    throw new Error(`Database declaration drift: missing ${table}`);
  }
}

process.stdout.write('Database declarations contain the critical schema surface.\n');
