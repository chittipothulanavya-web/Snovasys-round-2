# PROMPTS.md - Development Log & AI Direction Audit

This file records the interactions with AI tools during the architectural design, implementation, and hardening of **LedgerLine**. In compliance with evaluation requirements, this log contains 5 dated entries detailing what was requested, what the model initially produced, the critical concurrency, integrity, or idempotency flaws caught, and the engineered solutions implemented instead.

---

### Entry 1: Double-Entry Atomic Transfer & Concurrency Isolation
- **Date**: 2026-10-31 09:30 UTC
- **Task / Prompt**:  
  "Implement a funds transfer function in TypeScript between two bank accounts using an SQLite database, deducting the amount from Account A and crediting Account B."
- **What the AI Produced**:  
  The AI provided an `async function transfer(sourceId, destId, amount)` that performed:
  1. `const source = await db.get("SELECT balance FROM accounts WHERE id = ?", sourceId);`
  2. `if (source.balance < amount) throw new Error("Insufficient funds");`
  3. `await db.run("UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, sourceId);`
  4. `await db.run("UPDATE accounts SET balance = balance + ? WHERE id = ?", amount, destId);`
- **What Was Specifically Wrong With It (Money Flaw)**:  
  1. **Time-of-Check to Time-of-Use (TOCTOU) Race Condition**: Step 1 checks the balance outside of an atomic lock or transaction. If two simultaneous transfer requests for ₹600 arrive on an account with ₹1,000, both pass the `source.balance < amount` check and both deduct ₹600, driving the account balance to ₹-200.
  2. **Non-Atomic Partial Execution**: If the server crashes or throws an error between Step 3 and Step 4, money is deducted from Account A but never credited to Account B. Real money is destroyed.
  3. **No Double-Entry Ledger**: The AI only updated cached mutable balances. It wrote no immutable journal entries, no running balances, and no audit trail.
- **What Was Done Instead**:  
  - Enclosed the entire operation inside `db.transaction(() => { ... })()` with `BEGIN IMMEDIATE` under SQLite WAL mode.
  - Added a database-level `CHECK (balance >= -overdraft_limit)` constraint.
  - Implemented strict double-entry accounting where both legs (Debit Account A, Credit Account B) are committed simultaneously in `ledger_entries` with cryptographic chaining.
- **Reference**: `src/server/ledger.ts:transfer()`, Commit `f1a8c02` ("fix(core): enforce atomic double-entry transaction and serialized row lock").

---

### Entry 2: Idempotency Key Handling & The "Double-Click" Window
- **Date**: 2026-11-01 14:15 UTC
- **Task / Prompt**:  
  "Add an idempotency check to the payment processing endpoint using an `Idempotency-Key` header so repeated client requests don't double charge."
- **What the AI Produced**:  
  The AI wrote an Express middleware that checked:
  ```ts
  const seenKeys = new Set<string>();
  app.post("/transfer", (req, res) => {
    const key = req.headers["idempotency-key"];
    if (seenKeys.has(key)) {
      return res.status(200).json({ message: "Already processed" });
    }
    seenKeys.add(key);
    // Process transfer...
  });
  ```
- **What Was Specifically Wrong With It (Money Flaw)**:  
  1. **Volatile In-Memory Set**: If the server restarts or scales, all keys are lost, allowing historical requests to be replayed and money moved twice.
  2. **Zero Response Caching**: Returning a generic `{ message: "Already processed" }` breaks client contracts. The specification strictly requires returning the *first result* (original transaction ID, balance after, timestamp) so the client can reconcile payments seamlessly.
  3. **In-Flight Race Condition**: If two identical requests hit the server within the same millisecond, both pass `seenKeys.has(key)` before either finishes, leading to duplicate processing.
  4. **Key Mutation Vulnerability**: The AI did not hash the request payload. An attacker could take a key used for a ₹10 transfer and submit it with a ₹10,000 payload.
- **What Was Done Instead**:  
  - Built an `idempotency_records` database table with statuses (`IN_FLIGHT`, `RESOLVED`, `FAILED`), `request_hash`, `response_status`, and `response_body`.
  - Added an in-memory mutex to immediately return `HTTP 409 Conflict` if a duplicate key arrives while the original transaction is still executing.
  - Computed a canonical SHA-256 hash of all semantic payload arguments; if a key is reused with altered parameters, the server refuses it with `422 IDEMPOTENCY_CONFLICT`.
- **Reference**: `src/server/ledger.ts:checkIdempotency()`, Commit `b74d9e1` ("fix(idempotency): implement stateful payload-hashed idempotency engine with in-flight lock").

---

### Entry 3: Reciprocal Transfer Deadlock Vulnerability
- **Date**: 2026-11-02 11:20 UTC
- **Task / Prompt**:  
  "Optimize row locking for transfers between two accounts to guarantee high concurrency safety."
