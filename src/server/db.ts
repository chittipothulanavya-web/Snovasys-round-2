import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'ledgerline.db');
export const db = new Database(DB_PATH);

// Enable WAL mode for high concurrency & atomic transactional commits
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function initDatabase() {
  // 1. Users
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('administrator', 'account_holder', 'auditor')),
      avatar TEXT,
      password_hash TEXT,
      salt TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  // Ensure password columns exist if table was already created
  try {
    db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN salt TEXT;`);
  } catch {}

  // 2. Accounts
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      account_number TEXT UNIQUE NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id),
      currency TEXT NOT NULL DEFAULT 'INR',
      balance REAL NOT NULL DEFAULT 0.0 CHECK (balance >= -overdraft_limit),
      overdraft_limit REAL NOT NULL DEFAULT 0.0 CHECK (overdraft_limit >= 0.0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // 3. System Vault Account (tracks net external deposits and withdrawals)
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_vault (
      id TEXT PRIMARY KEY,
      balance REAL NOT NULL DEFAULT 0.0,
      total_deposited REAL NOT NULL DEFAULT 0.0,
      total_withdrawn REAL NOT NULL DEFAULT 0.0,
      updated_at TEXT NOT NULL
    );
  `);

  // 4. Ledger Entries (Double-Entry, Cryptographically Chained, Append-Only)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      transaction_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
      amount REAL NOT NULL CHECK (amount > 0),
      running_balance REAL NOT NULL,
      counterparty_account_id TEXT,
      description TEXT NOT NULL,
      initiated_by_user_id TEXT NOT NULL REFERENCES users(id),
      idempotency_key TEXT,
      timestamp TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );
  `);

  // 5. Audit Refusals (Records every declined or failed transaction attempt)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_refusals (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      initiated_by_user_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      account_id TEXT NOT NULL,
      attempted_amount REAL NOT NULL,
      running_balance_at_attempt REAL NOT NULL,
      counterparty_account_id TEXT,
      reason TEXT NOT NULL,
      details TEXT NOT NULL,
      idempotency_key TEXT
    );
  `);

  // 6. Idempotency Records
  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('IN_FLIGHT', 'RESOLVED', 'FAILED')),
      response_status INTEGER,
      response_body TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      hit_count INTEGER DEFAULT 1
    );
  `);

  // 7. Anomaly & Review Records
  db.exec(`
    CREATE TABLE IF NOT EXISTS anomaly_flags (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      suggested_action TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'acknowledged', 'dismissed')),
      human_review_note TEXT,
      reviewed_by_user_id TEXT,
      reviewed_at TEXT
    );
  `);

  // 8. Enforce Immutability via Database Triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS prevent_ledger_update
    BEFORE UPDATE ON ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'Ledger entries are strictly immutable. UPDATE is prohibited.');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_ledger_delete
    BEFORE DELETE ON ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'Ledger entries are strictly immutable. DELETE is prohibited.');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_refusal_update
    BEFORE UPDATE ON audit_refusals
    BEGIN
      SELECT RAISE(ABORT, 'Audit refusals are strictly immutable. UPDATE is prohibited.');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_refusal_delete
    BEFORE DELETE ON audit_refusals
    BEGIN
      SELECT RAISE(ABORT, 'Audit refusals are strictly immutable. DELETE is prohibited.');
    END;
  `);

  seedInitialData();
}

