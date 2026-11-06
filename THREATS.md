# LedgerLine Threat Model & Security Posture (THREATS.md)

This document formalizes the attack surfaces, concurrency hazards, ledger corruption vectors, mitigations, and accepted operational risks for **LedgerLine**.

---

## 1. Threat Matrix Summary

| Threat ID | Threat / Attack Vector | Severity | Mitigation Strategy | Test Verification |
|---|---|---|---|---|
| **THR-01** | Concurrent Overdraft Race (TOCTOU) | Critical | SQLite Serialized Transactions (`db.transaction`), Atomic Row Check + `CHECK (balance >= -overdraft_limit)` | `tests/ledger.test.ts` (Test 2) |
| **THR-02** | Network Timeout / Double-Click Replay | High | Header `Idempotency-Key`, canonical SHA-256 payload hashing, cached atomic response storage | `tests/ledger.test.ts` (Test 3) |
| **THR-03** | Idempotency Key Mutation Attack | High | Canonical payload hash verification (`request_hash`); rejection with `422 IDEMPOTENCY_CONFLICT` | `tests/ledger.test.ts` (Test 4) |
| **THR-04** | In-Flight Idempotency Race (Zero-ms Dual Call) | High | Atomic memory mutex + `IN_FLIGHT` DB status locking with HTTP 409 Conflict | `server.ts` & `ledger.ts` |
| **THR-05** | Cross-Account Fund Siphoning (IDOR) | Critical | Server-side cryptographic identity checks (`owner_id === user.id`); 403 Forbidden + Refusal Logging | `tests/ledger.test.ts` (Test 5) |
| **THR-06** | Half-Executed Transfer / Money Leak | Critical | Strict Double-Entry Bookkeeping; debit & credit executed in a single atomic SQL transaction | `tests/ledger.test.ts` (Test 1, 6) |
| **THR-07** | Deadlock on Reciprocal Transfers (A→B vs B→A) | High | Lexicographical deterministic account locking order (`[src, dst].sort()`) | `ledger.ts` transfer implementation |
| **THR-08** | Silent Ledger Modification / DBA Tampering | Critical | Cryptographic SHA-256 Hash Chain + SQLite trigger prevention on `UPDATE`/`DELETE` | `tests/ledger.test.ts` (Test 7) |
| **THR-09** | Floating-Point Financial Drift | Medium | Explicit `toFixed(2)` rounding on all balances and SQL REAL consistency checks | `tests/ledger.test.ts` (Test 1) |
| **THR-10** | Refusal Concealment / Audit Scrubbing | High | Permanent append-only `audit_refusals` table with triggers blocking updates/deletes | `tests/ledger.test.ts` (Test 6) |
| **THR-11** | Negative Overdraft Breach | High | Server-side authorized limit evaluation + DB `CHECK(balance >= -overdraft_limit)` | `tests/ledger.test.ts` (Test 8) |

---

## 2. In-Depth Threat Analysis & Mitigations

### THR-01: Concurrent Overdraft Race (Time-of-Check to Time-of-Use)
- **The Attack**: An attacker has ₹1,000 in account `ACC-A`. They broadcast 10 simultaneous withdrawal requests of ₹600 each across multiple worker threads or curl processes. In an un-isolated system, all 10 requests read balance = ₹1,000, see that 1000 >= 600, and proceed to debit ₹600 each, resulting in a ₹-5,000 balance and ₹5,000 stolen.
- **The Mitigation**:
  1. All mutations execute inside SQLite's `db.transaction()` operating with Write-Ahead Logging (WAL) and `BEGIN IMMEDIATE`.
  2. The database table includes a database-level constraint:
     ```sql
     balance REAL NOT NULL CHECK (balance >= -overdraft_limit)
     ```
  3. Inside the transaction, the latest row balance is re-fetched under exclusive lock before debiting. If insufficient, an immutable refusal row is written to `audit_refusals`, and the transaction cleanly returns HTTP 422 with the refusal logged.
- **Verification**: In automated test 2, 20 parallel requests for ₹500 against a ₹2,000 balance result in exactly 4 successes and 16 logged refusals; the balance rests at exactly ₹0.00.

### THR-02: Replay Attack & Duplicate Payment Ingestion
- **The Attack**: A network timeout occurs after the bank processed a ₹50,000 vendor payment. The client's automated retry loop fires the request again. Without idempotency, ₹100,000 leaves the account.
- **The Mitigation**:
  1. Every money-moving endpoint requires or accepts an `Idempotency-Key`.
  2. Before executing, the engine checks `idempotency_records`.
  3. If found with status `RESOLVED`, the system returns the exact cached response body and HTTP status code without touching balances or ledger rows.
  4. The response includes `X-Idempotent-Replay: true` so clients and auditors can track replays.
  5. The database increments `hit_count` to record the duplicate event.

### THR-03: Idempotency Key Semantic Tampering Attack
- **The Attack**: A malicious actor captures a previously successful idempotency key for a ₹10.00 transfer, and replays that key against a transfer of ₹50,000.00, attempting to spoof the system into believing the large payment was already settled.
- **The Mitigation**:
  1. When an idempotency key is first registered, the engine computes a canonical SHA-256 hash of all semantic parameters (`request_hash = SHA256(account_id | operation | amount | counterparty | user_id)`).
  2. On replay, the engine computes the incoming request's hash and compares it against `request_hash`.
  3. If mismatched, the server rejects the request with HTTP `422 Unprocessable Entity` (`refusalReason: 'IDEMPOTENCY_CONFLICT'`) and logs the security violation in `audit_refusals`.

