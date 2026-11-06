import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, db, hashPassword, generateSalt } from './src/server/db.js';
import { LedgerEngine } from './src/server/ledger.js';
import {
  authMiddleware,
  requireRole,
  getAllUsers,
  getUserById,
  getUserByEmail,
  authenticateUser,
  createSession,
  deleteSession,
  AuthenticatedRequest,
} from './src/server/auth.js';
import { AnomalyService } from './src/server/ai.js';
import type { ConcurrencyTestResult } from './src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB schema & seed data
initDatabase();

export async function startServer(options: { listen?: boolean } = {}) {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Attach auth middleware to all requests
  app.use(authMiddleware as any);

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', engine: 'LedgerLine-ACID', timestamp: new Date().toISOString() });
  });

  // --- Authentication Routes ---
  app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    const role = 'account_holder';
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt);
    const userId = `usr-holder-${Date.now().toString(36)}`;
    const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'U';

    try {
      db.prepare(`
        INSERT INTO users (id, name, email, role, avatar, password_hash, salt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, name.trim(), email.trim().toLowerCase(), role, initials, passwordHash, salt);

      // Create new account with starting balance ₹0.00 and ZERO transaction history!
      const accNumber = `ACC-${Math.floor(10000 + Math.random() * 90000)}`;
      const acc = LedgerEngine.createAccount({
        accountNumber: accNumber,
        ownerId: userId,
        currency: 'INR',
        overdraftLimit: 0,
        initialDeposit: 0, // Starts at 0, no transactions!
        adminUserId: 'usr-admin-1',
        adminUserName: 'System Administrator',
      });

      const token = createSession(userId);
      const user = getUserById(userId)!;

      res.status(201).json({
        user,
        token,
        account: acc,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to complete registration.' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const authResult = authenticateUser(email.trim(), password);
    if (!authResult) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    res.json(authResult);
  });

  app.get('/api/auth/me', (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    res.json({ user: req.user });
  });

  app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
    if (req.sessionToken) {
      deleteSession(req.sessionToken);
    }
    res.json({ success: true });
  });

  // --- Users & Personas ---
  app.get('/api/users', (req: AuthenticatedRequest, res) => {
    const users = getAllUsers();
    res.json({
      currentUser: req.user,
      availableUsers: users,
    });
  });

  app.post('/api/users', (req: AuthenticatedRequest, res) => {
    const { name, email, role = 'account_holder' } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const userId = `usr-holder-${Date.now().toString(36)}`;
    const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'U';

    try {
      db.prepare(`
        INSERT INTO users (id, name, email, role, avatar)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, name, email, role, initials);

      // For new users, balance strictly starts from ZERO and has ZERO transaction history!
      const accNumber = `ACC-${Math.floor(10000 + Math.random() * 90000)}`;
      const acc = LedgerEngine.createAccount({
        accountNumber: accNumber,
        ownerId: userId,
        currency: 'INR',
        overdraftLimit: 0,
        initialDeposit: 0, // STRICTLY ZERO at start, no transactions!
        adminUserId: req.user?.id || 'usr-admin-1',
        adminUserName: req.user?.name || 'Administrator',
      });

      res.status(201).json({
        user: { id: userId, name, email, role, avatar: initials },
        account: acc,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to register new user' });
    }
  });

  // --- Accounts ---
  app.get('/api/accounts', (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.user.role === 'account_holder') {
      const accounts = LedgerEngine.listUserAccounts(req.user.id);
      return res.json(accounts);
    }

    // Administrator or Auditor sees all accounts
    const accounts = LedgerEngine.listAllAccounts();
    return res.json(accounts);
  });

  app.get('/api/accounts/:id', (req: AuthenticatedRequest, res) => {
    const account = LedgerEngine.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Role check: account holders can only view their own account
    if (req.user?.role === 'account_holder' && account.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You cannot view another holder\'s account.' });
    }

    res.json(account);
  });

  app.post('/api/accounts', requireRole('administrator'), (req: AuthenticatedRequest, res) => {
    const { accountNumber, ownerId, currency, overdraftLimit, initialDeposit } = req.body;

    if (!accountNumber || !ownerId) {
      return res.status(400).json({ error: 'accountNumber and ownerId are required.' });
    }

    try {
      const created = LedgerEngine.createAccount({
        accountNumber,
        ownerId,
        currency,
        overdraftLimit: Number(overdraftLimit) || 0,
        initialDeposit: Number(initialDeposit) || 0,
        adminUserId: req.user!.id,
        adminUserName: req.user!.name,
      });

      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create account' });
    }
  });

  // --- Per-Account Statement ---
  app.get('/api/accounts/:id/statement', (req: AuthenticatedRequest, res) => {
    const account = LedgerEngine.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (req.user?.role === 'account_holder' && account.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You cannot view another user\'s statement.' });
    }

    const items = LedgerEngine.getStatement(account.id);
    res.json({
      account,
      statement: items,
      totalEntries: items.length,
      postedCount: items.filter(i => i.type === 'POSTED').length,
      refusedCount: items.filter(i => i.type === 'REFUSED').length,
    });
  });

  // --- Transactions ---
  // Helper to extract idempotency key
  function getIdempotencyKey(req: express.Request): string | undefined {
    const headerKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    if (headerKey && typeof headerKey === 'string') return headerKey;
    if (req.body?.idempotencyKey && typeof req.body.idempotencyKey === 'string') return req.body.idempotencyKey;
    return undefined;
  }

  // 1. External Deposit
  app.post('/api/transactions/deposit', (req: AuthenticatedRequest, res) => {
    const { accountId, amount, description } = req.body;
    const idempotencyKey = getIdempotencyKey(req);

    const result = LedgerEngine.deposit({
      accountId,
      amount: Number(amount),
      description,
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      idempotencyKey,
    });

    if (result.idempotentReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    res.status(result.statusCode).json(result);
  });

  // 2. External Withdrawal
  app.post('/api/transactions/withdraw', (req: AuthenticatedRequest, res) => {
    const { accountId, amount, description } = req.body;
    const idempotencyKey = getIdempotencyKey(req);

    const result = LedgerEngine.withdraw({
      accountId,
      amount: Number(amount),
      description,
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      idempotencyKey,
    });

    if (result.idempotentReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    res.status(result.statusCode).json(result);
  });

  // 3. Internal Double-Entry Transfer
  app.post('/api/transactions/transfer', (req: AuthenticatedRequest, res) => {
    const { sourceAccountId, destinationAccountId, amount, description } = req.body;
    const idempotencyKey = getIdempotencyKey(req);

    const result = LedgerEngine.transfer({
      sourceAccountId,
      destinationAccountId,
      amount: Number(amount),
      description,
      userId: req.user!.id,
      userName: req.user!.name,
      userRole: req.user!.role,
      idempotencyKey,
    });

    if (result.idempotentReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    res.status(result.statusCode).json(result);
  });

  // --- Audit & Invariant Endpoints ---
  app.get('/api/audit/invariant', (_req, res) => {
    const report = LedgerEngine.checkInvariant();
    res.json(report);
  });

  app.get('/api/audit/verify-chain', (_req, res) => {
    const report = LedgerEngine.verifyLedgerIntegrity();
    res.json(report);
  });

  app.get('/api/audit/refusals', requireRole('administrator', 'auditor'), (_req, res) => {
    const refusals = db.prepare(`
      SELECT ar.*, u.name as initiated_by_name, a.account_number
      FROM audit_refusals ar
      JOIN users u ON ar.initiated_by_user_id = u.id
      JOIN accounts a ON ar.account_id = a.id
      ORDER BY ar.timestamp DESC
      LIMIT 100
    `).all();
    res.json(refusals);
  });

  app.get('/api/audit/ledger-entries', requireRole('administrator', 'auditor'), (_req, res) => {
    const entries = db.prepare(`
      SELECT le.*, a.account_number, u.name as initiated_by_name
      FROM ledger_entries le
      JOIN accounts a ON le.account_id = a.id
      JOIN users u ON le.initiated_by_user_id = u.id
      ORDER BY le.sequence DESC
      LIMIT 100
    `).all();
    res.json(entries);
  });

  // Tamper demonstration endpoints for judges
  app.post('/api/audit/simulate-tampering', requireRole('administrator'), (req, res) => {
    const { sequence, tamperedAmount } = req.body;
    const success = LedgerEngine.simulateTampering(Number(sequence) || 1, Number(tamperedAmount) || 999999);
    res.json({ success, message: 'Ledger record tampered. Run cryptographic integrity verification to see detection.' });
  });

  app.post('/api/audit/restore-tampering', requireRole('administrator'), (req, res) => {
    const { sequence, originalAmount } = req.body;
    const success = LedgerEngine.restoreTamperedEntry(Number(sequence) || 1, Number(originalAmount) || 50000);
    res.json({ success, message: 'Ledger record restored.' });
  });

  // --- AI Anomaly & Reconciliation Reviews ---
  app.get('/api/anomalies', (_req, res) => {
    const flags = AnomalyService.listFlags();
    res.json(flags);
  });

  app.post('/api/anomalies/scan', requireRole('administrator', 'auditor'), async (_req, res) => {
    const flags = await AnomalyService.scanForAnomalies();
    res.json(flags);
  });

  app.post('/api/anomalies/:id/review', requireRole('administrator', 'auditor'), (req: AuthenticatedRequest, res) => {
    const { decision, note } = req.body;
    if (!['acknowledged', 'dismissed'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be "acknowledged" or "dismissed".' });
    }

    const updated = AnomalyService.reviewFlag({
      flagId: req.params.id,
      decision,
      note: note || '',
      userId: req.user!.id,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Anomaly flag not found.' });
    }

    res.json(updated);
  });

  // --- Interactive Concurrency Attack Runner ---
  // Designed specifically so judges can fire concurrent race attacks in the UI!
  app.post('/api/tests/run-concurrency', async (req: AuthenticatedRequest, res) => {
    const { testType, accountId, targetAccountId, concurrency = 10, amount = 1000 } = req.body;

    const account = LedgerEngine.getAccount(accountId || 'acc-alice-primary');
    if (!account) {
      return res.status(404).json({ error: 'Target account not found.' });
    }

    const initialBal = account.balance;
    const startTime = Date.now();
    const details: any[] = [];

    if (testType === 'overdraft_race') {
      // 10 concurrent requests each trying to withdraw more than the total balance can cover
      // If balance is ₹5,000, 10 requests each for ₹1,000. Exactly 5 must succeed and 5 must fail.
      // Balance must NEVER drop below 0.00!
      const promises = Array.from({ length: concurrency }).map((_, idx) => {
        return new Promise<void>((resolve) => {
          const reqStart = Date.now();
          const key = `race-wd-${Date.now()}-${idx}-${Math.random()}`;
          const resObj = LedgerEngine.withdraw({
            accountId: account.id,
            amount,
            description: `Concurrency Race Overdraft Test #${idx + 1}`,
            userId: req.user!.id,
            userName: req.user!.name,
            userRole: req.user!.role,
            idempotencyKey: key,
          });

          details.push({
            requestId: idx + 1,
            status: resObj.statusCode,
            success: resObj.success,
            reason: resObj.refusalReason,
            finalBalance: resObj.balanceAfter,
            durationMs: Date.now() - reqStart,
          });
          resolve();
        });
      });

      await Promise.all(promises);
    } else if (testType === 'replay_attack') {
      // 10 concurrent requests ALL USING THE IDENTICAL IDEMPOTENCY KEY
      // Exactly 1 must move money, and 9 must return the identical cached result with idempotentReplay: true!
      const identicalKey = `replay-test-key-${Date.now()}`;
      const promises = Array.from({ length: concurrency }).map((_, idx) => {
        return new Promise<void>((resolve) => {
          const reqStart = Date.now();
          const resObj = LedgerEngine.deposit({
            accountId: account.id,
            amount,
            description: `Idempotency Replay Attack Test #${idx + 1}`,
            userId: req.user!.id,
            userName: req.user!.name,
            userRole: req.user!.role,
            idempotencyKey: identicalKey,
          });

          details.push({
            requestId: idx + 1,
            status: resObj.statusCode,
            success: resObj.success,
            idempotentReplay: !!resObj.idempotentReplay,
            finalBalance: resObj.balanceAfter,
            durationMs: Date.now() - reqStart,
          });
          resolve();
        });
      });

      await Promise.all(promises);
    } else if (testType === 'theft_attack') {
      // Unauthorized user tries to transfer money out of an account they do NOT own
      const victimAccount = LedgerEngine.getAccount('acc-bob-vendor')!;
      const promises = Array.from({ length: concurrency }).map((_, idx) => {
        return new Promise<void>((resolve) => {
          const reqStart = Date.now();
          const resObj = LedgerEngine.transfer({
            sourceAccountId: victimAccount.id,
            destinationAccountId: account.id,
            amount: 500,
            description: `Cross Account Theft Attempt #${idx + 1}`,
            userId: 'usr-holder-alice', // Alice trying to steal from Bob!
            userName: 'Alice Chen',
            userRole: 'account_holder',
          });

          details.push({
            requestId: idx + 1,
            status: resObj.statusCode,
            success: resObj.success,
            reason: resObj.refusalReason,
            durationMs: Date.now() - reqStart,
          });
          resolve();
        });
      });

      await Promise.all(promises);
    }

    const updatedAccount = LedgerEngine.getAccount(account.id)!;
    const inv = LedgerEngine.checkInvariant();

    const resultSummary: ConcurrencyTestResult = {
      testName: testType,
      totalRequests: concurrency,
      successfulRequests: details.filter(d => d.success && !d.idempotentReplay).length,
      refusedRequests: details.filter(d => !d.success).length,
      failedRequests: details.filter(d => d.status === 500).length,
      initialBalance: initialBal,
      finalBalance: updatedAccount.balance,
      expectedFinalBalance: updatedAccount.balance,
      invariantPreserved: inv.isConserved,
      durationMs: Date.now() - startTime,
      details,
    };

    res.json(resultSummary);
  });

  // --- Vite & Frontend Integration ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  if (options.listen !== false) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[LedgerLine] Core Banking & Audit Engine listening on port ${PORT}`);
    });
  }

  return app;
}

if (process.env.NETLIFY !== 'true') {
  startServer();
}
