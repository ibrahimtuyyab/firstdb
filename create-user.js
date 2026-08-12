// Create or update a login account.
//   node create-user.js <username> <password> <admin|teacher|student> [item_id]
//
// item_id is only meaningful for students: it is the items.id row that student
// is allowed to view. Example:
//   node create-user.js sara sara123 teacher
//   node create-user.js ali ali123 student 42
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const ROLES = ['admin', 'teacher', 'student'];
const [username, password, role, itemId] = process.argv.slice(2);

if (!username || !password || !role) {
  console.error('Usage: node create-user.js <username> <password> <admin|teacher|student> [item_id]');
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`Invalid role "${role}". Must be one of: ${ROLES.join(', ')}`);
  process.exit(1);
}

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

(async () => {
  try {
    if (role === 'student' && itemId) {
      const check = await pool.query('SELECT id FROM items WHERE id = $1', [itemId]);
      if (check.rowCount === 0) {
        console.error(`No item with id ${itemId} — cannot link student to it.`);
        process.exitCode = 1;
        return;
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password, role, item_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE
         SET password = EXCLUDED.password,
             role = EXCLUDED.role,
             item_id = EXCLUDED.item_id
       RETURNING id, username, role, item_id`,
      [username, hash, role, itemId ? Number(itemId) : null]
    );
    console.log('Saved:', result.rows[0]);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
