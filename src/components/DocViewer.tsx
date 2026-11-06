import React, { useState } from 'react';
import { BookOpen, ShieldAlert, Terminal, FileCode, CheckSquare } from 'lucide-react';

export const DocViewer: React.FC = () => {
  const [activeDoc, setActiveDoc] = useState<'threats' | 'prompts' | 'architecture'>('threats');

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Sub-nav */}
      <div className="bg-slate-900 border border-slate-800 p-1.5 rounded-xl flex items-center gap-2">
        <button
          onClick={() => setActiveDoc('threats')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeDoc === 'threats'
              ? 'bg-rose-700 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          THREATS.md (Threat Model & Concurrency Races)
        </button>
        <button
          onClick={() => setActiveDoc('prompts')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeDoc === 'prompts'
              ? 'bg-indigo-700 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <Terminal className="w-4 h-4" />
          PROMPTS.md (5 Dated AI Flaws Caught)
        </button>
        <button
          onClick={() => setActiveDoc('architecture')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeDoc === 'architecture'
              ? 'bg-emerald-700 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Architecture & Invariant Guarantees
        </button>
      </div>

      {/* Content Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl text-slate-300 text-xs sm:text-sm leading-relaxed space-y-6">
        {activeDoc === 'threats' && (
          <div className="space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
                LedgerLine Threat Matrix & Security Posture
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Full documentation of attacks analyzed, mitigations deployed, and accepted boundaries.
              </p>
            </div>

            <div className="space-y-4 text-xs font-mono">
              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="font-bold text-rose-300 text-sm">THR-01: Concurrent Overdraft Race (TOCTOU)</span>
                <p className="text-slate-300">
                  <strong>Attack:</strong> Attacker has ₹1,000 and fires 10 simultaneous requests of ₹600.
                </p>
                <p className="text-slate-400">
                  <strong>Mitigation:</strong> Atomic <code>db.transaction()</code> with <code>BEGIN IMMEDIATE</code> in SQLite WAL mode. Row balance locked and re-checked under write lock. Table schema enforced via <code>CHECK (balance &gt;= -overdraft_limit)</code>.
                </p>
                <p className="text-emerald-400">
                  <strong>Test:</strong> <code>tests/ledger.test.ts</code> (Test 2: 20 parallel requests against ₹2,000 balance; 4 succeed, 16 refused with INSUFFICIENT_FUNDS, final balance exactly ₹0.00).
                </p>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="font-bold text-rose-300 text-sm">THR-02: Replay Attack & Duplicate Payment Ingestion</span>
                <p className="text-slate-300">
                  <strong>Attack:</strong> Network timeout causes client retry; payment executes twice.
                </p>
                <p className="text-slate-400">
                  <strong>Mitigation:</strong> Mandatory/optional <code>Idempotency-Key</code> header. Canonical SHA-256 request payload hashing. Cached response returned with <code>X-Idempotent-Replay: true</code> without moving money again.
                </p>
                <p className="text-emerald-400">
                  <strong>Test:</strong> <code>tests/ledger.test.ts</code> (Test 3: 5 identical sequential & concurrent replays execute exactly once).
                </p>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="font-bold text-rose-300 text-sm">THR-03: Idempotency Key Mutation Attack</span>
                <p className="text-slate-300">
                  <strong>Attack:</strong> Malicious client reuses an idempotency key from a ₹10 payment for a ₹50,000 transfer.
                </p>
                <p className="text-slate-400">
                  <strong>Mitigation:</strong> Compares canonical SHA-256 payload hash against stored hash. Mismatch rejected with HTTP 422 <code>IDEMPOTENCY_CONFLICT</code> and refusal logged.
                </p>
                <p className="text-emerald-400">
                  <strong>Test:</strong> <code>tests/ledger.test.ts</code> (Test 4: Same key with modified amount rejected).
                </p>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="font-bold text-rose-300 text-sm">THR-05: Cross-Account Fund Siphoning (IDOR)</span>
                <p className="text-slate-300">
                  <strong>Attack:</strong> User Alice attempts to transfer or withdraw money out of Bob's account.
                </p>
                <p className="text-slate-400">
                  <strong>Mitigation:</strong> Server verifies <code>sourceAccount.owner_id === req.user.id</code> on every money-moving request. Rejected with HTTP 403 Forbidden; refusal logged in immutable audit table.
                </p>
                <p className="text-emerald-400">
                  <strong>Test:</strong> <code>tests/ledger.test.ts</code> (Test 5: Unauthorized transfer blocked, balances untouched).
                </p>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="font-bold text-rose-300 text-sm">THR-07: Reciprocal Transfer Deadlock (A→B vs B→A)</span>
                <p className="text-slate-300">
                  <strong>Attack:</strong> A transfers to B at the exact same instant B transfers to A.
                </p>
                <p className="text-slate-400">
                  <strong>Mitigation:</strong> Lexicographical deterministic account lock sorting (<code>[src, dst].sort()</code>) guarantees both threads lock the lowest account ID first, eliminating circular waits.
                </p>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <span className="font-bold text-rose-300 text-sm">THR-08: Silent Ledger Record Modification</span>
                <p className="text-slate-300">
                  <strong>Attack:</strong> Rogue insider/DBA modifies a ledger row to conceal a payment.
                </p>
                <p className="text-slate-400">
                  <strong>Mitigation:</strong> SHA-256 cryptographic chaining (<code>Hash_n = SHA256(Seq | PrevHash | TxID | Amount | Balance)</code>) + SQL triggers blocking UPDATE/DELETE. Automated auditor detects exact modified sequence.
                </p>
                <p className="text-emerald-400">
                  <strong>Test:</strong> <code>tests/ledger.test.ts</code> (Test 7: Tampered sequence #1 detected instantly).
                </p>
              </div>
            </div>
          </div>
        )}

        {activeDoc === 'prompts' && (
          <div className="space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Terminal className="w-5 h-5 text-indigo-400" />
                PROMPTS.md - Development Log & Caught AI Flaws
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Five dated entries recording critical concurrency, isolation, and financial integrity flaws caught in AI-generated code.
              </p>
            </div>

            <div className="space-y-4 text-xs font-mono">
              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-indigo-300 font-bold">
                  <span>Entry 1: Double-Entry Atomic Transfer & Concurrency Isolation</span>
                  <span>2026-10-31</span>
                </div>
                <p className="text-slate-300">
                  <strong>AI Flaw:</strong> Model generated a standard async read-modify-write transfer with separate <code>UPDATE</code> statements outside a database transaction.
                </p>
                <p className="text-rose-400">
                  <strong>Caught Money Flaw:</strong> TOCTOU race condition (two transfers could overdraw account simultaneously) + risk of half-executed transfers destroying money if server halted between debit and credit.
                </p>
                <p className="text-emerald-400">
                  <strong>Engineered Fix:</strong> Enclosed operations inside <code>db.transaction()</code> with <code>BEGIN IMMEDIATE</code> and synchronized double-entry postings.
                </p>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-indigo-300 font-bold">
                  <span>Entry 2: Idempotency Key Handling & The "Double-Click" Window</span>
                  <span>2026-11-01</span>
                </div>
                <p className="text-slate-300">
                  <strong>AI Flaw:</strong> Model used a volatile JavaScript <code>Set&lt;string&gt;</code> in memory and returned <code>&#123; message: "Already processed" &#125;</code>.
                </p>
                <p className="text-rose-400">
                  <strong>Caught Money Flaw:</strong> In-flight requests within the same millisecond both bypassed the set; server restart erased all historical keys; returning generic messages broke client reconciliation.
                </p>
                <p className="text-emerald-400">
                  <strong>Engineered Fix:</strong> Persistent <code>idempotency_records</code> table with <code>IN_FLIGHT</code> status, payload hash comparison, and cached exact response body.
                </p>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-indigo-300 font-bold">
                  <span>Entry 3: Reciprocal Transfer Deadlock (Dining Philosophers)</span>
                  <span>2026-11-02</span>
                </div>
                <p className="text-slate-300">
                  <strong>AI Flaw:</strong> Model locked source account first, then destination account.
                </p>
                <p className="text-rose-400">
                  <strong>Caught Money Flaw:</strong> Simultaneous reciprocal transfers (A→B and B→A) deadlocked worker processes.
                </p>
                <p className="text-emerald-400">
                  <strong>Engineered Fix:</strong> Lexicographical deterministic account lock sorting: <code>const [first, second] = [source.id, destination.id].sort()</code>.
                </p>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-indigo-300 font-bold">
                  <span>Entry 4: Ledger Immutability & Silent Modification Prevention</span>
                  <span>2026-11-03</span>
                </div>
                <p className="text-slate-300">
                  <strong>AI Flaw:</strong> Model provided a <code>PUT /ledger/:id</code> endpoint allowing manual balance corrections.
                </p>
                <p className="text-rose-400">
                  <strong>Caught Money Flaw:</strong> In-place editing of historical ledger rows violates accounting law and allows silent embezzlement.
                </p>
                <p className="text-emerald-400">
                  <strong>Engineered Fix:</strong> SQLite database triggers blocking <code>UPDATE</code> and <code>DELETE</code> + recursive SHA-256 hash chaining.
                </p>
              </div>

              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-indigo-300 font-bold">
                  <span>Entry 5: AI Integration Boundary - Advisory vs Money Movement</span>
                  <span>2026-11-04</span>
                </div>
                <p className="text-slate-300">
                  <strong>AI Flaw:</strong> Model proposed allowing Gemini AI to automatically generate and execute corrective transfers when detecting discrepancies.
                </p>
                <p className="text-rose-400">
                  <strong>Caught Money Flaw:</strong> Autonomous LLM money movement creates prompt-injection and hallucination hazards where probabilistic models drain reserves.
                </p>
                <p className="text-emerald-400">
                  <strong>Engineered Fix:</strong> AI is code-sandboxed to read-only anomaly suggestions. A human auditor must inspect and authoritatively sign every verdict.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeDoc === 'architecture' && (
          <div className="space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-400" />
                LedgerLine Mathematical Architecture & Invariants
              </h2>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">1. The Conservation Invariant</h3>
              <p className="text-xs text-slate-300 font-mono bg-slate-950 p-3 rounded-lg border border-slate-800">
                &Sigma; CustomerAccountBalances = SystemVaultDeposited - SystemVaultWithdrawn
              </p>
              <p className="text-xs text-slate-400">
                Internal transfers produce balanced debit and credit entries (Delta System = 0.00). External flows are tracked in the vault account. The difference between customer balances and net external inflow must strictly equal ₹0.00.
              </p>

              <h3 className="text-sm font-semibold text-white pt-2">2. Role-Based Access Matrix</h3>
              <div className="overflow-x-auto font-mono text-xs">
                <table className="w-full text-left border border-slate-800">
                  <thead className="bg-slate-800 text-slate-300">
                    <tr>
                      <th className="p-2">Capability</th>
                      <th className="p-2">Administrator</th>
                      <th className="p-2">Account Holder</th>
                      <th className="p-2">Auditor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-400">
                    <tr>
                      <td className="p-2 text-white">Create Accounts & Overdrafts</td>
                      <td className="p-2 text-emerald-400">Allowed</td>
                      <td className="p-2 text-rose-400">Forbidden</td>
                      <td className="p-2 text-rose-400">Forbidden</td>
                    </tr>
                    <tr>
                      <td className="p-2 text-white">Move Money (Own Accounts)</td>
                      <td className="p-2 text-emerald-400">Allowed</td>
                      <td className="p-2 text-emerald-400">Allowed</td>
                      <td className="p-2 text-rose-400">Forbidden (Read-Only)</td>
                    </tr>
                    <tr>
                      <td className="p-2 text-white">Move Money (Other Accounts)</td>
                      <td className="p-2 text-emerald-400">Admin Privileges</td>
                      <td className="p-2 text-rose-400">Strictly Forbidden (403)</td>
                      <td className="p-2 text-rose-400">Forbidden</td>
                    </tr>
                    <tr>
                      <td className="p-2 text-white">Inspect Cryptographic Ledger</td>
                      <td className="p-2 text-emerald-400">Full Access</td>
                      <td className="p-2 text-slate-400">Own Statement Only</td>
                      <td className="p-2 text-emerald-400">Full Access (Read-Only)</td>
                    </tr>
                    <tr>
                      <td className="p-2 text-white">Inspect Refused Attempts Log</td>
                      <td className="p-2 text-emerald-400">Global Log</td>
                      <td className="p-2 text-slate-400">Own Statement Only</td>
                      <td className="p-2 text-emerald-400">Global Log</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
