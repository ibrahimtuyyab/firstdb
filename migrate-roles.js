// One-time (idempotent) setup for the three login roles.
//   node migrate-roles.js
//
//   admin   - logs in with username + password (users table, bcrypt hashed)
//   teacher - logs in with employee no + department + shared password
//             (teachers table); sees only their own department's students
//   student - logs in with their id/roll no + shared password (items table);
//             sees only their own record
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// One teacher seeded per department that exists in items.
const TEACHER_SEED = [
  { employee_no: 'EMP-1001', name: 'Ayesha Siddiqui', dept: 'CS', designation: 'Assistant Professor' },
  { employee_no: 'EMP-1002', name: 'Bilal Ahmed', dept: 'BBA', designation: 'Lecturer' },
  { employee_no: 'EMP-1003', name: 'Sana Malik', dept: 'English', designation: 'Lecturer' },
  { employee_no: 'EMP-1004', name: 'Hamza Raza', dept: 'Pharm D', designation: 'Assistant Professor' },
  { employee_no: 'EMP-1005', name: 'Fatima Noor', dept: 'IT', designation: 'Lab Instructor' },
];

async function migrate() {
  // --- admins live in users ---
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'admin'
  `);

  // Students/teachers are not users rows; drop the earlier link column.
  await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS item_id');

  await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
  await pool.query(`UPDATE users SET role = 'admin' WHERE role <> 'admin'`);
  await pool.query(`
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin'))
  `);

  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
    EXCEPTION WHEN duplicate_table THEN NULL;
    END $$
  `);

  // The existing account becomes the admin. Its old hash has an unknown
  // plaintext, so reset it to the password the hardcoded login used.
  const hash = await bcrypt.hash('1234', 10);
  await pool.query(
    `UPDATE users SET role = 'admin', password = $1 WHERE username = 'ibrahim'`,
    [hash]
  );

  // --- teachers / employees ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY,
      employee_no VARCHAR(30) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      dept VARCHAR(50) NOT NULL
    )
  `);

  // Employee records are kept separately from student records, so they carry
  // their own fields rather than reusing the items columns.
  for (const col of [
    'designation VARCHAR(60)',
    'email VARCHAR(120)',
    'contact_no VARCHAR(40)',
    'qualification VARCHAR(120)',
    'joined_on VARCHAR(20)',
    'photo TEXT',
  ]) {
    await pool.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS ${col}`);
  }

  // Seeded only if missing - an admin editing them later is not overwritten.
  for (const t of TEACHER_SEED) {
    await pool.query(
      `INSERT INTO teachers (employee_no, name, dept, designation)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_no) DO NOTHING`,
      [t.employee_no, t.name, t.dept, t.designation]
    );
    // Fill in seed rows created before the extra columns existed.
    await pool.query(
      `UPDATE teachers SET designation = $2 WHERE employee_no = $1 AND designation IS NULL`,
      [t.employee_no, t.designation]
    );
  }

  // Students authenticate straight off items, so an id lookup should be fast.
  await pool.query('CREATE INDEX IF NOT EXISTS items_roll_no_idx ON items (roll_no)');

  const admins = await pool.query('SELECT id, username, role FROM users ORDER BY id');
  const teachers = await pool.query('SELECT employee_no, name, dept FROM teachers ORDER BY employee_no');
  const depts = await pool.query('SELECT dept, COUNT(*)::int AS students FROM items GROUP BY dept ORDER BY dept');

  console.log('\nAdmins');
  console.table(admins.rows);
  console.log('Teachers (password 1234)');
  console.table(teachers.rows);
  console.log('Departments');
  console.table(depts.rows);
  console.log('Students log in with their id or roll no + password 1234.\n');
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
