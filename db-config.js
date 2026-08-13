// One place that decides which Postgres to talk to.
//
// Hosted Postgres (Neon, Supabase, Vercel Postgres) hands out a single
// connection string and requires TLS; local dev still uses the DB_* vars.
// If a hosted URL is set it wins.
//
// Prefer the direct endpoint over the pooled one. Neon's pooler refuses a
// search_path in the startup options and can hand back a connection whose
// search_path is empty, which makes every unqualified table name fail. The
// integration publishes the direct endpoint under these names.
const HOSTED_URL_VARS = [
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL',
];

module.exports = function dbConfig() {
  const name = module.exports.chosenVar();
  if (name) {
    return {
      connectionString: process.env[name],
      ssl: { rejectUnauthorized: false },
      max: 1,
    };
  }
  return {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  };
};

// Which variable won, and where it points with the credentials stripped out.
// Used by the /api/_diag route to tell one database from another.
module.exports.chosenVar = () => HOSTED_URL_VARS.find((v) => process.env[v]);

module.exports.describe = () => {
  const name = module.exports.chosenVar();
  if (!name) return { source: 'DB_* vars', host: process.env.DB_HOST, database: process.env.DB_NAME };
  try {
    const u = new URL(process.env[name]);
    return { source: name, host: u.hostname, database: u.pathname.replace('/', '') };
  } catch {
    return { source: name, host: 'unparseable', database: null };
  }
};
