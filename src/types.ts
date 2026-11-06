export type UserRole = 'administrator' | 'account_holder' | 'auditor';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
}

export type AccountStatus = 'active' | 'frozen' | 'closed';

export interface Account {
  id: string;
  accountNumber: string;
  ownerId: string;
  ownerName: string;
  currency: string;
  balance: number;
  overdraftLimit: number; // Defaults to 0; server strictly enforces balance >= -overdraftLimit
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export type EntryDirection = 'debit' | 'credit';
export type OperationType = 'deposit' | 'withdrawal' | 'transfer' | 'settlement';

export interface LedgerEntry {
  sequence: number;
  id: string;
  transactionId: string;
  operationType: OperationType;
  accountId: string;
  accountNumber: string;
  direction: EntryDirection;
  amount: number;
  runningBalance: number;
  counterpartyAccountId?: string | null;
  counterpartyAccountNumber?: string | null;
  description: string;
  initiatedByUserId: string;
  initiatedByUserName: string;
  idempotencyKey?: string | null;
  timestamp: string;
  prevHash: string;
  hash: string;
}

export type RefusalReason =
  | 'INSUFFICIENT_FUNDS'
  | 'OVERDRAFT_LIMIT_EXCEEDED'
  | 'UNAUTHORIZED_ACCOUNT_ACCESS'
  | 'ACCOUNT_FROZEN'
  | 'ACCOUNT_NOT_FOUND'
  | 'INVALID_AMOUNT'
  | 'SELF_TRANSFER_PROHIBITED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CONCURRENT_UPDATE_CONFLICT';

export interface AuditRefusal {
  id: string;
  timestamp: string;
  initiatedByUserId: string;
  initiatedByUserName: string;
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
}

export interface StatementItem {
  id: string;
  timestamp: string;
  type: 'POSTED' | 'REFUSED';
  operationType: OperationType;
  direction?: EntryDirection;
  amount: number;
  runningBalance: number;
  counterpartyAccountNumber?: string | null;
  description: string;
  initiatedByUserName: string;
  idempotencyKey?: string | null;
  refusalReason?: RefusalReason;
  hash?: string;
}

export interface InvariantReport {
  isConserved: boolean;
  totalCustomerBalances: number;
  systemCashVaultBalance: number;
  netExternalDeposits: number;
  netExternalWithdrawals: number;
  netExternalFlow: number;
  discrepancy: number; // Must be 0.00
  customerAccountsCount: number;
  ledgerEntriesCount: number;
  totalRefusalsCount: number;
  lastCalculatedAt: string;
}

export interface IntegrityVerificationReport {
  isValid: boolean;
  totalEntriesChecked: number;
  brokenSequence?: number;
  expectedHash?: string;
  actualHash?: string;
  checkedAt: string;
  tamperedEntry?: LedgerEntry;
}

export interface AnomalyFlag {
  id: string;
  accountId: string;
  accountNumber: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  suggestedAction: string;
  detectedAt: string;
  status: 'pending_review' | 'acknowledged' | 'dismissed';
  humanReviewNote?: string;
  reviewedByUserId?: string;
  reviewedAt?: string;
}

export interface ConcurrencyTestResult {
  testName: string;
  totalRequests: number;
  successfulRequests: number;
  refusedRequests: number;
  failedRequests: number;
  initialBalance: number;
  finalBalance: number;
  expectedFinalBalance: number;
  invariantPreserved: boolean;
  durationMs: number;
  details: Array<{
    requestId: number;
    status: number;
    success: boolean;
    reason?: string;
    finalBalance?: number;
    idempotentReplay?: boolean;
    durationMs: number;
  }>;
}
