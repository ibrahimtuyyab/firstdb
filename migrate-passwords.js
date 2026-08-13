// Give every teacher and student their own password column, then set the ones
// that are still empty to that role's default.
//
//   node migrate-passwords.js
//
// Safe to run more than once: it only ever fills in a row whose password is
// NULL, so anyone who has already chosen their own password keeps it.
//
// Set DATABASE_URL (or DATABASE_URL_UNPOOLED) to run this against the hosted
// database instead of the local one.
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const dbConfig = require('./db-config');
const pool = new Pool(dbConfig());

const BCRYPT_ROUNDS = 10;
const DEFAULT_TEACHER_PASSWORD = process.env.DEFAULT_TEACHER_PASSWORD || 'teacher1234';
const DEFAULT_STUDENT_PASSWORD = process.env.DEFAULT_STUDENT_PASSWORD || 'student1234';

async function migrate() {
  // Wide enough for a bcrypt hash, which is always 60 characters.
  await pool.query('ALTER TABLE teachers ADD COLUMN IF NOT EXISTS password VARCHAR(255)');
  await pool.query('ALTER TABLE items ADD COLUMN IF NOT EXISTS password VARCHAR(255)');

  // Everyone on the same default shares one hash. That is no weaker than the
  // single shared password it replaces, and each person's first change gives
  // them a private hash of their own.
  const teacherHash = await bcrypt.hash(DEFAULT_TEACHER_PASSWORD, BCRYPT_ROUNDS);
  const studentHash = await bcrypt.hash(DEFAULT_STUDENT_PASSWORD, BCRYPT_ROUNDS);

  const teachers = await pool.query(
    'UPDATE teachers SET password = $1 WHERE password IS NULL',
    [teacherHash]
  );
  const students = await pool.query(
    'UPDATE items SET password = $1 WHERE password IS NULL',
    [studentHash]
  );

  const totals = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM teachers) AS teachers,
      (SELECT COUNT(*)::int FROM teachers WHERE password IS NOT NULL) AS teachers_with_password,
      (SELECT COUNT(*)::int FROM items) AS students,
      (SELECT COUNT(*)::int FROM items WHERE password IS NOT NULL) AS students_with_password
  `);

  console.log(`\nSet the default password on ${teachers.rowCount} teacher(s) and ${students.rowCount} student(s).`);
  console.table(totals.rows);
  console.log(`Teachers who have not changed it log in with: ${DEFAULT_TEACHER_PASSWORD}`);
  console.log(`Students who have not changed it log in with: ${DEFAULT_STUDENT_PASSWORD}`);
  console.log('Admin passwords are untouched.\n');
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
