const Database = require("better-sqlite3");

const db = new Database("data.db");

const users = db
  .prepare("SELECT id, email, password, workspace_id FROM users")
  .all();

console.log(users);
