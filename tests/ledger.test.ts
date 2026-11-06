import { initDatabase, db } from '../src/server/db.js';
import { LedgerEngine } from '../src/server/ledger.js';
import assert from 'assert';

console.log('====================================================');
console.log('   LEDGERLINE CONCURRENCY & INTEGRITY TEST SUITE   ');
console.log('====================================================\n');

initDatabase();

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         Error: ${err.message}`);
      if (err.stack) {
        console.error(`         Stack: ${err.stack.split('\n')[1]}`);
      }
      failed++;
    }
  }

  // ----------------------------------------------------------------------
  // TEST 1: Conservation of Money Invariant
  // ----------------------------------------------------------------------
  await test('1. Money Conservation: Total balances equal net external flow through mixed operations', () => {
    const invInitial = LedgerEngine.checkInvariant();
    assert.strictEqual(invInitial.isConserved, true, 'Initial state must be conserved');
    assert.strictEqual(invInitial.discrepancy, 0.0, 'Discrepancy must be 0.00');

    // Perform external deposits
    LedgerEngine.deposit({
      accountId: 'acc-alice-primary',
      amount: 10000,
      description: 'Test Deposit 1',
      userId: 'usr-holder-alice',
      userName: 'Alice Chen',
      userRole: 'account_holder',
      idempotencyKey: 'test-dep-inv-1',
    });

    // Perform external withdrawals
    LedgerEngine.withdraw({
      accountId: 'acc-bob-vendor',
      amount: 2000,
      description: 'Test Withdrawal 1',
      userId: 'usr-holder-bob',
      userName: 'Bob Patel',
      userRole: 'account_holder',
      idempotencyKey: 'test-wth-inv-1',
    });

    // Perform multiple internal transfers
    for (let i = 0; i < 5; i++) {
      LedgerEngine.transfer({
        sourceAccountId: 'acc-alice-primary',
        destinationAccountId: 'acc-bob-vendor',
        amount: 500,
        description: `Test Internal Transfer ${i + 1}`,
        userId: 'usr-holder-alice',
        userName: 'Alice Chen',
        userRole: 'account_holder',
        idempotencyKey: `test-xfer-inv-${i}`,
      });
    }

    const invAfter = LedgerEngine.checkInvariant();
    assert.strictEqual(invAfter.isConserved, true, 'Money must be 100% conserved after mixed transactions');
    assert.strictEqual(invAfter.discrepancy, 0.0, 'Discrepancy must strictly equal 0.00');
  });

  // ----------------------------------------------------------------------
  // TEST 2: Concurrent Overdraft Race Attack
  // ----------------------------------------------------------------------
  await test('2. Concurrency Safety: 20 simultaneous withdrawals racing on ₹2,000 balance cannot overdraw', async () => {
    // Create dedicated fresh test account with ₹2,000 balance
    const testAcc = LedgerEngine.createAccount({
      accountNumber: `ACC-RACE-${Date.now()}`,
      ownerId: 'usr-holder-alice',
      initialDeposit: 2000,
      adminUserId: 'usr-admin-1',
      adminUserName: 'Clara Oswald',
    });

    assert.strictEqual(testAcc.balance, 2000, 'Initial balance must be 2000');

    // Fire 20 parallel withdrawal attempts of ₹500 simultaneously.
    // Total attempted = 20 * 500 = ₹10,000.
    // Available funds = ₹2,000.
    // Exactly 4 must succeed (4 * 500 = 2000), exactly 16 must fail with INSUFFICIENT_FUNDS.
    const concurrentCount = 20;
    const withdrawAmount = 500;
    const results: any[] = [];

    const tasks = Array.from({ length: concurrentCount }).map((_, idx) => {
      return new Promise<void>((resolve) => {
        setImmediate(() => {
          const res = LedgerEngine.withdraw({
            accountId: testAcc.id,
            amount: withdrawAmount,
            description: `Concurrent Race Attempt #${idx + 1}`,
            userId: 'usr-holder-alice',
            userName: 'Alice Chen',
            userRole: 'account_holder',
            idempotencyKey: `race-wd-${Date.now()}-${idx}-${Math.random()}`,
          });
          results.push(res);
          resolve();
        });
      });
    });

    await Promise.all(tasks);

    const successful = results.filter(r => r.success);
    const refused = results.filter(r => !r.success && r.refusalReason === 'INSUFFICIENT_FUNDS');

    assert.strictEqual(successful.length, 4, `Exactly 4 requests should succeed (got ${successful.length})`);
    assert.strictEqual(refused.length, 16, `Exactly 16 requests should be refused (got ${refused.length})`);

    const freshAcc = LedgerEngine.getAccount(testAcc.id)!;
    assert.strictEqual(freshAcc.balance, 0, `Final balance must be exactly 0 (got ${freshAcc.balance})`);
    assert.ok(freshAcc.balance >= 0, 'Account must NEVER go negative');

    // Invariant check
    const inv = LedgerEngine.checkInvariant();
    assert.strictEqual(inv.isConserved, true, 'Invariant must hold after concurrency attack');
  });

  // ----------------------------------------------------------------------
  // TEST 3: Idempotency & Exact-Once Guarantee
  // ----------------------------------------------------------------------
  await test('3. Idempotency: Replaying identical key 5 times executes exactly once and returns cached result', () => {
    const acc = LedgerEngine.getAccount('acc-bob-vendor')!;
    const initialBal = acc.balance;
    const idempotencyKey = `idemp-test-once-${Date.now()}`;

    // First call
    const firstRes = LedgerEngine.deposit({
      accountId: acc.id,
      amount: 1500,
      description: 'Original Idempotent Deposit',
      userId: 'usr-holder-bob',
      userName: 'Bob Patel',
      userRole: 'account_holder',
      idempotencyKey,
    });

    assert.strictEqual(firstRes.success, true);
    assert.strictEqual(firstRes.statusCode, 200);
    assert.strictEqual(firstRes.idempotentReplay, undefined);

    // 4 Subsequent identical replays
    for (let i = 0; i < 4; i++) {
      const replayRes = LedgerEngine.deposit({
        accountId: acc.id,
        amount: 1500,
        description: 'Original Idempotent Deposit',
        userId: 'usr-holder-bob',
        userName: 'Bob Patel',
        userRole: 'account_holder',
        idempotencyKey,
      });

      assert.strictEqual(replayRes.success, true, 'Replay call must succeed with cached result');
      assert.strictEqual(replayRes.idempotentReplay, true, 'Must be marked as idempotentReplay');
      assert.strictEqual(replayRes.transactionId, firstRes.transactionId, 'Must return identical transaction ID');
      assert.strictEqual(replayRes.balanceAfter, firstRes.balanceAfter, 'Must return identical balanceAfter');
    }

    const finalAcc = LedgerEngine.getAccount(acc.id)!;
    assert.strictEqual(
      finalAcc.balance,
      Number((initialBal + 1500).toFixed(2)),
      'Account balance must only increase by 1500 ONCE, not 5 times'
    );
  });

  // ----------------------------------------------------------------------
  // TEST 4: Idempotency Payload Tampering Detection
  // ----------------------------------------------------------------------
  await test('4. Idempotency Key Tampering: Same key with different payload is rejected', () => {
    const key = `idemp-tamper-${Date.now()}`;

    // 1st request with amount 250
    const res1 = LedgerEngine.deposit({
      accountId: 'acc-bob-vendor',
      amount: 250,
      description: 'First payload',
      userId: 'usr-holder-bob',
      userName: 'Bob Patel',
      userRole: 'account_holder',
      idempotencyKey: key,
    });
    assert.strictEqual(res1.success, true);

    // 2nd request with SAME key but modified amount 500
    const res2 = LedgerEngine.deposit({
      accountId: 'acc-bob-vendor',
      amount: 500,
      description: 'Modified amount',
      userId: 'usr-holder-bob',
      userName: 'Bob Patel',
      userRole: 'account_holder',
      idempotencyKey: key,
    });

    assert.strictEqual(res2.success, false, 'Tampered payload must be rejected');
    assert.strictEqual(res2.statusCode, 422, 'Must return 422 Unprocessable Entity');
    assert.strictEqual(res2.refusalReason, 'IDEMPOTENCY_CONFLICT');
  });

  // ----------------------------------------------------------------------
  // TEST 5: Cross-Account Theft Protection (Authorization)
  // ----------------------------------------------------------------------
  await test('5. Authorization: User Alice cannot move money out of Bob\'s account', () => {
    const bobAcc = LedgerEngine.getAccount('acc-bob-vendor')!;
    const aliceAcc = LedgerEngine.getAccount('acc-alice-primary')!;
    const initialBobBalance = bobAcc.balance;
    const initialAliceBalance = aliceAcc.balance;

    // Alice attempts to transfer ₹1,000 from Bob to Alice
    const attackResult = LedgerEngine.transfer({
      sourceAccountId: bobAcc.id,
      destinationAccountId: aliceAcc.id,
      amount: 1000,
      description: 'Unauthorized Theft Attempt',
      userId: 'usr-holder-alice',
      userName: 'Alice Chen',
      userRole: 'account_holder',
      idempotencyKey: `attack-theft-${Date.now()}`,
    });

    assert.strictEqual(attackResult.success, false, 'Theft attempt must fail');
    assert.strictEqual(attackResult.statusCode, 403, 'Must return 403 Forbidden');
    assert.strictEqual(attackResult.refusalReason, 'UNAUTHORIZED_ACCOUNT_ACCESS');

    // Verify Bob's balance is untouched
    const freshBob = LedgerEngine.getAccount(bobAcc.id)!;
    const freshAlice = LedgerEngine.getAccount(aliceAcc.id)!;
    assert.strictEqual(freshBob.balance, initialBobBalance, 'Bob balance must be unchanged');
    assert.strictEqual(freshAlice.balance, initialAliceBalance, 'Alice balance must be unchanged');

    // Verify refusal is logged in audit statement
    const statement = LedgerEngine.getStatement(bobAcc.id);
    const theftRefusal = statement.find(s => s.type === 'REFUSED' && s.refusalReason === 'UNAUTHORIZED_ACCOUNT_ACCESS');
    assert.ok(theftRefusal, 'Refusal must be recorded in the audit log');
  });

  // ----------------------------------------------------------------------
  // TEST 6: Double-Entry Balancing & Statement Completeness
  // ----------------------------------------------------------------------
  await test('6. Double-Entry & Audit: Every transfer writes balanced legs and statement records refusals', () => {
    const src = LedgerEngine.getAccount('acc-alice-primary')!;
    const dst = LedgerEngine.getAccount('acc-bob-vendor')!;

    const tx = LedgerEngine.transfer({
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 750,
      description: 'Audit Statement Validation Transfer',
      userId: 'usr-holder-alice',
      userName: 'Alice Chen',
      userRole: 'account_holder',
      idempotencyKey: `stmt-xfer-${Date.now()}`,
    });

    assert.strictEqual(tx.success, true);

    // Verify double-entry in database
    const entries = db.prepare(`SELECT * FROM ledger_entries WHERE transaction_id = ?`).all(tx.transactionId) as any[];
    assert.strictEqual(entries.length, 2, 'Every transfer must have exactly 2 ledger entries');

    const debitLeg = entries.find(e => e.direction === 'debit');
    const creditLeg = entries.find(e => e.direction === 'credit');

    assert.ok(debitLeg, 'Must have debit leg');
    assert.ok(creditLeg, 'Must have credit leg');
    assert.strictEqual(debitLeg.amount, 750);
    assert.strictEqual(creditLeg.amount, 750);
    assert.strictEqual(debitLeg.account_id, src.id);
    assert.strictEqual(creditLeg.account_id, dst.id);

    // Trigger a refused attempt on src account to ensure refused items are recorded
    LedgerEngine.transfer({
      sourceAccountId: src.id,
      destinationAccountId: dst.id,
      amount: 99999999, // Exceeds available funds
      description: 'Excessive Transfer for Audit Refusal Test',
      userId: 'usr-holder-alice',
      userName: 'Alice Chen',
      userRole: 'account_holder',
      idempotencyKey: `refusal-test-${Date.now()}`,
    });

    // Verify statement has both posted entry and refused attempts
    const stmt = LedgerEngine.getStatement(src.id);
    assert.ok(stmt.some(s => s.type === 'POSTED'), 'Statement must have posted items');
    assert.ok(stmt.some(s => s.type === 'REFUSED'), 'Statement must have refused items');
  });

  // ----------------------------------------------------------------------
  // TEST 7: Cryptographic Hash Chaining & Tamper Detection
  // ----------------------------------------------------------------------
  await test('7. Cryptographic Proof: Unbroken SHA-256 chain; catches tampered rows immediately', () => {
    // 1. Initial verification must pass
    const report1 = LedgerEngine.verifyLedgerIntegrity();
    assert.strictEqual(report1.isValid, true, 'Cryptographic chain must be valid');
    assert.ok(report1.totalEntriesChecked > 0, 'Entries must be verified');

    // 2. Simulate rogue DBA tampering with sequence #1 amount
    LedgerEngine.simulateTampering(1, 999999);

    const reportTampered = LedgerEngine.verifyLedgerIntegrity();
    assert.strictEqual(reportTampered.isValid, false, 'Tampered ledger must fail cryptographic verification');
    assert.strictEqual(reportTampered.brokenSequence, 1, 'Must flag broken sequence #1');

    // 3. Restore original entry
    LedgerEngine.restoreTamperedEntry(1, 50000);
    const reportRestored = LedgerEngine.verifyLedgerIntegrity();
    assert.strictEqual(reportRestored.isValid, true, 'Restored ledger must pass verification again');
  });

  // ----------------------------------------------------------------------
  // TEST 8: Authorized Overdraft Limit Server Enforcement
  // ----------------------------------------------------------------------
  await test('8. Overdraft Control: Account with ₹5,000 overdraft limit permits negative up to boundary, rejects beyond', () => {
    // Dedicated account with initial deposit 12500 and overdraft limit 5000.00
    const opsAcc = LedgerEngine.createAccount({
      accountNumber: `ACC-OD-${Date.now()}`,
      ownerId: 'usr-holder-alice',
      overdraftLimit: 5000,
      initialDeposit: 12500,
      adminUserId: 'usr-admin-1',
      adminUserName: 'Clara Oswald',
    });

    const bal = opsAcc.balance;
    const limit = opsAcc.overdraftLimit;
    assert.strictEqual(limit, 5000, 'Overdraft limit must be 5000');

    // Withdraw full balance + 3000 (driving balance to -3000, which is allowed because |-3000| <= 5000)
    const allowedDebit = bal + 3000;
    const resAllowed = LedgerEngine.withdraw({
      accountId: opsAcc.id,
      amount: allowedDebit,
      description: 'Authorized Overdraft Utilization',
      userId: 'usr-holder-alice',
      userName: 'Alice Chen',
      userRole: 'account_holder',
      idempotencyKey: `od-allow-${Date.now()}`,
    });

    assert.strictEqual(resAllowed.success, true);
    assert.strictEqual(resAllowed.balanceAfter, -3000);

    // Now try to withdraw 2001 (would reach -5001, exceeding 5000 limit)
    const resDisallowed = LedgerEngine.withdraw({
      accountId: opsAcc.id,
      amount: 2001,
      description: 'Exceeding Overdraft Limit Attempt',
      userId: 'usr-holder-alice',
      userName: 'Alice Chen',
      userRole: 'account_holder',
      idempotencyKey: `od-deny-${Date.now()}`,
    });

    assert.strictEqual(resDisallowed.success, false);
    assert.strictEqual(resDisallowed.refusalReason, 'OVERDRAFT_LIMIT_EXCEEDED');
    assert.strictEqual(resDisallowed.statusCode, 422);

    // Final balance is still -3000, not -5001
    const freshOps = LedgerEngine.getAccount(opsAcc.id)!;
    assert.strictEqual(freshOps.balance, -3000);
  });

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed.`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