### THR-04: Concurrent In-Flight Idempotency Race (Dual Microsecond Submission)
- **The Attack**: Two requests with the exact same idempotency key hit two different sockets within the exact same millisecond before either can write a `RESOLVED` DB record.
- **The Mitigation**:
  1. A thread-safe in-memory mutex set (`inFlightIdempotencyKeys`) tracks pending executions.
  2. In the DB, the record is immediately committed as `status: 'IN_FLIGHT'` upon arrival.
  3. The second request detects the key in `IN_FLIGHT` state and immediately returns `HTTP 409 Conflict` ("A transaction with this idempotency key is currently in-flight. Please wait."), preventing double processing.

### THR-05: Cross-Account Fund Siphoning (IDOR)
- **The Attack**: Alice has account `ACC-ALICE-01`. She inspects the network payload and changes `sourceAccountId` to Bob's account `ACC-BOB-01` to transfer funds to her own account.
- **The Mitigation**:
  1. The server enforces role-based entitlement checks on every request.
  2. For Account Holders, the server verifies `sourceAccount.ownerId === req.user.id`.
  3. If mismatched, the server rejects with `HTTP 403 Forbidden` (`refusalReason: 'UNAUTHORIZED_ACCOUNT_ACCESS'`).
  4. The unauthorized attempt is permanently recorded in `audit_refusals` with Alice's user ID, IP/session trace, and the timestamp.

### THR-06: Half-Executed Transfers & Money Destruction
- **The Attack**: In a transfer between Account A and Account B, the debit on Account A succeeds, but a server crash, constraint failure, or syntax error prevents the credit on Account B from completing. Money has been destroyed.
- **The Mitigation**:
  1. Every internal transfer follows strict Double-Entry bookkeeping.
  2. Leg 1 (Debit A) and Leg 2 (Credit B) are executed within the **same atomic database transaction**.
  3. If anything fails, the entire transaction rolls back automatically.
  4. System invariant: `SUM(All Customer Balances) == Total Vault Deposits - Total Vault Withdrawals`.

### THR-07: Deadlock on Concurrent Reciprocal Transfers
- **The Attack**: Thread 1 executes Transfer from Account A to Account B. Thread 2 executes Transfer from Account B to Account A at the exact same instant. Thread 1 locks row A and waits for B. Thread 2 locks row B and waits for A. Result: Database deadlock!
- **The Mitigation**:
  1. In `LedgerEngine.transfer()`, account locks are acquired in **lexicographical deterministic order**:
     ```ts
     const [firstId, secondId] = [source.id, destination.id].sort();
     db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(firstId);
     db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(secondId);
     ```
  2. Both threads attempt to acquire the lock on `min(A, B)` first, guaranteeing total lock ordering and mathematical impossibility of cyclical deadlock.

### THR-08: Silent Ledger Record Modification / Insider Threat
- **The Attack**: A rogue employee or DBA with database access alters a ledger entry row to conceal an illicit payment or balance adjustment.
- **The Mitigation**:
  1. Every ledger entry is cryptographically chained using SHA-256:
     `hash = SHA256(sequence | prev_hash | transaction_id | account_id | direction | amount | running_balance | timestamp)`
  2. SQLite triggers (`prevent_ledger_update`, `prevent_ledger_delete`) prevent standard SQL updates or deletions.
  3. The system provides an automated cryptographic verification auditor (`GET /api/audit/verify-chain`) that walks the entire chain from genesis. Any modified byte breaks the hash of that block and every subsequent block, identifying the exact corrupted sequence number.

---

## 3. Known Accepted Risks & Architectural Boundaries

1. **Single-Node SQLite Architecture**:
   - *Risk*: SQLite WAL mode provides serializable transactional integrity and high read throughput on a single server node. In a multi-region active-active cluster, SQLite cannot provide cross-region distributed consensus without Raft/LiteFS.
   - *Rationale*: For this challenge, prioritizing atomic serialized local locking guarantees 0.00 discrepancy and zero race conditions without distributed clock skew or network partition hazards.

2. **Server Hard Crash During In-Flight Window**:
   - *Risk*: If the server process crashes while a request is in `'IN_FLIGHT'` status before writing `'RESOLVED'` or `'FAILED'`, subsequent retries with that key might encounter an orphaned `'IN_FLIGHT'` record.
   - *Mitigation/Accepted Boundary*: An idempotency timeout expiry (e.g. 5 minutes) allows expired `'IN_FLIGHT'` records to be re-evaluated against the ledger transaction ID to determine whether the commit completed before the crash.

3. **Database File Replacement**:
   - *Risk*: If an attacker with root OS access deletes the entire SQLite file and replaces it with a forged database, internal cryptographic hashes will self-validate if forged from a new genesis.
   - *Mitigation/Accepted Boundary*: In production, the latest block hash is anchored to an external append-only log, KMS, or blockchain notary (witness architecture) at periodic intervals.
