const env = {};
Get-Content 'apps/server/.env' | % { if ($_ -match '^([^#=]+)=(.*)$') { $env[$Matches[1]] = $Matches[2] } }
$u = $env['DATABASE_ADMIN_URL'] -replace '/huriro$', '/huriro_m3test';
const postgres = require('postgres');
const s = postgres(u);
const r = await s``select tablename from pg_tables where tablename like 'agent%'``;
console.log(r.map(x=>x.tablename).join(','));
await s``select version()``;
await s.end();
