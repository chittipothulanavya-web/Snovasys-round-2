import { db, computeLedgerHash, computeRequestHash } from './db.js';
import crypto from 'crypto';
import type {
  Account,
  LedgerEntry,
  AuditRefusal,
  StatementItem,
  InvariantReport,
  IntegrityVerificationReport,
  RefusalReason,
  OperationType,
} from '../types.js';

// In-flight mutex set to catch simultaneous identical requests before DB commit
const inFlightIdempotencyKeys = new Set<string>();

export interface TransactionResult {
  success: boolean;
  transactionId?: string;
  operationType: OperationType;
  accountId: string;
  accountNumber?: string;
  counterpartyAccountNumber?: string | null;
  amount: number;
  balanceAfter?: number;
  idempotentReplay?: boolean;
  sequence?: number;
  hash?: string;
  refusalReason?: RefusalReason;
  errorMessage?: string;
  statusCode: number;
}

export class LedgerEngine {
  /**
   * Retrieves an account by ID or Account Number
   */
  static getAccount(idOrNumber: string): (Account & { ownerName: string; email: string }) | null {
    const row = db.prepare(`
      SELECT a.*, u.name as ownerName, u.email
      FROM accounts a
      JOIN users u ON a.owner_id = u.id
      WHERE a.id = ? OR a.account_number = ?
    `).get(idOrNumber, idOrNumber) as any;

    if (!row) return null;

    return {
      id: row.id,
      accountNumber: row.account_number,
      ownerId: row.owner_id,
      ownerName: row.ownerName,
      currency: row.currency,
      balance: row.balance,
      overdraftLimit: row.overdraft_limit,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      email: row.email,
    };
  }

