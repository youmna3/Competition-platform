import { execFileSync } from 'node:child_process';

const projectRef = required('STAGING_PROJECT_REF');
if (projectRef === 'kdkwctsqfpwreebhftyn') throw new Error('Refusing to treat production as staging.');
const output = execFileSync('npx', ['supabase', 'migration', 'list', '--project-ref', projectRef, '--output', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' });
const parsed = JSON.parse(output);
const missing = parsed.migrations.filter((migration) => migration.local && !migration.remote);
process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
if (missing.length) throw new Error(`Staging has unapplied migrations: ${missing.map((migration) => migration.local).join(', ')}`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