export function computeLedgerHash(entry: {
  sequence: number;
  prevHash: string;
  transactionId: string;
  accountId: string;
  direction: string;
  amount: number;
  runningBalance: number;
  timestamp: string;
}): string {
  const payload = `${entry.sequence}|${entry.prevHash}|${entry.transactionId}|${entry.accountId}|${entry.direction}|${entry.amount.toFixed(2)}|${entry.runningBalance.toFixed(2)}|${entry.timestamp}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function computeRequestHash(payload: Record<string, unknown>): string {
  const sortedKeys = Object.keys(payload).sort();
  const canonical = sortedKeys.map(k => `${k}:${payload[k]}`).join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function seedInitialData() {
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  if (userCount > 0) return;

  const now = new Date().toISOString();

  // Insert Users with standard seed password "password123"
  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, role, avatar, password_hash, salt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const defaultSalt = generateSalt();
  const defaultHash = hashPassword('password123', defaultSalt);

  const users = [
    { id: 'usr-admin-1', name: 'Clara Oswald', email: 'clara.admin@ledgerline.internal', role: 'administrator', avatar: 'CO' },
    { id: 'usr-holder-alice', name: 'Alice Chen', email: 'alice@ledgerline.internal', role: 'account_holder', avatar: 'AC' },
    { id: 'usr-holder-bob', name: 'Bob Patel', email: 'bob@ledgerline.internal', role: 'account_holder', avatar: 'BP' },
    { id: 'usr-holder-charlie', name: 'Charlie Davis', email: 'charlie@ledgerline.internal', role: 'account_holder', avatar: 'CD' },
    { id: 'usr-holder-new', name: 'Samira Khan (New User)', email: 'samira.new@ledgerline.internal', role: 'account_holder', avatar: 'SK' },
    { id: 'usr-auditor-1', name: 'Dave Thorne', email: 'dave.auditor@ledgerline.internal', role: 'auditor', avatar: 'DT' },
  ];

  for (const u of users) {
    insertUser.run(u.id, u.name, u.email, u.role, u.avatar, defaultHash, defaultSalt);
  }

  // System Vault record
  db.prepare(`
    INSERT INTO system_vault (id, balance, total_deposited, total_withdrawn, updated_at)
    VALUES ('vault-main', 0.0, 0.0, 0.0, ?)
  `).run(now);

  // Initial Customer Accounts
  const insertAccount = db.prepare(`
    INSERT INTO accounts (id, account_number, owner_id, currency, balance, overdraft_limit, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedAccounts = [
    { id: 'acc-new-customer', number: 'ACC-NEW-01', owner: 'usr-holder-new', balance: 0.0, overdraft: 0.0 }, // Fresh new account starting with ₹0.00 and zero transactions!
    { id: 'acc-alice-primary', number: 'ACC-ALICE-01', owner: 'usr-holder-alice', balance: 50000.0, overdraft: 0.0 },
    { id: 'acc-alice-ops', number: 'ACC-ALICE-02', owner: 'usr-holder-alice', balance: 12500.0, overdraft: 5000.0 }, // Overdraft limit ₹5,000 allowed
    { id: 'acc-bob-vendor', number: 'ACC-BOB-01', owner: 'usr-holder-bob', balance: 10000.0, overdraft: 0.0 },
    { id: 'acc-charlie-payroll', number: 'ACC-CHARLIE-01', owner: 'usr-holder-charlie', balance: 25000.0, overdraft: 0.0 },
  ];

  for (const acc of seedAccounts) {
    insertAccount.run(acc.id, acc.number, acc.owner, 'INR', 0.0, acc.overdraft, 'active', now, now);
  }

  // Initialize accounts with atomic initial deposits so ledger hash chain and system vault balance are 100% balanced
  let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  let seq = 1;
  let totalDeposited = 0;

  for (const acc of seedAccounts) {
    if (acc.balance > 0) {
      const txId = `tx-genesis-${acc.number.toLowerCase()}`;
      const entryId = `entry-gen-${acc.id}`;
      const amount = acc.balance;
      totalDeposited += amount;

      const hash = computeLedgerHash({
        sequence: seq,
        prevHash,
        transactionId: txId,
        accountId: acc.id,
        direction: 'credit',
        amount,
        runningBalance: amount,
        timestamp: now,
      });

      db.prepare(`
        INSERT INTO ledger_entries (
          sequence, id, transaction_id, operation_type, account_id, direction, amount,
          running_balance, counterparty_account_id, description, initiated_by_user_id,
          idempotency_key, timestamp, prev_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        seq, entryId, txId, 'deposit', acc.id, 'credit', amount,
        amount, 'vault-main', `Initial Genesis Funding for ${acc.number}`, 'usr-admin-1',
        `genesis-${acc.id}`, now, prevHash, hash
      );

      db.prepare(`UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`).run(amount, now, acc.id);

      prevHash = hash;
      seq++;
    }
  }

  // Update Vault balance and totals
  db.prepare(`
    UPDATE system_vault
    SET balance = balance + ?, total_deposited = total_deposited + ?, updated_at = ?
    WHERE id = 'vault-main'
  `).run(totalDeposited, totalDeposited, now);

  // Seed sample initial anomaly flag for audit review demo
  db.prepare(`
    INSERT INTO anomaly_flags (id, account_id, severity, title, description, suggested_action, detected_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'anom-seed-1',
    'acc-alice-ops',
    'low',
    'Authorized Overdraft Facility Active',
    'Account ACC-ALICE-02 has an authorized overdraft facility of ₹5,000.00. Balance is currently within positive limits.',
    'Monitor ledger running balances if balance dips below ₹0.00 up to ₹-5,000.00.',
    now,
    'pending_review'
  );
}