  /**
   * List all accounts (for Administrator / Auditor)
   */
  static listAllAccounts(): Account[] {
    const rows = db.prepare(`
      SELECT a.*, u.name as ownerName
      FROM accounts a
      JOIN users u ON a.owner_id = u.id
      ORDER BY a.account_number ASC
    `).all() as any[];

    return rows.map(r => ({
      id: r.id,
      accountNumber: r.account_number,
      ownerId: r.owner_id,
      ownerName: r.ownerName,
      currency: r.currency,
      balance: r.balance,
      overdraftLimit: r.overdraft_limit,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * List accounts for a specific user
   */
  static listUserAccounts(userId: string): Account[] {
    const rows = db.prepare(`
      SELECT a.*, u.name as ownerName
      FROM accounts a
      JOIN users u ON a.owner_id = u.id
      WHERE a.owner_id = ?
      ORDER BY a.account_number ASC
    `).all(userId) as any[];

    return rows.map(r => ({
      id: r.id,
      accountNumber: r.account_number,
      ownerId: r.owner_id,
      ownerName: r.ownerName,
      currency: r.currency,
      balance: r.balance,
      overdraftLimit: r.overdraft_limit,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Records an audit refusal for an attempted money-moving operation
   */
  static logRefusal(params: {
    userId: string;
    userName: string;
    operationType: OperationType;
    accountId: string;
    accountNumber: string;
    attemptedAmount: number;
    runningBalanceAtAttempt: number;
    counterpartyAccountId?: string | null;
    counterpartyAccountNumber?: string | null;
    reason: RefusalReason;
    details: string;
    idempotencyKey?: string | null;
  }): AuditRefusal {
    const refusalId = `ref-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO audit_refusals (
        id, timestamp, initiated_by_user_id, operation_type, account_id,
        attempted_amount, running_balance_at_attempt, counterparty_account_id,
        reason, details, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      refusalId,
      now,
      params.userId,
      params.operationType,
      params.accountId,
      params.attemptedAmount,
      params.runningBalanceAtAttempt,
      params.counterpartyAccountId || null,
      params.reason,
      params.details,
      params.idempotencyKey || null
    );

    return {
      id: refusalId,
      timestamp: now,
      initiatedByUserId: params.userId,
      initiatedByUserName: params.userName,
      operationType: params.operationType,
      accountId: params.accountId,
      accountNumber: params.accountNumber,
      attemptedAmount: params.attemptedAmount,
      runningBalanceAtAttempt: params.runningBalanceAtAttempt,
      counterpartyAccountId: params.counterpartyAccountId,
      counterpartyAccountNumber: params.counterpartyAccountNumber,
      reason: params.reason,
      details: params.details,
      idempotencyKey: params.idempotencyKey,
    };
  }

  /**
   * Helper to check and register Idempotency
   */
  private static checkIdempotency(key: string, requestPayload: Record<string, unknown>): TransactionResult | 'IN_FLIGHT' | null {
    const reqHash = computeRequestHash(requestPayload);

    // 1. Check in-memory concurrent in-flight flag
    if (inFlightIdempotencyKeys.has(key)) {
      return 'IN_FLIGHT';
    }

    // 2. Check DB records
    const existing = db.prepare(`SELECT * FROM idempotency_records WHERE key = ?`).get(key) as any;
    if (existing) {
      if (existing.status === 'IN_FLIGHT') {
        return 'IN_FLIGHT';
      }
      if (existing.status === 'RESOLVED') {
        if (existing.request_hash !== reqHash) {
          return {
            success: false,
            operationType: 'transfer',
            accountId: '',
            amount: 0,
            statusCode: 422,
            refusalReason: 'IDEMPOTENCY_CONFLICT',
            errorMessage: 'Idempotency Key reused with different payload parameters. Request refused.',
          };
        }

        // Increment replay count
        db.prepare(`UPDATE idempotency_records SET hit_count = hit_count + 1 WHERE key = ?`).run(key);

        const parsed = JSON.parse(existing.response_body);
        return {
          ...parsed,
          idempotentReplay: true,
          statusCode: existing.response_status,
        };
      }
    }

    // Mark as in-flight
    inFlightIdempotencyKeys.add(key);
    db.prepare(`
      INSERT OR REPLACE INTO idempotency_records (key, request_hash, status, created_at, hit_count)
      VALUES (?, ?, 'IN_FLIGHT', ?, 1)
    `).run(key, reqHash, new Date().toISOString());

    return null;
  }

  private static recordIdempotencyResolution(key: string, result: TransactionResult) {
    inFlightIdempotencyKeys.delete(key);
    db.prepare(`
      UPDATE idempotency_records
      SET status = 'RESOLVED',
          response_status = ?,
          response_body = ?,
          resolved_at = ?
      WHERE key = ?
    `).run(result.statusCode, JSON.stringify(result), new Date().toISOString(), key);
  }

  private static recordIdempotencyFailure(key: string, result: TransactionResult) {
    inFlightIdempotencyKeys.delete(key);
    db.prepare(`
      UPDATE idempotency_records
      SET status = 'FAILED',
          response_status = ?,
          response_body = ?,
          resolved_at = ?
      WHERE key = ?
    `).run(result.statusCode, JSON.stringify(result), new Date().toISOString(), key);
  }

  /**
   * Internal helper: Get the last hash and sequence in the ledger
   */
  private static getLastLedgerState(): { lastSequence: number; lastHash: string } {
    const row = db.prepare(`
      SELECT sequence, hash FROM ledger_entries ORDER BY sequence DESC LIMIT 1
    `).get() as any;

    if (!row) {
      return {
        lastSequence: 0,
        lastHash: '0000000000000000000000000000000000000000000000000000000000000000',
      };
    }

    return {
      lastSequence: row.sequence,
      lastHash: row.hash,
    };
  }

  /**
   * Executes an External Cash Deposit (Vault -> Customer Account)
   * Conserves money: Vault debited (+deposit tracked), Customer Account credited (+balance)
   */
  static deposit(params: {
    accountId: string;
    amount: number;
    description: string;
    userId: string;
    userName: string;
    userRole: string;
    idempotencyKey?: string;
  }): TransactionResult {
    const { accountId, amount, description, userId, userName, userRole, idempotencyKey } = params;

    // Validate Amount
    if (!amount || typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      return {
        success: false,
        operationType: 'deposit',
        accountId,
        amount: amount || 0,
        statusCode: 400,
        refusalReason: 'INVALID_AMOUNT',
        errorMessage: 'Deposit amount must be a positive number greater than 0.',
      };
    }

    // Role verification: Auditors cannot move money
    if (userRole === 'auditor') {
      return {
        success: false,
        operationType: 'deposit',
        accountId,
        amount,
        statusCode: 403,
        refusalReason: 'UNAUTHORIZED_ACCOUNT_ACCESS',
        errorMessage: 'Auditors hold read-only privileges and are strictly barred from depositing money.',
      };
    }

    const account = this.getAccount(accountId);
    if (!account) {
      return {
        success: false,
        operationType: 'deposit',
        accountId,
        amount,
        statusCode: 404,
        refusalReason: 'ACCOUNT_NOT_FOUND',
        errorMessage: `Account with ID or number "${accountId}" does not exist.`,
      };
    }

    if (account.status !== 'active') {
      this.logRefusal({
        userId,
        userName,
        operationType: 'deposit',
        accountId: account.id,
        accountNumber: account.accountNumber,
        attemptedAmount: amount,
        runningBalanceAtAttempt: account.balance,
        reason: 'ACCOUNT_FROZEN',
        details: `Account is ${account.status}. Deposits rejected.`,
        idempotencyKey,
      });
      return {
        success: false,
        operationType: 'deposit',
        accountId: account.id,
        accountNumber: account.accountNumber,
        amount,
        statusCode: 422,
        refusalReason: 'ACCOUNT_FROZEN',
        errorMessage: `Account ${account.accountNumber} is ${account.status}.`,
      };
    }

    // Idempotency check
    const effectiveKey = idempotencyKey?.trim() || `dep-auto-${crypto.randomUUID()}`;
    const cached = this.checkIdempotency(effectiveKey, {
      op: 'deposit',
      accountId: account.id,
      amount: amount.toFixed(2),
      userId,
    });

    if (cached === 'IN_FLIGHT') {
      return {
        success: false,
        operationType: 'deposit',
        accountId: account.id,
        amount,
        statusCode: 409,
        errorMessage: 'A deposit with this idempotency key is currently in-flight. Please wait.',
      };
    }
    if (cached) return cached;

    // Atomic Execution
    const executeDeposit = db.transaction(() => {
      const now = new Date().toISOString();
      const txId = `tx-dep-${crypto.randomUUID().slice(0, 8)}`;
      const entryId = `entry-${crypto.randomUUID()}`;

      // Lock account row
      const current = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(account.id) as any;
      const newBalance = Number((current.balance + amount).toFixed(2));

      // Append ledger entry
      const { lastSequence, lastHash } = this.getLastLedgerState();
      const nextSeq = lastSequence + 1;
      const hash = computeLedgerHash({
        sequence: nextSeq,
        prevHash: lastHash,
        transactionId: txId,
        accountId: account.id,
        direction: 'credit',
        amount,
        runningBalance: newBalance,
        timestamp: now,
      });

      db.prepare(`
        INSERT INTO ledger_entries (
          sequence, id, transaction_id, operation_type, account_id, direction, amount,
          running_balance, counterparty_account_id, description, initiated_by_user_id,
          idempotency_key, timestamp, prev_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nextSeq,
        entryId,
        txId,
        'deposit',
        account.id,
        'credit',
        amount,
        newBalance,
        'vault-main',
        description || `External Cash Deposit to ${account.accountNumber}`,
        userId,
        effectiveKey,
        now,
        lastHash,
        hash
      );

      // Update account balance
      db.prepare(`UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`).run(newBalance, now, account.id);

      // Update System Vault
      db.prepare(`
        UPDATE system_vault
        SET balance = balance + ?, total_deposited = total_deposited + ?, updated_at = ?
        WHERE id = 'vault-main'
      `).run(amount, amount, now);

      return {
        success: true,
        transactionId: txId,
        operationType: 'deposit' as OperationType,
        accountId: account.id,
        accountNumber: account.accountNumber,
        amount,
        balanceAfter: newBalance,
        sequence: nextSeq,
        hash,
        statusCode: 200,
      };
    });

    try {
      const result = executeDeposit();
      this.recordIdempotencyResolution(effectiveKey, result);
      return result;
    } catch (err: any) {
      const failResult: TransactionResult = {
        success: false,
        operationType: 'deposit',
        accountId: account.id,
        amount,
        statusCode: 500,
        errorMessage: err.message || 'Transaction aborted by database.',
      };
      this.recordIdempotencyFailure(effectiveKey, failResult);
      return failResult;
    }
  }

  /**
   * Executes an External Cash Withdrawal (Customer Account -> Vault)
   * Conserves money: Customer Account debited (-balance), Vault credited (+withdrawal tracked)
   * Strictly enforces: balance >= -overdraftLimit
   */
  static withdraw(params: {
    accountId: string;
    amount: number;
    description: string;
    userId: string;
    userName: string;
    userRole: string;
    idempotencyKey?: string;
  }): TransactionResult {
    const { accountId, amount, description, userId, userName, userRole, idempotencyKey } = params;

    if (!amount || typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      return {
        success: false,
        operationType: 'withdrawal',
        accountId,
        amount: amount || 0,
        statusCode: 400,
        refusalReason: 'INVALID_AMOUNT',
        errorMessage: 'Withdrawal amount must be a positive number greater than 0.',
      };
    }

    if (userRole === 'auditor') {
      return {
        success: false,
        operationType: 'withdrawal',
        accountId,
        amount,
        statusCode: 403,
        refusalReason: 'UNAUTHORIZED_ACCOUNT_ACCESS',
        errorMessage: 'Auditors are restricted to read-only access.',
      };
    }

    const account = this.getAccount(accountId);
    if (!account) {
      return {
        success: false,
        operationType: 'withdrawal',
        accountId,
        amount,
        statusCode: 404,
        refusalReason: 'ACCOUNT_NOT_FOUND',
        errorMessage: `Account with ID or number "${accountId}" does not exist.`,
      };
    }

    // Authorization: User must own the account or be an administrator
    if (userRole !== 'administrator' && account.ownerId !== userId) {
      this.logRefusal({
        userId,
        userName,
        operationType: 'withdrawal',
        accountId: account.id,
        accountNumber: account.accountNumber,
        attemptedAmount: amount,
        runningBalanceAtAttempt: account.balance,
        reason: 'UNAUTHORIZED_ACCOUNT_ACCESS',
        details: `User ${userId} attempted withdrawal from account ${account.accountNumber} owned by ${account.ownerId}. Access denied.`,
        idempotencyKey,
      });

      return {
        success: false,
        operationType: 'withdrawal',
        accountId: account.id,
        accountNumber: account.accountNumber,
        amount,
        statusCode: 403,
        refusalReason: 'UNAUTHORIZED_ACCOUNT_ACCESS',
        errorMessage: 'Access Denied: You are not authorized to withdraw funds from this account.',
      };
    }

    if (account.status !== 'active') {
      this.logRefusal({
        userId,
        userName,
        operationType: 'withdrawal',
        accountId: account.id,
        accountNumber: account.accountNumber,
        attemptedAmount: amount,
        runningBalanceAtAttempt: account.balance,
        reason: 'ACCOUNT_FROZEN',
        details: `Account is ${account.status}. Withdrawals rejected.`,
        idempotencyKey,
      });
      return {
        success: false,
        operationType: 'withdrawal',
        accountId: account.id,
        accountNumber: account.accountNumber,
        amount,
        statusCode: 422,
        refusalReason: 'ACCOUNT_FROZEN',
        errorMessage: `Account ${account.accountNumber} is ${account.status}.`,
      };
    }

    // Idempotency check
    const effectiveKey = idempotencyKey?.trim() || `wth-auto-${crypto.randomUUID()}`;
    const cached = this.checkIdempotency(effectiveKey, {
      op: 'withdrawal',
      accountId: account.id,
      amount: amount.toFixed(2),
      userId,
    });

    if (cached === 'IN_FLIGHT') {
      return {
        success: false,
        operationType: 'withdrawal',
        accountId: account.id,
        amount,
        statusCode: 409,
        errorMessage: 'A withdrawal with this idempotency key is currently in-flight. Please wait.',
      };
    }
    if (cached) return cached;

    // Atomic Execution
    const executeWithdrawal = db.transaction(() => {
      const now = new Date().toISOString();

      // Read current locked balance
      const current = db.prepare(`SELECT balance, overdraft_limit FROM accounts WHERE id = ?`).get(account.id) as any;
      const currentBal = Number(current.balance);
      const overdraftLimit = Number(current.overdraft_limit || 0);
      const maxAllowedDebit = currentBal + overdraftLimit;

      if (amount > maxAllowedDebit) {
        const reason: RefusalReason = overdraftLimit > 0 ? 'OVERDRAFT_LIMIT_EXCEEDED' : 'INSUFFICIENT_FUNDS';
        this.logRefusal({
          userId,
          userName,
          operationType: 'withdrawal',
          accountId: account.id,
          accountNumber: account.accountNumber,
          attemptedAmount: amount,
          runningBalanceAtAttempt: currentBal,
          reason,
          details: `Requested ₹${amount.toFixed(2)}, available ₹${maxAllowedDebit.toFixed(2)} (Balance: ₹${currentBal.toFixed(2)}, Overdraft limit: ₹${overdraftLimit.toFixed(2)}).`,
          idempotencyKey: effectiveKey,
        });

        const refusalResult: TransactionResult = {
          success: false,
          operationType: 'withdrawal',
          accountId: account.id,
          accountNumber: account.accountNumber,
          amount,
          balanceAfter: currentBal,
          statusCode: 422,
          refusalReason: reason,
          errorMessage: `Withdrawal refused: Insufficient funds. Available: ₹${maxAllowedDebit.toFixed(2)}, Attempted: ₹${amount.toFixed(2)}.`,
        };

        return refusalResult;
      }

      const txId = `tx-wth-${crypto.randomUUID().slice(0, 8)}`;
      const entryId = `entry-${crypto.randomUUID()}`;
      const newBalance = Number((currentBal - amount).toFixed(2));

      // Append ledger entry
      const { lastSequence, lastHash } = this.getLastLedgerState();
      const nextSeq = lastSequence + 1;
      const hash = computeLedgerHash({
        sequence: nextSeq,
        prevHash: lastHash,
        transactionId: txId,
        accountId: account.id,
        direction: 'debit',
        amount,
        runningBalance: newBalance,
        timestamp: now,
      });

      db.prepare(`
        INSERT INTO ledger_entries (
          sequence, id, transaction_id, operation_type, account_id, direction, amount,
          running_balance, counterparty_account_id, description, initiated_by_user_id,
          idempotency_key, timestamp, prev_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nextSeq,
        entryId,
        txId,
        'withdrawal',
        account.id,
        'debit',
        amount,
        newBalance,
        'vault-main',
        description || `External Cash Withdrawal from ${account.accountNumber}`,
        userId,
        effectiveKey,
        now,
        lastHash,
        hash
      );

      // Update account balance
      db.prepare(`UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`).run(newBalance, now, account.id);

      // Update System Vault
      db.prepare(`
        UPDATE system_vault
        SET balance = balance - ?, total_withdrawn = total_withdrawn + ?, updated_at = ?
        WHERE id = 'vault-main'
      `).run(amount, amount, now);

      return {
        success: true,
        transactionId: txId,
        operationType: 'withdrawal' as OperationType,
        accountId: account.id,
        accountNumber: account.accountNumber,
        amount,
        balanceAfter: newBalance,
        sequence: nextSeq,
        hash,
        statusCode: 200,
      };
    });

    try {
      const result = executeWithdrawal();
      if (result.success) {
        this.recordIdempotencyResolution(effectiveKey, result);
      } else {
        // Refusal recorded in idempotency so retry also gets identical refusal
        this.recordIdempotencyResolution(effectiveKey, result);
      }
      return result;
    } catch (err: any) {
      const failResult: TransactionResult = {
        success: false,
        operationType: 'withdrawal',
        accountId: account.id,
        amount,
        statusCode: 500,
        errorMessage: err.message || 'Transaction aborted by database.',
      };
      this.recordIdempotencyFailure(effectiveKey, failResult);
      return failResult;
    }
  }

  /**
   * Executes an Internal Double-Entry Transfer between two accounts
   * Net change to system total balance is strictly 0.00
   * Source is Debited (-amount), Destination is Credited (+amount)
   * Deadlock-free account locking via sorted IDs
   */
  static transfer(params: {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    description: string;
    userId: string;
    userName: string;
    userRole: string;
    idempotencyKey?: string;
  }): TransactionResult {
    const { sourceAccountId, destinationAccountId, amount, description, userId, userName, userRole, idempotencyKey } = params;

    if (!amount || typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
      return {
        success: false,
        operationType: 'transfer',
        accountId: sourceAccountId,
        amount: amount || 0,
        statusCode: 400,
        refusalReason: 'INVALID_AMOUNT',
        errorMessage: 'Transfer amount must be a positive number greater than 0.',
      };
    }

    if (userRole === 'auditor') {
      return {
        success: false,
        operationType: 'transfer',
        accountId: sourceAccountId,
        amount,
        statusCode: 403,
        refusalReason: 'UNAUTHORIZED_ACCOUNT_ACCESS',
        errorMessage: 'Auditors are restricted to read-only access.',
      };
    }

    const source = this.getAccount(sourceAccountId);
    const destination = this.getAccount(destinationAccountId);

    if (!source) {
      return {
        success: false,
        operationType: 'transfer',
        accountId: sourceAccountId,
        amount,
        statusCode: 404,
        refusalReason: 'ACCOUNT_NOT_FOUND',
        errorMessage: `Source account "${sourceAccountId}" does not exist.`,
      };
    }

    if (!destination) {
      this.logRefusal({
        userId,
        userName,
        operationType: 'transfer',
        accountId: source.id,
        accountNumber: source.accountNumber,
        attemptedAmount: amount,
        runningBalanceAtAttempt: source.balance,
        reason: 'ACCOUNT_NOT_FOUND',
        details: `Destination account "${destinationAccountId}" not found.`,
        idempotencyKey,
      });
      return {
        success: false,
        operationType: 'transfer',
        accountId: source.id,
        accountNumber: source.accountNumber,
        amount,
        statusCode: 404,
        refusalReason: 'ACCOUNT_NOT_FOUND',
        errorMessage: `Destination account "${destinationAccountId}" does not exist.`,
      };
    }

    if (source.id === destination.id) {
      this.logRefusal({
        userId,
        userName,
        operationType: 'transfer',
        accountId: source.id,
        accountNumber: source.accountNumber,
        attemptedAmount: amount,
        runningBalanceAtAttempt: source.balance,
        counterpartyAccountId: destination.id,
        counterpartyAccountNumber: destination.accountNumber,
        reason: 'SELF_TRANSFER_PROHIBITED',
        details: 'Source and destination accounts are identical.',
        idempotencyKey,
      });
      return {
        success: false,
        operationType: 'transfer',
        accountId: source.id,
        amount,
        statusCode: 422,
        refusalReason: 'SELF_TRANSFER_PROHIBITED',
        errorMessage: 'Self-transfer is prohibited. Source and destination must be distinct accounts.',
      };
    }

    // Authorization: User must own the source account or be an administrator
    if (userRole !== 'administrator' && source.ownerId !== userId) {
      this.logRefusal({
        userId,
        userName,
        operationType: 'transfer',
        accountId: source.id,
        accountNumber: source.accountNumber,
        attemptedAmount: amount,
        runningBalanceAtAttempt: source.balance,
        counterpartyAccountId: destination.id,
        counterpartyAccountNumber: destination.accountNumber,
        reason: 'UNAUTHORIZED_ACCOUNT_ACCESS',
        details: `User ${userId} (${userName}) unauthorized to debit source account ${source.accountNumber} owned by ${source.ownerId}.`,
        idempotencyKey,
      });

      return {
        success: false,
        operationType: 'transfer',
        accountId: source.id,
        accountNumber: source.accountNumber,
        amount,
        statusCode: 403,
        refusalReason: 'UNAUTHORIZED_ACCOUNT_ACCESS',
        errorMessage: `Unauthorized: You do not have permission to transfer money out of account ${source.accountNumber}.`,
      };
    }

    if (source.status !== 'active') {
      this.logRefusal({
        userId,
        userName,
        operationType: 'transfer',
        accountId: source.id,
        accountNumber: source.accountNumber,
        attemptedAmount: amount,
        runningBalanceAtAttempt: source.balance,
        reason: 'ACCOUNT_FROZEN',
        details: `Source account is ${source.status}.`,
        idempotencyKey,
      });
      return {
        success: false,
        operationType: 'transfer',
        accountId: source.id,
        amount,
        statusCode: 422,
        refusalReason: 'ACCOUNT_FROZEN',
        errorMessage: `Source account ${source.accountNumber} is ${source.status}.`,
      };
    }

    if (destination.status !== 'active') {
      this.logRefusal({
        userId,
        userName,
        operationType: 'transfer',
        accountId: source.id,
        accountNumber: source.accountNumber,
        attemptedAmount: amount,
        runningBalanceAtAttempt: source.balance,
        counterpartyAccountId: destination.id,
        counterpartyAccountNumber: destination.accountNumber,
        reason: 'ACCOUNT_FROZEN',
        details: `Destination account is ${destination.status}.`,
        idempotencyKey,
      });
      return {
        success: false,
        operationType: 'transfer',
        accountId: source.id,
        amount,
        statusCode: 422,
        refusalReason: 'ACCOUNT_FROZEN',
        errorMessage: `Destination account ${destination.accountNumber} is ${destination.status}.`,
      };
    }

    // Idempotency check
    const effectiveKey = idempotencyKey?.trim() || `tx-auto-${crypto.randomUUID()}`;
    const cached = this.checkIdempotency(effectiveKey, {
      op: 'transfer',
      sourceId: source.id,
      destId: destination.id,
      amount: amount.toFixed(2),
      userId,
    });

    if (cached === 'IN_FLIGHT') {
      return {
        success: false,
        operationType: 'transfer',
        accountId: source.id,
        amount,
        statusCode: 409,
        errorMessage: 'A transfer with this idempotency key is currently in-flight. Please wait.',
      };
    }
    if (cached) return cached;

    // Atomic Double-Entry Transaction
    const executeTransfer = db.transaction(() => {
      const now = new Date().toISOString();

      // Deadlock prevention: sort account IDs deterministically before locking
      const [firstId, secondId] = [source.id, destination.id].sort();
      db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(firstId);
      db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(secondId);

      // Re-read latest locked state
      const freshSource = db.prepare(`SELECT balance, overdraft_limit FROM accounts WHERE id = ?`).get(source.id) as any;
      const freshDest = db.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(destination.id) as any;

      const currentSrcBal = Number(freshSource.balance);
      const overdraftLimit = Number(freshSource.overdraft_limit || 0);
      const maxAllowed = currentSrcBal + overdraftLimit;

      if (amount > maxAllowed) {
        const reason: RefusalReason = overdraftLimit > 0 ? 'OVERDRAFT_LIMIT_EXCEEDED' : 'INSUFFICIENT_FUNDS';
        this.logRefusal({
          userId,
          userName,
          operationType: 'transfer',
          accountId: source.id,
          accountNumber: source.accountNumber,
          attemptedAmount: amount,
          runningBalanceAtAttempt: currentSrcBal,
          counterpartyAccountId: destination.id,
          counterpartyAccountNumber: destination.accountNumber,
          reason,
          details: `Transfer refused: Requested ₹${amount.toFixed(2)}, available ₹${maxAllowed.toFixed(2)} (Balance: ₹${currentSrcBal.toFixed(2)}, Overdraft limit: ₹${overdraftLimit.toFixed(2)}).`,
          idempotencyKey: effectiveKey,
        });

        return {
          success: false,
          operationType: 'transfer' as OperationType,
          accountId: source.id,
          accountNumber: source.accountNumber,
          counterpartyAccountNumber: destination.accountNumber,
          amount,
          balanceAfter: currentSrcBal,
          statusCode: 422,
          refusalReason: reason,
          errorMessage: `Transfer refused: Insufficient funds in ${source.accountNumber}. Available: ₹${maxAllowed.toFixed(2)}, Requested: ₹${amount.toFixed(2)}.`,
        };
      }

      const txId = `tx-xfer-${crypto.randomUUID().slice(0, 8)}`;
      const newSourceBal = Number((currentSrcBal - amount).toFixed(2));
      const newDestBal = Number((Number(freshDest.balance) + amount).toFixed(2));

      // Append Leg 1: Source DEBIT
      let state = this.getLastLedgerState();
      const seq1 = state.lastSequence + 1;
      const hash1 = computeLedgerHash({
        sequence: seq1,
        prevHash: state.lastHash,
        transactionId: txId,
        accountId: source.id,
        direction: 'debit',
        amount,
        runningBalance: newSourceBal,
        timestamp: now,
      });

      db.prepare(`
        INSERT INTO ledger_entries (
          sequence, id, transaction_id, operation_type, account_id, direction, amount,
          running_balance, counterparty_account_id, description, initiated_by_user_id,
          idempotency_key, timestamp, prev_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        seq1,
        `entry-${crypto.randomUUID()}`,
        txId,
        'transfer',
        source.id,
        'debit',
        amount,
        newSourceBal,
        destination.id,
        description || `Transfer to ${destination.accountNumber}`,
        userId,
        effectiveKey,
        now,
        state.lastHash,
        hash1
      );

      // Append Leg 2: Destination CREDIT
      const seq2 = seq1 + 1;
      const hash2 = computeLedgerHash({
        sequence: seq2,
        prevHash: hash1,
        transactionId: txId,
        accountId: destination.id,
        direction: 'credit',
        amount,
        runningBalance: newDestBal,
        timestamp: now,
      });

      db.prepare(`
        INSERT INTO ledger_entries (
          sequence, id, transaction_id, operation_type, account_id, direction, amount,
          running_balance, counterparty_account_id, description, initiated_by_user_id,
          idempotency_key, timestamp, prev_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        seq2,
        `entry-${crypto.randomUUID()}`,
        txId,
        'transfer',
        destination.id,
        'credit',
        amount,
        newDestBal,
        source.id,
        description || `Transfer from ${source.accountNumber}`,
        userId,
        effectiveKey,
        now,
        hash1,
        hash2
      );

      // Update both account balances atomically
      db.prepare(`UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`).run(newSourceBal, now, source.id);
      db.prepare(`UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?`).run(newDestBal, now, destination.id);

      return {
        success: true,
        transactionId: txId,
        operationType: 'transfer' as OperationType,
        accountId: source.id,
        accountNumber: source.accountNumber,
        counterpartyAccountNumber: destination.accountNumber,
        amount,
        balanceAfter: newSourceBal,
        sequence: seq2,
        hash: hash2,
        statusCode: 200,
      };
    });

    try {
      const result = executeTransfer();
      this.recordIdempotencyResolution(effectiveKey, result);
      return result;
    } catch (err: any) {
      const failResult: TransactionResult = {
        success: false,
        operationType: 'transfer',
        accountId: source.id,
        amount,
        statusCode: 500,
        errorMessage: err.message || 'Transaction aborted by database.',
      };
      this.recordIdempotencyFailure(effectiveKey, failResult);
      return failResult;
    }
  }

  /**
   * Generates a per-account statement:
   * Returns every debit, every credit, AND every refused attempt,
   * chronologically sorted with running balance and initiator details.
   */
  static getStatement(accountId: string): StatementItem[] {
    const account = this.getAccount(accountId);
    if (!account) return [];

    // 1. Get posted ledger entries
    const postedRows = db.prepare(`
      SELECT
        le.id,
        le.timestamp,
        'POSTED' as type,
        le.operation_type,
        le.direction,
        le.amount,
        le.running_balance,
        le.description,
        le.idempotency_key,
        le.hash,
        u.name as initiated_by_name,
        cp.account_number as counterparty_account_number
      FROM ledger_entries le
      JOIN users u ON le.initiated_by_user_id = u.id
      LEFT JOIN accounts cp ON le.counterparty_account_id = cp.id
      WHERE le.account_id = ?
    `).all(account.id) as any[];

    // 2. Get refused attempts
    const refusedRows = db.prepare(`
      SELECT
        ar.id,
        ar.timestamp,
        'REFUSED' as type,
        ar.operation_type,
        ar.attempted_amount as amount,
        ar.running_balance_at_attempt as running_balance,
        ar.details as description,
        ar.idempotency_key,
        ar.reason as refusal_reason,
        u.name as initiated_by_name,
        cp.account_number as counterparty_account_number
      FROM audit_refusals ar
      JOIN users u ON ar.initiated_by_user_id = u.id
      LEFT JOIN accounts cp ON ar.counterparty_account_id = cp.id
      WHERE ar.account_id = ?
    `).all(account.id) as any[];

    // Combine and sort chronologically DESC
    const combined: StatementItem[] = [
      ...postedRows.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        type: 'POSTED' as const,
        operationType: r.operation_type as OperationType,
        direction: r.direction as any,
        amount: r.amount,
        runningBalance: r.running_balance,
        counterpartyAccountNumber: r.counterparty_account_number,
        description: r.description,
        initiatedByUserName: r.initiated_by_name,
        idempotencyKey: r.idempotency_key,
        hash: r.hash,
      })),
      ...refusedRows.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        type: 'REFUSED' as const,
        operationType: r.operation_type as OperationType,
        amount: r.amount,
        runningBalance: r.running_balance,
        counterpartyAccountNumber: r.counterparty_account_number,
        description: r.description,
        initiatedByUserName: r.initiated_by_name,
        idempotencyKey: r.idempotency_key,
        refusalReason: r.refusal_reason,
      })),
    ];

    return combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * System Conservation Invariant Check:
   * Proves that:
   * 1. SUM(Customer Account Balances) === Vault Total Deposited - Vault Total Withdrawn
   * 2. Internal transfers net to exactly 0.00
   * 3. Discrepancy is 0.00
   */
  static checkInvariant(): InvariantReport {
    const custSumRow = db.prepare(`SELECT COALESCE(SUM(balance), 0.0) as total FROM accounts`).get() as any;
    const totalCustBalances = Number(custSumRow.total.toFixed(2));

    const vault = db.prepare(`SELECT * FROM system_vault WHERE id = 'vault-main'`).get() as any;
    const netDeposited = Number((vault.total_deposited || 0).toFixed(2));
    const netWithdrawn = Number((vault.total_withdrawn || 0).toFixed(2));
    const vaultBal = Number((vault.balance || 0).toFixed(2));
    const expectedCustBalances = Number((netDeposited - netWithdrawn).toFixed(2));

    const discrepancy = Number(Math.abs(totalCustBalances - expectedCustBalances).toFixed(2));
    const isConserved = discrepancy === 0;

    const accountsCount = (db.prepare(`SELECT COUNT(*) as c FROM accounts`).get() as any).c;
    const entriesCount = (db.prepare(`SELECT COUNT(*) as c FROM ledger_entries`).get() as any).c;
    const refusalsCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_refusals`).get() as any).c;

    return {
      isConserved,
      totalCustomerBalances: totalCustBalances,
      systemCashVaultBalance: vaultBal,
      netExternalDeposits: netDeposited,
      netExternalWithdrawals: netWithdrawn,
      netExternalFlow: expectedCustBalances,
      discrepancy,
      customerAccountsCount: accountsCount,
      ledgerEntriesCount: entriesCount,
      totalRefusalsCount: refusalsCount,
      lastCalculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Verifies the cryptographic SHA-256 hash chain of the entire ledger
   */
  static verifyLedgerIntegrity(): IntegrityVerificationReport {
    const entries = db.prepare(`
      SELECT le.*, a.account_number
      FROM ledger_entries le
      JOIN accounts a ON le.account_id = a.id
      ORDER BY le.sequence ASC
    `).all() as any[];

    let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const expectedSeq = i + 1;

      if (entry.sequence !== expectedSeq) {
        return {
          isValid: false,
          totalEntriesChecked: i,
          brokenSequence: entry.sequence,
          actualHash: entry.hash,
          checkedAt: new Date().toISOString(),
        };
      }

      if (entry.prev_hash !== expectedPrevHash) {
        return {
          isValid: false,
          totalEntriesChecked: i,
          brokenSequence: entry.sequence,
          expectedHash: expectedPrevHash,
          actualHash: entry.prev_hash,
          checkedAt: new Date().toISOString(),
          tamperedEntry: entry,
        };
      }

      const calculatedHash = computeLedgerHash({
        sequence: entry.sequence,
        prevHash: entry.prev_hash,
        transactionId: entry.transaction_id,
        accountId: entry.account_id,
        direction: entry.direction,
        amount: entry.amount,
        runningBalance: entry.running_balance,
        timestamp: entry.timestamp,
      });

      if (calculatedHash !== entry.hash) {
        return {
          isValid: false,
          totalEntriesChecked: i,
          brokenSequence: entry.sequence,
          expectedHash: calculatedHash,
          actualHash: entry.hash,
          checkedAt: new Date().toISOString(),
          tamperedEntry: entry,
        };
      }

      expectedPrevHash = entry.hash;
    }

    return {
      isValid: true,
      totalEntriesChecked: entries.length,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Attack Simulation: Temporarily tamper with a ledger entry amount
   * (Demonstrates that the cryptographic auditor catches rogue DB modification immediately)
   */
  static simulateTampering(sequence: number, tamperedAmount: number): boolean {
    // Drop immutable trigger temporarily in controlled demo mode
    db.exec(`DROP TRIGGER IF EXISTS prevent_ledger_update;`);
    try {
      db.prepare(`UPDATE ledger_entries SET amount = ? WHERE sequence = ?`).run(tamperedAmount, sequence);
      return true;
    } finally {
      // Re-enable trigger
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS prevent_ledger_update
        BEFORE UPDATE ON ledger_entries
        BEGIN
          SELECT RAISE(ABORT, 'Ledger entries are strictly immutable. UPDATE is prohibited.');
        END;
      `);
    }
  }

  /**
   * Restore tampered entry to valid state
   */
  static restoreTamperedEntry(sequence: number, originalAmount: number): boolean {
    db.exec(`DROP TRIGGER IF EXISTS prevent_ledger_update;`);
    try {
      db.prepare(`UPDATE ledger_entries SET amount = ? WHERE sequence = ?`).run(originalAmount, sequence);
      return true;
    } finally {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS prevent_ledger_update
        BEFORE UPDATE ON ledger_entries
        BEGIN
          SELECT RAISE(ABORT, 'Ledger entries are strictly immutable. UPDATE is prohibited.');
        END;
      `);
    }
  }

  /**
   * Creates a new account (Administrator only)
   */
  static createAccount(params: {
    accountNumber: string;
    ownerId: string;
    currency?: string;
    overdraftLimit?: number;
    initialDeposit?: number;
    adminUserId: string;
    adminUserName: string;
  }): Account {
    const id = `acc-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const currency = params.currency || 'INR';
    const overdraftLimit = params.overdraftLimit && params.overdraftLimit > 0 ? params.overdraftLimit : 0.0;

    db.prepare(`
      INSERT INTO accounts (id, account_number, owner_id, currency, balance, overdraft_limit, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0.0, ?, 'active', ?, ?)
    `).run(id, params.accountNumber, params.ownerId, currency, overdraftLimit, now, now);

    if (params.initialDeposit && params.initialDeposit > 0) {
      this.deposit({
        accountId: id,
        amount: params.initialDeposit,
        description: `Initial Account Opening Deposit for ${params.accountNumber}`,
        userId: params.adminUserId,
        userName: params.adminUserName,
        userRole: 'administrator',
        idempotencyKey: `init-dep-${id}`,
      });
    }

    return this.getAccount(id)!;
  }
}
