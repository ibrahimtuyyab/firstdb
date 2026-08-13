// One place that decides which Postgres to talk to.
//
// Hosted Postgres (Neon, Supabase, Vercel Postgres) hands out a single
// connection string and requires TLS; local dev still uses the DB_* vars.
// If DATABASE_URL is set it wins.
module.exports = function dbConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
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
