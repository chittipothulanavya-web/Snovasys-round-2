# LedgerLine: Core Banking & Concurrency-Proof Double-Entry Ledger

LedgerLine is an institutional-grade, concurrency-safe double-entry banking and ledger system. It enforces mathematical conservation of money, exact-once idempotency semantics, strict role-based access control, append-only cryptographic tamper-evidence, and comprehensive audit statements that record both posted transactions and refused attempts.

---

## 1. Quick Start & Seed Credentials

### Demo Personas & Credentials
The application includes full email/password authentication and registration. Pre-configured seed personas (default password: `password123`) can be accessed via the sign-in screen, the quick-fill buttons, or via `Authorization: Bearer <token>`:

| Persona | Role | User ID | Email | Password | Permissions |
|---|---|---|---|---|---|
| **Samira Khan** | **Account Holder** | `usr-holder-new` | `samira.new@ledgerline.internal` | `password123` | Fresh user: Starts at ₹0.00 with 0 transaction history |
| **Alice Chen** | **Account Holder** | `usr-holder-alice` | `alice@ledgerline.internal` | `password123` | Move money only from own accounts (`ACC-ALICE-01`, `ACC-ALICE-02`), view own statements |
| **Bob Patel** | **Account Holder** | `usr-holder-bob` | `bob@ledgerline.internal` | `password123` | Move money only from `ACC-BOB-01`, view own statements |
| **Clara Oswald** | **Administrator** | `usr-admin-1` | `clara.admin@ledgerline.internal` | `password123` | Create accounts, set overdraft limits, execute audits, review AI anomalies, view system invariant |
| **Dave Thorne** | **Auditor** | `usr-auditor-1` | `dave.auditor@ledgerline.internal` | `password123` | Read-only access to all accounts, entire ledger, all refused attempts, and cryptographic proofs. Strictly barred from moving money. |

### Running the System
```bash
# Install dependencies
npm install

# Run the test suite (executes all concurrency, race, idempotency, and invariant tests)
npm test

# Start the full-stack development server
npm run dev
```

---

## 2. The Core Guarantees

### 1. Conservation of Money
- **Invariant**:
  $$\sum \text{Customer Account Balances} = \text{Vault Deposits} - \text{Vault Withdrawals}$$
- Internal transfers write equal debit and credit journal entries ($\Delta \text{System} = 0.00$).
- Total system money changes strictly through external deposits (Cash Vault $\rightarrow$ Account) and external withdrawals (Account $\rightarrow$ Cash Vault).
- Real-time invariant verification is available via `GET /api/audit/invariant` and displayed live on the dashboard health bar.

### 2. Exact-Once Execution (Idempotency)
- Money-moving endpoints accept client-provided `Idempotency-Key` headers.
- Canonical SHA-256 request payload hashing detects semantic mutation attacks.
- Replayed requests return the original response body and HTTP status code with `X-Idempotent-Replay: true`.
- Concurrent in-flight requests with the identical key are protected by an atomic mutex returning `HTTP 409 Conflict`.

### 3. Concurrency & Race Condition Elimination
- All operations execute inside SQLite `db.transaction()` operating with Write-Ahead Logging (WAL) and `BEGIN IMMEDIATE` locks.
- Reciprocal transfers ($A \rightarrow B$ and $B \rightarrow A$) lock accounts in deterministic lexicographical order (`[src, dst].sort()`), preventing deadlocks.
- Overdraft limits are strictly enforced server-side with database `CHECK (balance >= -overdraft_limit)`.

### 4. Cryptographic Tamper-Evidence & Append-Only Record
- Every ledger posting is hashed using SHA-256 with the previous entry's hash:
  $$\text{Hash}_n = \text{SHA256}(\text{Seq}_n \parallel \text{PrevHash}_{n-1} \parallel \text{TxID} \parallel \text{Account} \parallel \text{Amount} \parallel \text{Balance} \parallel \text{Timestamp})$$
- Database triggers abort any `UPDATE` or `DELETE` attempt on `ledger_entries` or `audit_refusals`.
- Interactive tamper simulator in the UI proves that modifying even one byte in a historical record causes `GET /api/audit/verify-chain` to flag the exact corrupt sequence number.

### 5. Audit Statement with Refused Attempts
- Every refusal (insufficient funds, overdraft exceeded, unauthorized cross-account transfer, account frozen, duplicate key payload mismatch) is permanently recorded in `audit_refusals`.
- Per-account statements (`GET /api/accounts/:id/statement`) display debits, credits, and refused attempts in unified chronological order with running balances.

### 6. AI Anomaly Review Boundary
- Powered by Gemini (`gemini-3.8-flash`) with deterministic financial heuristics fallback.
- AI **never** moves or authorises money.
- AI flags suspicious patterns (rapid velocity, repeated rejections, abnormal amounts) for Human Auditor/Admin review.
- The human officer's signed decision (`acknowledged` or `dismissed`) is logged permanently in the audit record.

---

## 3. API Reference

| Endpoint | Method | Allowed Roles | Description |
|---|---|---|---|
| `/api/auth/register` | `POST` | Public | Register new user with hashed password & ₹0 starting account |
| `/api/auth/login` | `POST` | Public | Sign in with email & password, receives session Bearer token |
| `/api/auth/me` | `GET` | Authenticated | Get current authenticated user profile & role |
| `/api/auth/logout` | `POST` | Authenticated | Invalidate session token |
| `/api/accounts` | `GET` | All | List accounts (filtered by entitlement) |
| `/api/accounts/:id` | `GET` | Entitled / Admin / Auditor | View single account balance & metadata |
| `/api/accounts` | `POST` | Administrator | Create a new account with optional overdraft limit |
| `/api/accounts/:id/statement` | `GET` | Entitled / Admin / Auditor | Per-account statement (debits, credits, refusals) |
| `/api/transactions/deposit` | `POST` | Holder (own) / Admin | External cash deposit into account |
| `/api/transactions/withdraw` | `POST` | Holder (own) / Admin | External cash withdrawal from account |
| `/api/transactions/transfer` | `POST` | Holder (own) / Admin | Atomic double-entry transfer between accounts |
| `/api/audit/invariant` | `GET` | All | Real-time conservation invariant calculation |
| `/api/audit/verify-chain` | `GET` | All | Full SHA-256 cryptographic chain verification |
| `/api/audit/refusals` | `GET` | Administrator / Auditor | Global refused attempts audit log |
| `/api/anomalies` | `GET` | All | List anomaly flags |
| `/api/anomalies/scan` | `POST` | Administrator / Auditor | Trigger AI & heuristic anomaly detection scan |
| `/api/anomalies/:id/review` | `POST` | Administrator / Auditor | Submit human review decision on an anomaly flag |
| `/api/tests/run-concurrency` | `POST` | All | Interactive concurrency race & replay test runner |
