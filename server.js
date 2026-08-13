const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

// On serverless the filesystem is read-only apart from /tmp.
const upload = multer({ dest: process.env.VERCEL ? '/tmp' : 'uploads/' });
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool(require('./db-config')());

// A pool error must not take the whole process down.
pool.on('error', (err) => console.error('pg pool error:', err.message));

// Every query below names its tables unqualified, so the connection must be
// able to see the public schema. A pooled connection can arrive with an empty
// search_path, so set it rather than trusting the server default.
pool.on('connect', (client) => {
  client.query('SET search_path TO public').catch((err) =>
    console.error('could not set search_path:', err.message)
  );
});

// ---------------------------------------------------------------- roles ----
// admin   - username + password. Sees and edits everything.
// teacher - employee no + department + shared password. Sees, adds and edits
//           only the students of their own department. Cannot delete.
// student - id/roll no + shared password. Sees only their own record.
const ROLES = { ADMIN: 'admin', TEACHER: 'teacher', STUDENT: 'student' };

// Teachers and students all share one password (see migrate-roles.js).
const SHARED_PASSWORD = process.env.SHARED_PASSWORD || '1234';

// ---------------------------------------------------------------- login ----
app.post('/api/login', async (req, res) => {
  const role = String(req.body.role || '').toLowerCase();
  const { password } = req.body;

  try {
    if (role === ROLES.ADMIN) {
      const { username } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }
      const result = await pool.query(
        'SELECT id, username, password FROM users WHERE username = $1',
        [username]
      );
      const admin = result.rows[0];
      if (!admin || !(await bcrypt.compare(password, admin.password))) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      return res.json(issueToken({
        role: ROLES.ADMIN,
        id: admin.id,
        username: admin.username,
        displayName: admin.username,
      }));
    }

    if (role === ROLES.TEACHER) {
      const { employeeNo, dept } = req.body;
      if (!employeeNo || !dept || !password) {
        return res.status(400).json({ error: 'Employee no, department and password are required' });
      }
      if (password !== SHARED_PASSWORD) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
      const result = await pool.query(
        'SELECT id, employee_no, name, dept FROM teachers WHERE employee_no = $1 AND dept = $2',
        [String(employeeNo).trim(), dept]
      );
      const teacher = result.rows[0];
      if (!teacher) {
        return res.status(401).json({ error: 'No teacher found with that employee no in that department' });
      }
      return res.json(issueToken({
        role: ROLES.TEACHER,
        id: teacher.id,
        employeeNo: teacher.employee_no,
        dept: teacher.dept,
        displayName: teacher.name,
      }));
    }

    if (role === ROLES.STUDENT) {
      const { studentId } = req.body;
      if (!studentId || !password) {
        return res.status(400).json({ error: 'Id no and password are required' });
      }
      if (password !== SHARED_PASSWORD) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
      const key = String(studentId).trim();
      const result = await pool.query(
        'SELECT id, name, dept FROM items WHERE id::text = $1 OR roll_no = $1',
        [key]
      );
      const student = result.rows[0];
      if (!student) {
        return res.status(401).json({ error: 'No student found with that id no' });
      }
      return res.json(issueToken({
        role: ROLES.STUDENT,
        itemId: student.id,
        dept: student.dept,
        displayName: student.name,
      }));
    }

    return res.status(400).json({ error: 'Unknown role' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function issueToken(payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });
  return { token, ...payload };
}

// ----------------------------------------------------------- middleware ----
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Restrict a route to specific roles. Use after requireAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    next();
  };
}

// Can this user see/touch this particular item row?
function canAccessItem(user, item) {
  if (!item) return false;
  if (user.role === ROLES.ADMIN) return true;
  if (user.role === ROLES.TEACHER) return item.dept === user.dept;
  return String(item.id) === String(user.itemId);
}

// Who am i - lets each page render the right controls.
app.get('/api/me', requireAuth, (req, res) => {
  const { role, username, employeeNo, dept, itemId, displayName } = req.user;
  res.json({ role, username, employeeNo, dept, itemId, displayName });
});