- **What the AI Produced**:  
  The AI suggested locking the source account first, then locking the destination account:
  ```ts
  db.prepare("SELECT * FROM accounts WHERE id = ?").get(sourceAccountId);
  db.prepare("SELECT * FROM accounts WHERE id = ?").get(destinationAccountId);
  ```
- **What Was Specifically Wrong With It (Money Flaw)**:  
  - **Deadlock Vulnerability (Dining Philosophers)**: If User 1 initiates a transfer from Account A to Account B, and User 2 initiates a transfer from Account B to Account A at the exact same instant, Thread 1 locks row A and waits for row B, while Thread 2 locks row B and waits for row A. Both threads deadlock, throwing `SQLITE_BUSY: database is locked` or halting worker threads.
- **What Was Done Instead**:  
  - Implemented **lexicographical deterministic lock ordering**:
    ```ts
    const [firstId, secondId] = [source.id, destination.id].sort();
    db.prepare("SELECT balance FROM accounts WHERE id = ?").get(firstId);
    db.prepare("SELECT balance FROM accounts WHERE id = ?").get(secondId);
    ```
  - Both threads lock the account with the smaller ID first, guaranteeing that a circular wait condition is mathematically impossible.
- **Reference**: `src/server/ledger.ts:transfer()`, Commit `d392a40` ("fix(concurrency): sort account IDs to eliminate reciprocal transfer deadlock").

---

### Entry 4: Ledger Immutability & Silent Modification Prevention
- **Date**: 2026-11-03 16:45 UTC
- **Task / Prompt**:  
  "Create an audit statement generator that displays all transactions and refused attempts for an account."
- **What the AI Produced**:  
  The AI suggested creating a table `audit_logs` and wrote helper methods to query and update transactions:
  ```ts
  app.put("/ledger/:id", (req, res) => {
    // AI provided an update endpoint for 'correction adjustments'
    db.prepare("UPDATE ledger_entries SET amount = ? WHERE id = ?").run(req.body.amount, req.params.id);
  });
  ```
- **What Was Specifically Wrong With It (Money Flaw)**:  
  - **Violates Immutable Ledger Mandate**: A financial ledger must NEVER permit `UPDATE` or `DELETE` operations. Allowing a direct row edit enables silent concealment of illicit transfers. Correcting an error in accounting requires an explicit compensating reversal entry, not in-place editing!
  - **Silent Tampering Possibility**: The AI included no cryptographic verification or hash chain linking entries.
- **What Was Done Instead**:  
  - Created SQLite database triggers (`prevent_ledger_update`, `prevent_ledger_delete`, `prevent_refusal_update`, `prevent_refusal_delete`) that invoke `RAISE(ABORT)` on any `UPDATE` or `DELETE` command.
  - Added a SHA-256 cryptographic chain: each entry contains `prev_hash` and `hash = SHA256(sequence | prevHash | txId | accountId | direction | amount | runningBalance | timestamp)`.
  - Built an automated cryptographic verification auditor (`verifyLedgerIntegrity`) that instantly detects any byte altered in the database.
- **Reference**: `src/server/db.ts:initDatabase()`, Commit `e58b19f` ("feat(audit): install SQL immutability triggers and SHA-256 hash chaining").

---

### Entry 5: AI Integration Boundary - AI Anomaly Suggestions vs Money Movement
- **Date**: 2026-11-04 18:00 UTC
- **Task / Prompt**:  
  "Add Gemini AI to automatically reconcile discrepancies and correct suspicious account transfers."
- **What the AI Produced**:  
  The AI proposed a system where Gemini analyzed account balances, and if it detected an unusual balance, the model automatically generated and executed a corrective transfer API call:
  ```ts
  if (aiAnalysis.confidence > 0.85) {
    await LedgerEngine.transfer({ ...aiAnalysis.correctiveTransfer });
  }
  ```
- **What Was Specifically Wrong With It (Money Flaw)**:  
  - **Critical Autonomous Money Hazard**: Allowing a probabilistic Large Language Model to authorize, create, or move money violates institutional financial safety. A model hallucination, prompt injection, or parsing bug could drain customer reserves or forge balances.
- **What Was Done Instead**:  
  - Redesigned the AI module to be strictly **advisory and review-only**:
    - The AI scans transaction velocity, high refusal rates, and potential structuring, producing structured anomaly flags in `anomaly_flags`.
    - The AI is code-sandboxed: it has **zero write access** to the ledger or money-moving functions.
    - An authorized Human Auditor or Administrator must review each flag, choose whether to acknowledge or dismiss it, and write an audit note.
    - Both the AI observation and the human officer's signed decision are logged in the audit trail.
- **Reference**: `src/server/ai.ts:AnomalyService`, Commit `a430c71` ("arch(ai): enforce human-in-the-loop review boundary; strictly forbid autonomous AI money movement").
