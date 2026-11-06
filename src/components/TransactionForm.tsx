import React, { useState, useEffect } from 'react';
import { ArrowRightLeft, ArrowDownLeft, ArrowUpRight, Key, AlertTriangle, CheckCircle, RefreshCw, ChevronDown, ChevronUp, ShieldAlert, Sparkles } from 'lucide-react';
import type { Account, User, OperationType } from '../types.js';

interface TransactionFormProps {
  accounts: Account[];
  currentUser: User | null;
  initialType?: OperationType;
  initialSourceAccount?: Account | null;
  onSuccess: () => void;
}

export const TransactionForm: React.FC<TransactionFormProps> = ({
  accounts,
  currentUser,
  initialType = 'transfer',
  initialSourceAccount = null,
  onSuccess,
}) => {
  const [activeType, setActiveType] = useState<OperationType>(initialType);
  const [sourceAccountId, setSourceAccountId] = useState<string>('');
  const [destAccountId, setDestAccountId] = useState<string>('');
  const [amount, setAmount] = useState<string>(''); // Clean empty start, NO default 1000!
  const [description, setDescription] = useState<string>(''); // Clean empty start
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [lastSubmittedKey, setLastSubmittedKey] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Generate unique idempotency key silently in the background
  const generateNewKey = () => {
    const newKey = `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setIdempotencyKey(newKey);
  };

  useEffect(() => {
    generateNewKey();
  }, [activeType]);

  useEffect(() => {
    if (initialSourceAccount) {
      setSourceAccountId(initialSourceAccount.id);
    } else if (accounts.length > 0 && !sourceAccountId) {
      setSourceAccountId(accounts[0].id);
    }
  }, [initialSourceAccount, accounts]);

  useEffect(() => {
    if (accounts.length > 1) {
      const other = accounts.find(a => a.id !== sourceAccountId);
      if (other) setDestAccountId(other.id);
    }
  }, [sourceAccountId, accounts]);

  const sourceAccount = accounts.find(a => a.id === sourceAccountId);
  const destAccount = accounts.find(a => a.id === destAccountId);

  const handleSubmit = async (e?: React.FormEvent, overrideKey?: string) => {
    if (e) e.preventDefault();
    if (!currentUser) return;

    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setErrorMsg('Please enter a valid amount greater than ₹0.00');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setReceipt(null);

    const keyToUse = overrideKey || idempotencyKey || `idem-${Date.now()}`;

    try {
      let endpoint = '/api/transactions/transfer';
      let payload: any = {
        amount: parsedAmount,
        description: description.trim() || undefined,
        idempotencyKey: keyToUse,
      };

      if (activeType === 'deposit') {
        endpoint = '/api/transactions/deposit';
        payload.accountId = sourceAccountId;
      } else if (activeType === 'withdrawal') {
        endpoint = '/api/transactions/withdraw';
        payload.accountId = sourceAccountId;
      } else {
        payload.sourceAccountId = sourceAccountId;
        payload.destinationAccountId = destAccountId;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': currentUser.id,
          'Idempotency-Key': keyToUse,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setLastSubmittedKey(keyToUse);

      if (!res.ok) {
        setErrorMsg(data.errorMessage || data.error || 'Transaction could not be completed.');
        setReceipt({
          ...data,
          status: res.status,
          success: false,
          keyUsed: keyToUse,
        });
      } else {
        setReceipt({
          ...data,
          status: res.status,
          success: true,
          keyUsed: keyToUse,
        });
        setAmount('');
        setDescription('');
        generateNewKey();
        onSuccess();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network communication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReplayLast = () => {
    if (!lastSubmittedKey) return;
    handleSubmit(undefined, lastSubmittedKey);
  };

  const isAuditor = currentUser?.role === 'auditor';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Clean Segmented Control */}
      <div className="bg-slate-900 border border-slate-800 p-1.5 rounded-2xl flex items-center gap-1 shadow-sm">
        <button
          onClick={() => { setActiveType('transfer'); setReceipt(null); setErrorMsg(null); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeType === 'transfer'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ArrowRightLeft className="w-4 h-4" />
          Transfer Funds
        </button>
        <button
          onClick={() => { setActiveType('deposit'); setReceipt(null); setErrorMsg(null); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeType === 'deposit'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ArrowDownLeft className="w-4 h-4" />
          Deposit Cash
        </button>
        <button
          onClick={() => { setActiveType('withdrawal'); setReceipt(null); setErrorMsg(null); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeType === 'withdrawal'
              ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ArrowUpRight className="w-4 h-4" />
          Withdraw Cash
        </button>
      </div>

      {isAuditor && (
        <div className="p-4 bg-amber-950/40 border border-amber-500/30 rounded-2xl text-amber-300 text-xs flex items-center gap-2.5">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 text-amber-400" />
          <span>Auditor Role: Read-only access enabled. You can inspect statements and audit logs, but the server forbids money movement.</span>
        </div>
      )}

      {/* Main Form Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        <div>
          <h2 className="text-lg font-bold text-white">
            {activeType === 'transfer' && 'Transfer Money between Accounts'}
            {activeType === 'deposit' && 'Deposit Cash into Account'}
            {activeType === 'withdrawal' && 'Withdraw Cash from Account'}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {activeType === 'transfer' && 'Instant, atomic internal transfer. Double-entry balanced in real time.'}
            {activeType === 'deposit' && 'Inflow from central reserve vault into customer account.'}
            {activeType === 'withdrawal' && 'Outflow to cash vault. Strictly verifies available balance and overdraft.'}
          </p>
        </div>

        {errorMsg && (
          <div className="p-3.5 bg-rose-950/50 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={e => handleSubmit(e)} className="space-y-5">
          {/* Account Selection */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                {activeType === 'deposit' ? 'Deposit To (Destination Account)' : 'Pay From (Source Account)'}
              </label>
              <select
                value={sourceAccountId}
                onChange={e => setSourceAccountId(e.target.value)}
                className="w-full bg-slate-800/90 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-xs sm:text-sm font-mono focus:outline-none focus:border-emerald-500 transition-colors"
              >
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.accountNumber} — {acc.ownerName} (Available: ₹{acc.balance.toFixed(2)})
                  </option>
                ))}
              </select>
              {sourceAccount && (
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Current Balance: <strong className="text-white font-mono">₹{sourceAccount.balance.toFixed(2)}</strong></span>
                  {sourceAccount.overdraftLimit > 0 && (
                    <span className="text-amber-400 font-mono">Overdraft Limit: ₹{sourceAccount.overdraftLimit.toFixed(2)}</span>
                  )}
                </div>
              )}
            </div>

            {activeType === 'transfer' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Transfer To (Destination Account)
                </label>
                <select
                  value={destAccountId}
                  onChange={e => setDestAccountId(e.target.value)}
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-xs sm:text-sm font-mono focus:outline-none focus:border-emerald-500 transition-colors"
                >
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id} disabled={acc.id === sourceAccountId}>
                      {acc.accountNumber} — {acc.ownerName} {acc.id === sourceAccountId ? '(Selected as Source)' : ''}
                    </option>
                  ))}
                </select>
                {destAccount && (
                  <div className="mt-1 text-[11px] text-slate-400">
                    Beneficiary: <strong className="text-slate-200">{destAccount.ownerName}</strong> ({destAccount.accountNumber})
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Amount Input with clean zero start */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Amount (₹)</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">₹</span>
              <input
                type="number"
                min="0.01"
                step="any"
                required
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-xl pl-8 pr-4 py-2.5 text-white font-mono text-base font-bold placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            {/* Quick Amount Suggestion Chips */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[11px] text-slate-500">Quick amounts:</span>
              {[100, 500, 1000, 2500].map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAmount(val.toString())}
                  className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono border border-slate-700/80 transition-colors"
                >
                  +₹{val}
                </button>
              ))}
              {sourceAccount && sourceAccount.balance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(sourceAccount.balance.toString())}
                  className="px-2 py-0.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[11px] font-mono border border-emerald-500/30 transition-colors"
                >
                  Full Balance
                </button>
              )}
            </div>
          </div>

          {/* Optional Note / Reference */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Note / Memo (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Project reimbursement, invoice, coffee"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-slate-800/90 border border-slate-700 rounded-xl px-3.5 py-2 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Collapsible Advanced Section for Idempotency & Testing */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 font-medium transition-colors"
            >
              <Key className="w-3.5 h-3.5 text-emerald-400" />
              <span>Advanced: Idempotency Key & Concurrency Options</span>
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
            </button>

            {showAdvanced && (
              <div className="mt-3 p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3 text-xs animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300">Client Idempotency Key</span>
                  <button
                    type="button"
                    onClick={generateNewKey}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    New Key
                  </button>
                </div>
                <input
                  type="text"
                  value={idempotencyKey}
                  onChange={e => setIdempotencyKey(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-300 font-mono text-xs"
                />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Used by banks to guarantee that retried network calls never double-charge. Submitting the identical key twice returns the exact first result with <code>X-Idempotent-Replay: true</code>.
                </p>

                {lastSubmittedKey && (
                  <button
                    type="button"
                    onClick={handleReplayLast}
                    disabled={isSubmitting}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Replay Last Key ({lastSubmittedKey.slice(0, 12)}...)
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-bold text-sm shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Processing Transaction...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Confirm & Send {amount ? `₹${Number(amount).toFixed(2)}` : ''}
                </>
              )}
            </button>
          </div>
        </form>

        {/* Clean Transaction Receipt Card */}
        {receipt && (
          <div
            className={`p-5 rounded-2xl border text-xs space-y-3 animate-in fade-in duration-150 ${
              receipt.success
                ? receipt.idempotentReplay
                  ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                  : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
            }`}
          >
            <div className="flex items-center justify-between font-bold text-sm">
              <span className="flex items-center gap-2">
                {receipt.success ? (
                  receipt.idempotentReplay ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-amber-400" />
                      Duplicate Replay Caught (Exact-Once Protected)
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      Transaction Completed Successfully
                    </>
                  )
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    Transaction Refused & Logged to Audit Trail
                  </>
                )}
              </span>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-black/40">
                HTTP {receipt.statusCode || receipt.status}
              </span>
            </div>

            {receipt.errorMessage && (
              <p className="text-rose-300 font-medium">{receipt.errorMessage}</p>
            )}

            <div className="grid grid-cols-2 gap-2 font-mono text-[11px] pt-2 border-t border-white/10">
              <div>
                <span className="text-slate-400 block text-[10px]">Transaction ID</span>
                <span className="text-white">{receipt.transactionId || 'None (Refused)'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">New Balance</span>
                <span className="text-white font-bold">
                  {receipt.balanceAfter !== undefined ? `₹${receipt.balanceAfter.toFixed(2)}` : 'Unchanged'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
