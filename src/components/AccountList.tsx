import React, { useState } from 'react';
import { Plus, ArrowUpRight, ArrowDownLeft, FileText, Wallet, AlertCircle, ArrowRightLeft, Sparkles } from 'lucide-react';
import type { Account, User, InvariantReport } from '../types.js';

interface AccountListProps {
  accounts: Account[];
  currentUser: User | null;
  invariant: InvariantReport | null;
  onSelectAccountForStatement: (account: Account) => void;
  onInitiateTransfer: (sourceAccount: Account) => void;
  onInitiateCash: (account: Account, type: 'deposit' | 'withdrawal') => void;
  onCreateAccount: (data: { accountNumber: string; ownerId: string; overdraftLimit: number; initialDeposit: number }) => Promise<void>;
  users: User[];
  onOpenNewUserModal: () => void;
}

export const AccountList: React.FC<AccountListProps> = ({
  accounts,
  currentUser,
  onSelectAccountForStatement,
  onInitiateTransfer,
  onInitiateCash,
  onCreateAccount,
  users,
  onOpenNewUserModal,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAccNumber, setNewAccNumber] = useState(`ACC-${Math.floor(10000 + Math.random() * 90000)}`);
  const [newOwnerId, setNewOwnerId] = useState(currentUser?.id || users[0]?.id || '');
  const [newOverdraft, setNewOverdraft] = useState('0');
  const [newInitialDeposit, setNewInitialDeposit] = useState('0'); // Default starts strictly at 0!
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const isAdmin = currentUser?.role === 'administrator';
  const isAuditor = currentUser?.role === 'auditor';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onCreateAccount({
        accountNumber: newAccNumber.trim(),
        ownerId: newOwnerId,
        overdraftLimit: Number(newOverdraft) || 0,
        initialDeposit: Number(newInitialDeposit) || 0, // Starts at 0
      });
      setShowCreateModal(false);
      setNewAccNumber(`ACC-${Math.floor(10000 + Math.random() * 90000)}`);
      setNewInitialDeposit('0');
      setNewOverdraft('0');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create account');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBrandNewAccount = accounts.length > 0 && accounts.every(a => a.balance === 0);

  return (
    <div className="space-y-6">
      {/* Friendly Welcome & Balance Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-7 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-xs text-slate-400 font-medium mb-1">
              {isAdmin
                ? 'Institutional Total Balances'
                : `Total Balance for ${currentUser?.name}`}
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold font-mono tracking-tight text-white flex items-baseline gap-2">
              <span>₹{totalBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="text-xs font-sans font-normal text-slate-400">INR</span>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} active in system
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {accounts.length > 0 && !isAuditor && (
              <>
                <button
                  onClick={() => onInitiateCash(accounts[0], 'deposit')}
                  className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md transition-all"
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  + Deposit Money
                </button>
                <button
                  onClick={() => onInitiateTransfer(accounts[0])}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 border border-slate-700 transition-all"
                >
                  <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
                  Transfer Funds
                </button>
              </>
            )}

            {isAdmin && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs flex items-center gap-1.5 border border-slate-700 transition-all"
              >
                <Plus className="w-4 h-4 text-emerald-400" />
                Add Account
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Fresh User Guidance Banner if balance is 0 */}
      {isBrandNewAccount && (
        <div className="bg-emerald-950/30 border border-emerald-500/20 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-emerald-300">Fresh Account Ready (Zero Balance & Clean Slate)</h3>
            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
              Your account is active with a starting balance of <strong>₹0.00</strong> and zero transaction history. Use the <strong>+ Deposit Money</strong> button to fund your account, or receive a transfer from another user!
            </p>
          </div>
        </div>
      )}

      {/* Accounts List Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white">Your Accounts</h2>
          <p className="text-xs text-slate-400">
            {isAdmin
              ? 'Administrator Overview: All institutional accounts'
              : 'Select an account to view its statement or move money'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenNewUserModal}
            className="text-xs text-slate-400 hover:text-emerald-400 transition-colors flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Create another user (starts at ₹0)
          </button>
        </div>
      </div>

      {/* Modern Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.length === 0 ? (
          <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400">
            No accounts found for this user.
          </div>
        ) : (
          accounts.map(acc => {
            const isOwner = currentUser?.id === acc.ownerId || isAdmin;
            const canMove = !isAuditor && isOwner;

            return (
              <div
                key={acc.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 shadow-sm transition-all space-y-4"
              >
                {/* Account Card Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      {acc.accountNumber}
                    </span>
                    <h3 className="text-sm font-bold text-white mt-1.5">{acc.ownerName}</h3>
                    <div className="text-[11px] text-slate-400">Account ID: {acc.id}</div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Available Balance</span>
                    <span className={`text-xl font-bold font-mono ${acc.balance < 0 ? 'text-rose-400' : 'text-white'}`}>
                      ₹{acc.balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    {acc.overdraftLimit > 0 && (
                      <span className="text-[10px] text-amber-400 block font-mono">
                        Overdraft: ₹{acc.overdraftLimit.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Account Card Actions */}
                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <button
                    onClick={() => onSelectAccountForStatement(acc)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-sky-400" />
                    Statement
                  </button>

                  {canMove && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onInitiateCash(acc, 'deposit')}
                        className="px-2.5 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-emerald-300 rounded-xl text-xs font-medium border border-slate-700/80 transition-colors"
                      >
                        + Deposit
                      </button>
                      <button
                        onClick={() => onInitiateCash(acc, 'withdrawal')}
                        className="px-2.5 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-rose-300 rounded-xl text-xs font-medium border border-slate-700/80 transition-colors"
                      >
                        - Withdraw
                      </button>
                      <button
                        onClick={() => onInitiateTransfer(acc)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow transition-colors flex items-center gap-1"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        Transfer
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create Account Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-400" />
                Open Account
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-950/60 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Account Number</label>
                <input
                  type="text"
                  required
                  value={newAccNumber}
                  onChange={e => setNewAccNumber(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Account Owner</label>
                <select
                  value={newOwnerId}
                  onChange={e => setNewOwnerId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role.replace('_', ' ')})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Opening Deposit (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={newInitialDeposit}
                    onChange={e => setNewInitialDeposit(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                    placeholder="0"
                  />
                  <span className="text-[10px] text-slate-500">Defaults to ₹0 (Fresh start)</span>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Overdraft Limit (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={newOverdraft}
                    onChange={e => setNewOverdraft(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                    placeholder="0"
                  />
                  <span className="text-[10px] text-slate-500">Default: ₹0.00</span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Open Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
