const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database(path.join(__dirname, "data.db"));

app.use(cors());
app.use(express.json());

// ================== SCHEMA ==================
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT UNIQUE,
  password TEXT,
  workspace_id INTEGER
);

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  workspace_id INTEGER
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  amount REAL,
  payer_member_id INTEGER,
  workspace_id INTEGER
);

CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id INTEGER,
  member_id INTEGER,
  share_amount REAL
);
`);

const run = (q, p = []) => db.prepare(q).run(p);
const get = (q, p = []) => db.prepare(q).get(p);
const all = (q, p = []) => db.prepare(q).all(p);

// ================== AUTH ==================
app.post("/api/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({
      error: "Name, email and password are required"
    });
  }

  const existing = get(
    "SELECT id FROM users WHERE email = ?",
    [email]
  );

  if (existing) {
    return res.status(409).json({
      error: "User already exists"
    });
  }

  const ws = run(
    "INSERT INTO workspaces (name) VALUES (?)",
    [`${name}'s workspace`]
  );

  const user = run(
    "INSERT INTO users (name, email, password, workspace_id) VALUES (?,?,?,?)",
    [name, email, password, ws.lastInsertRowid]
  );

  res.json({
    id: user.lastInsertRowid,
    name,
    workspace_id: ws.lastInsertRowid
  });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password required"
    });
  }

  const user = get(
    "SELECT id, name, workspace_id FROM users WHERE email=? AND password=?",
    [email, password]
  );

  if (!user) return res.status(401).json({ error: "Invalid login" });
  res.json(user);
});

// ================== MEMBERS ==================
app.get("/api/members", (req, res) => {
  const { workspace_id } = req.query;
  res.json(all("SELECT * FROM members WHERE workspace_id=?", [workspace_id]));
});

app.post("/api/members", (req, res) => {
  const { name, workspace_id } = req.body;
  const m = run(
    "INSERT INTO members (name, workspace_id) VALUES (?,?)",
    [name, workspace_id]
  );
  res.json({ id: m.lastInsertRowid, name });
});

app.delete("/api/members/:id", (req, res) => {
  const memberId = Number(req.params.id);

  // check if member used in any expense
  const used = all(
    "SELECT 1 FROM expense_shares WHERE member_id = ? LIMIT 1",
    [memberId]
  );

  if (used.length > 0) {
    return res.status(409).json({
      error: "Member is used in expenses. Cannot delete."
    });
  }

  run("DELETE FROM members WHERE id = ?", [memberId]);
  res.json({ ok: true });
});

// ================== EXPENSES ==================
app.get("/api/expenses", (req, res) => {
  const { workspace_id } = req.query;
  res.json(all("SELECT * FROM expenses WHERE workspace_id=?", [workspace_id]));
});

app.post("/api/expenses", (req, res) => {
  const { title, amount, payer_member_id, shares, workspace_id } = req.body;

  const e = run(
    "INSERT INTO expenses (title, amount, payer_member_id, workspace_id) VALUES (?,?,?,?)",
    [title, amount, payer_member_id, workspace_id]
  );

  shares.forEach(s =>
    run(
      "INSERT INTO expense_shares (expense_id, member_id, share_amount) VALUES (?,?,?)",
      [e.lastInsertRowid, s.member_id, s.share_amount]
    )
  );

  res.json({ ok: true });
});
app.delete("/api/expenses/:id", (req, res) => {
  const expenseId = Number(req.params.id);

  run("DELETE FROM expense_shares WHERE expense_id = ?", [expenseId]);
  run("DELETE FROM expenses WHERE id = ?", [expenseId]);

  res.json({ ok: true });
});

// ================== SETTLEMENT ==================
app.get("/api/settle", (req, res) => {
  const { workspace_id } = req.query;

  const members = all("SELECT * FROM members WHERE workspace_id=?", [workspace_id]);
  const expenses = all("SELECT * FROM expenses WHERE workspace_id=?", [workspace_id]);

  const net = {};
  members.forEach(m => (net[m.id] = 0));

  expenses.forEach(e => {
    net[e.payer_member_id] += e.amount;
    const shares = all(
      "SELECT * FROM expense_shares WHERE expense_id=?",
      [e.id]
    );
    shares.forEach(s => (net[s.member_id] -= s.share_amount));
  });

  res.json(net);
});

app.listen(4000, () =>
  console.log("Backend running at http://localhost:4000")
);