// Department list, used by the teacher login form.
app.get('/api/departments', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT dept FROM teachers UNION SELECT DISTINCT dept FROM items ORDER BY dept'
    );
    res.json(result.rows.map((r) => r.dept));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------ employees ----
// Employee (teacher) records are kept separately from the student records in
// items. Only an admin may list or change them; adding one also creates that
// person's login (employee no + department + shared password).
const EMPLOYEE_FIELDS = ['name', 'dept', 'designation', 'email', 'contact_no', 'qualification', 'joined_on', 'photo'];

app.get('/api/teachers', requireAuth, requireRole(ROLES.ADMIN), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM teachers ORDER BY employee_no');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teachers/:id', requireAuth, requireRole(ROLES.ADMIN), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM teachers WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Employee not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teachers', requireAuth, requireRole(ROLES.ADMIN), async (req, res) => {
  const { employee_no, name, dept } = req.body;
  if (!employee_no || !name || !dept) {
    return res.status(400).json({ error: 'Employee no, name and department are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO teachers (employee_no, name, dept, designation, email, contact_no, qualification, joined_on, photo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        String(employee_no).trim(), name, dept, req.body.designation, req.body.email,
        req.body.contact_no, req.body.qualification, req.body.joined_on, req.body.photo
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That employee no is already in use' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teachers/:id', requireAuth, requireRole(ROLES.ADMIN), async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM teachers WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Employee not found' });

    const current = existing.rows[0];
    const next = { employee_no: (req.body.employee_no ?? current.employee_no).toString().trim() };
    EMPLOYEE_FIELDS.forEach((f) => { next[f] = req.body[f] ?? current[f]; });
    if (!next.employee_no || !next.name || !next.dept) {
      return res.status(400).json({ error: 'Employee no, name and department are required' });
    }

    const result = await pool.query(
      `UPDATE teachers SET employee_no=$1, name=$2, dept=$3, designation=$4, email=$5,
       contact_no=$6, qualification=$7, joined_on=$8, photo=$9 WHERE id=$10 RETURNING *`,
      [
        next.employee_no, next.name, next.dept, next.designation, next.email,
        next.contact_no, next.qualification, next.joined_on, next.photo, req.params.id
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That employee no is already in use' });
    }
    res.status(500).json({ error: err.message });
  }
});

// IMPORT employees from CSV - admin only.
// Columns: employee_no, name, dept, designation, email, contact_no, qualification, joined_on
app.post('/api/teachers/import', requireAuth, requireRole(ROLES.ADMIN), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const rows = [];
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (row) => rows.push(row))
    .on('end', async () => {
      let inserted = 0;
      let skipped = 0;
      const errors = [];

      for (const row of rows) {
        const employeeNo = (row.employee_no || row.employeeNo || '').trim();
        if (!employeeNo || !row.name || !row.dept) {
          skipped++;
          errors.push({ row, error: 'employee_no, name and dept are all required' });
          continue;
        }
        try {
          const result = await pool.query(
            `INSERT INTO teachers (employee_no, name, dept, designation, email, contact_no, qualification, joined_on)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (employee_no) DO NOTHING
             RETURNING id`,
            [
              employeeNo, row.name, row.dept, row.designation, row.email,
              row.contact_no, row.qualification, row.joined_on
            ]
          );
          if (result.rowCount) inserted++;
          else {
            skipped++;
            errors.push({ row, error: 'Employee no already exists' });
          }
        } catch (err) {
          skipped++;
          errors.push({ row, error: err.message });
        }
      }

      fs.unlinkSync(req.file.path);
      res.json({ inserted, failed: skipped, errors });
    });
});

