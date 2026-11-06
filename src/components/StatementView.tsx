import React, { useState, useEffect } from 'react';
import { FileText, ArrowDownLeft, ArrowUpRight, AlertOctagon, CheckCircle2, Download, Filter, Inbox, ArrowRightLeft } from 'lucide-react';
import type { Account, StatementItem, User } from '../types.js';

interface StatementViewProps {
  accounts: Account[];
  selectedAccount: Account | null;
  onSelectAccount: (account: Account) => void;
  currentUser: User | null;
  onNavigateToTransfer?: () => void;
}

export const StatementView: React.FC<StatementViewProps> = ({
  accounts,
  selectedAccount,
  onSelectAccount,
  currentUser,
  onNavigateToTransfer,
}) => {
  const [statement, setStatement] = useState<StatementItem[]>([]);
  const [filterType, setFilterType] = useState<'ALL' | 'POSTED' | 'REFUSED'>('ALL');
  const [isLoading, setIsLoading] = useState(false);

  const activeAccount = selectedAccount || (accounts.length > 0 ? accounts[0] : null);

  const fetchStatement = async (accId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accId}/statement`, {
        headers: {
          'X-User-Id': currentUser?.id || '',
        },
      });
      if (res.ok) {
        const data = await res.json();
        setStatement(data.statement || []);
      }
    } catch (err) {
      console.error('Failed to load statement:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeAccount) {
      fetchStatement(activeAccount.id);
    }
  }, [activeAccount, currentUser]);

  const filteredItems = statement.filter(item => {
    if (filterType === 'ALL') return true;
    return item.type === filterType;
  });

  const exportJSON = () => {
    if (!activeAccount) return;
    const blob = new Blob([JSON.stringify({ account: activeAccount, statement }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statement-${activeAccount.accountNumber}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Account Selector Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-400" />
              Account Statement & Audit Trail
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Review posted transactions and refused attempts with exact running balances.
            </p>
          </div>

          {/* Account Picker */}
          <div className="w-full sm:w-64">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Select Account</label>
            <select
              value={activeAccount?.id || ''}
              onChange={e => {
                const acc = accounts.find(a => a.id === e.target.value);
                if (acc) onSelectAccount(acc);
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
            >
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.accountNumber} — {acc.ownerName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selected Account Summary Bar */}
        {activeAccount && (
          <div className="bg-slate-950/60 border border-slate-800/90 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Available Balance</span>
              <span className={`text-2xl font-bold font-mono ${activeAccount.balance < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                ₹{activeAccount.balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="flex items-center gap-6 text-xs font-mono">
              <div>
                <span className="text-slate-500 block text-[10px]">Overdraft Limit</span>
                <span className="text-slate-300">₹{activeAccount.overdraftLimit.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Account Holder</span>
                <span className="text-white font-sans font-medium">{activeAccount.ownerName}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Total History</span>
                <span className="text-white font-bold">{statement.length} records</span>
              </div>
            </div>
          </div>
        )}

        {/* Filter Chips & Export */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl text-xs">
            <button
              onClick={() => setFilterType('ALL')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                filterType === 'ALL' ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Activity ({statement.length})
            </button>
            <button
              onClick={() => setFilterType('POSTED')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                filterType === 'POSTED' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Posted Only ({statement.filter(s => s.type === 'POSTED').length})
            </button>
            <button
              onClick={() => setFilterType('REFUSED')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                filterType === 'REFUSED' ? 'bg-rose-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Refused Attempts ({statement.filter(s => s.type === 'REFUSED').length})
            </button>
          </div>

          {statement.length > 0 && (
            <button
              onClick={exportJSON}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-slate-700"
            >
              <Download className="w-3.5 h-3.5" />
              Download JSON
            </button>
          )}
        </div>
      </div>

      {/* Statement Records or Empty State */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            Loading statement records...
          </div>
        ) : statement.length === 0 ? (
          /* Warm, user-friendly empty state for fresh accounts */
          <div className="p-10 sm:p-14 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-500 border border-slate-700">
              <Inbox className="w-7 h-7" />
            </div>
            <div className="max-w-md mx-auto space-y-1.5">
              <h3 className="text-base font-bold text-white">No Transaction History Yet</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                This is a fresh account with a clean starting balance of <strong>₹0.00</strong>. When you make a deposit or receive a transfer, your posted transactions and running balances will appear right here.
              </p>
            </div>
            {onNavigateToTransfer && (
              <div className="pt-2">
                <button
                  onClick={onNavigateToTransfer}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-bold shadow-md inline-flex items-center gap-1.5 transition-all"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  Make Your First Transfer or Deposit
                </button>
              </div>
            )}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-xs">
            No entries match the selected filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800/60 text-slate-400 font-medium uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="px-5 py-3">Date & Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Debit (-)</th>
                  <th className="px-4 py-3 text-right">Credit (+)</th>
                  <th className="px-4 py-3 text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-300">
                {filteredItems.map(item => {
                  const isPosted = item.type === 'POSTED';
                  const isDebit = item.direction === 'debit';
                  const isCredit = item.direction === 'credit';

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-800/30 transition-colors ${
                        !isPosted ? 'bg-rose-950/15' : ''
                      }`}
                    >
                      <td className="px-5 py-3 text-slate-400 font-mono whitespace-nowrap">
                        {new Date(item.timestamp).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        <span className="text-[10px] text-slate-500">
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        {isPosted ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" /> Posted
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <AlertOctagon className="w-3 h-3" /> Refused
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-semibold text-white capitalize">
                          {item.operationType}
                          {item.counterpartyAccountNumber && (
                            <span className="text-[10px] text-slate-400 font-mono ml-1.5 font-normal">
                              ({item.counterpartyAccountNumber})
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400">{item.description}</div>
                        {item.refusalReason && (
                          <div className="text-[10px] text-rose-400 font-mono mt-0.5 font-semibold">
                            Refusal: {item.refusalReason}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right font-mono font-bold text-rose-400 whitespace-nowrap">
                        {isPosted && isDebit ? `₹${item.amount.toFixed(2)}` : '—'}
                      </td>

                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                        {isPosted && isCredit ? `₹${item.amount.toFixed(2)}` : '—'}
                      </td>

                      <td className="px-4 py-3 text-right font-mono font-bold text-white whitespace-nowrap">
                        ₹{item.runningBalance.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