app.delete('/api/teachers/:id', requireAuth, requireRole(ROLES.ADMIN), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM teachers WHERE id = $1 RETURNING employee_no', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Employee not found' });
    res.json({ message: 'Employee deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------- read ----
// GET all items, scoped to what the role is allowed to see.
app.get('/api/items', requireAuth, async (req, res) => {
  try {
    if (req.user.role === ROLES.STUDENT) {
      const own = await pool.query('SELECT * FROM items WHERE id = $1', [req.user.itemId]);
      return res.json(own.rows);
    }
    if (req.user.role === ROLES.TEACHER) {
      const mine = await pool.query(
        'SELECT * FROM items WHERE dept = $1 ORDER BY id',
        [req.user.dept]
      );
      return res.json(mine.rows);
    }
    const result = await pool.query('SELECT * FROM items ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET one item
app.get('/api/items/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    const item = result.rows[0];
    if (!item) return res.status(404).json({ error: 'Record not found' });
    if (!canAccessItem(req.user, item)) {
      return res.status(403).json({ error: 'You do not have access to that record' });
    }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------- write ----
// POST new item (add) - teachers may only add into their own department.
app.post('/api/items', requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER), async (req, res) => {
  const { name, id, email, father_name, contact_no, roll_no, class: className, batch, photo } = req.body;
  const dept = req.user.role === ROLES.TEACHER ? req.user.dept : req.body.dept;
  if (!dept) return res.status(400).json({ error: 'Department is required' });

  try {
    const result = await pool.query(
      `INSERT INTO items (name, id, email, dept, father_name, contact_no, roll_no, class, batch, photo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, id, email, dept, father_name, contact_no, roll_no, className, batch, photo]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update item (edit) - teachers may only edit their own department, and
// may not move a student out of it.
app.put('/api/items/:id', requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER), async (req, res) => {
  const { name, email, father_name, contact_no, roll_no, class: className, batch, photo } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Record not found' });
    if (!canAccessItem(req.user, existing.rows[0])) {
      return res.status(403).json({ error: 'You can only edit your own department' });
    }
    const dept = req.user.role === ROLES.TEACHER ? req.user.dept : (req.body.dept ?? existing.rows[0].dept);

    const result = await pool.query(
      `UPDATE items SET name=$1, email=$2, dept=$3, father_name=$4, contact_no=$5,
       roll_no=$6, class=$7, batch=$8, photo=$9 WHERE id=$10 RETURNING *`,
      [name, email, dept, father_name, contact_no, roll_no, className, batch, photo, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// IMPORT items from CSV - teachers import into their own department only.
app.post('/api/items/import', requireAuth, requireRole(ROLES.ADMIN, ROLES.TEACHER), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const results = [];
  const errors = [];

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (row) => results.push(row))
    .on('end', async () => {
      let inserted = 0;
      let skipped = 0;
      for (const row of results) {
        // A teacher's import is filed under their department whatever the CSV says.
        const dept = req.user.role === ROLES.TEACHER ? req.user.dept : row.dept;
        if (!dept) {
          skipped++;
          errors.push({ row, error: 'Missing dept' });
          continue;
        }
        try {
          const result = await pool.query(
            `INSERT INTO items (id, name, email, dept, father_name, contact_no, roll_no, class, batch)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO NOTHING
             RETURNING id`,
            [
              row.id, row.name, row.email, dept,
              row.father_name, row.contact_no, row.roll_no, row.class, row.batch
            ]
          );
          if (result.rowCount) inserted++;
          else {
            skipped++;
            errors.push({ row, error: 'Id no already exists' });
          }
        } catch (err) {
          skipped++;
          errors.push({ row, error: err.message });
        }
      }
      fs.unlinkSync(req.file.path); // temp file delete karna
      res.json({ inserted, failed: skipped, errors });
    });
});

// --------------------------------------------------------------- delete ----
// DELETE item - admin only.
app.delete('/api/items/:id', requireAuth, requireRole(ROLES.ADMIN), async (req, res) => {
  try {
    await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    res.json({ message: 'Item deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE ALL items - admin only, re-confirmed with the admin's own password.
app.delete('/api/items/all/confirm', requireAuth, requireRole(ROLES.ADMIN), async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });

  try {
    const account = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    if (!account.rows[0] || !(await bcrypt.compare(password, account.rows[0].password))) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    await pool.query('DELETE FROM items');
    res.json({ message: 'All records deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serverless platforms import the app and drive it themselves, so only bind a
// port when this file is run directly (`node server.js`).
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
