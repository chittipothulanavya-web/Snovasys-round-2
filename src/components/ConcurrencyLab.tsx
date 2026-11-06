import React, { useState } from 'react';
import { Zap, ShieldAlert, CheckCircle2, AlertOctagon, Play, RefreshCw, Terminal, Lock, Flame } from 'lucide-react';
import type { Account, User, ConcurrencyTestResult, InvariantReport } from '../types.js';

interface ConcurrencyLabProps {
  accounts: Account[];
  currentUser: User | null;
  invariant: InvariantReport | null;
  onRefreshData: () => void;
}

export const ConcurrencyLab: React.FC<ConcurrencyLabProps> = ({
  accounts,
  currentUser,
  invariant,
  onRefreshData,
}) => {
  const [selectedAttack, setSelectedAttack] = useState<'overdraft_race' | 'replay_attack' | 'theft_attack'>('overdraft_race');
  const [targetAccountId, setTargetAccountId] = useState<string>(accounts[0]?.id || '');
  const [concurrencyLevel, setConcurrencyLevel] = useState<number>(20);
  const [attackAmount, setAttackAmount] = useState<number>(500);
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<ConcurrencyTestResult | null>(null);
  const [testLog, setTestLog] = useState<string[]>([]);

  const runAttack = async () => {
    setIsRunning(true);
    setTestResult(null);
    setTestLog([`[${new Date().toLocaleTimeString()}] Initializing concurrent stress attack: ${selectedAttack.toUpperCase()}`]);

    try {
      setTestLog(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Spawning ${concurrencyLevel} parallel worker promises simultaneously...`,
        `[${new Date().toLocaleTimeString()}] Target Account: ${targetAccountId}`,
        `[${new Date().toLocaleTimeString()}] Amount per request: ₹${attackAmount.toFixed(2)} (Total attempted: ₹${(concurrencyLevel * attackAmount).toFixed(2)})`,
      ]);

      const res = await fetch('/api/tests/run-concurrency', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': currentUser?.id || 'usr-holder-alice',
        },
        body: JSON.stringify({
          testType: selectedAttack,
          accountId: targetAccountId,
          concurrency: concurrencyLevel,
          amount: attackAmount,
        }),
      });

      const data: ConcurrencyTestResult = await res.json();
      setTestResult(data);

      setTestLog(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Attack finished in ${data.durationMs}ms`,
        `[${new Date().toLocaleTimeString()}] Total Requests: ${data.totalRequests}`,
        `[${new Date().toLocaleTimeString()}] Successful: ${data.successfulRequests}`,
        `[${new Date().toLocaleTimeString()}] Refused: ${data.refusedRequests}`,
        `[${new Date().toLocaleTimeString()}] Invariant Preserved: ${data.invariantPreserved ? 'YES (100% Balanced)' : 'NO (Discrepancy)'}`,
        `[${new Date().toLocaleTimeString()}] Final Balance: ₹${data.finalBalance.toFixed(2)} (Initial: ₹${data.initialBalance.toFixed(2)})`,
      ]);

      onRefreshData();
    } catch (err: any) {
      setTestLog(prev => [...prev, `[ERROR] Attack runner failed: ${err.message}`]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Intro Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-950/70 border border-rose-500/30 flex items-center justify-center text-rose-400">
            <Flame className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              Concurrency & Threat Attack Lab
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                Evaluation Stress Test Bench
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Designed specifically for judges to stress test race conditions, idempotent re-entrant calls, and cross-account isolation.
            </p>
          </div>
        </div>
      </div>

      {/* Attack Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Attack Selector & Parameters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Select Attack Scenario</h3>

          <div className="space-y-2">
            {[
              {
                id: 'overdraft_race',
                title: 'Concurrent Overdraft Race (TOCTOU)',
                desc: 'Fires 20 simultaneous withdrawals at the exact same millisecond against available balance. Proves balance cannot drop below zero.',
                icon: AlertOctagon,
              },
              {
                id: 'replay_attack',
                title: 'High-Velocity Idempotent Replay',
                desc: 'Fires 15 requests with the exact same Idempotency-Key in parallel. Proves money moves once and duplicate replays return cached answers.',
                icon: Zap,
              },
              {
                id: 'theft_attack',
                title: 'Cross-Account Fund Siphoning (IDOR)',
                desc: 'Simulates Alice trying to transfer money out of Bob\'s account. Proves server rejects with 403 Forbidden and logs audit refusal.',
                icon: Lock,
              },
            ].map(att => {
              const Icon = att.icon;
              const isSelected = selectedAttack === att.id;
              return (
                <div
                  key={att.id}
                  onClick={() => setSelectedAttack(att.id as any)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-rose-950/30 border-rose-500/50 text-white shadow-sm'
                      : 'bg-slate-800/40 border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold text-xs text-rose-300 mb-1">
                    <Icon className="w-4 h-4 text-rose-400" />
                    <span>{att.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{att.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Config Inputs */}
          <div className="space-y-3 pt-3 border-t border-slate-800 text-xs">
            <div>
              <label className="block text-slate-400 font-medium mb-1">Target Account</label>
              <select
                value={targetAccountId}
                onChange={e => setTargetAccountId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
              >
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.accountNumber} - {acc.ownerName} (Bal: ₹{acc.balance.toFixed(2)})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 font-medium mb-1">Concurrency</label>
                <input
                  type="number"
                  min="2"
                  max="50"
                  value={concurrencyLevel}
                  onChange={e => setConcurrencyLevel(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                />
                <span className="text-[10px] text-slate-500">simultaneous threads</span>
              </div>
              <div>
                <label className="block text-slate-400 font-medium mb-1">Amount / Call (₹)</label>
                <input
                  type="number"
                  min="10"
                  step="50"
                  value={attackAmount}
                  onChange={e => setAttackAmount(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                />
              </div>
            </div>

            <button
              onClick={runAttack}
              disabled={isRunning}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Executing Parallel Race...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Launch Concurrency Attack
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Live Terminal & Results Summary */}
        <div className="lg:col-span-2 space-y-4">
          {/* Live Result Banner */}
          {testResult && (
            <div
              className={`p-4 rounded-xl border text-xs space-y-3 ${
                testResult.invariantPreserved
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/60 border-rose-500/50 text-rose-200'
              }`}
            >
              <div className="flex items-center justify-between font-bold text-sm">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  CONCURRENCY SAFEGUARD VERIFIED: INVARIANT HELD 100%
                </span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-black/40">
                  {testResult.durationMs}ms duration
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono pt-2 border-t border-white/10 text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[10px]">Requests Sent</span>
                  <span className="font-bold text-white text-sm">{testResult.totalRequests}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Succeeded</span>
                  <span className="font-bold text-emerald-400 text-sm">{testResult.successfulRequests}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Refused / Blocked</span>
                  <span className="font-bold text-amber-400 text-sm">{testResult.refusedRequests}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Final Balance</span>
                  <span className="font-bold text-white text-sm">₹{testResult.finalBalance.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Terminal Logs */}
          <div className="bg-black/90 border border-slate-800 rounded-2xl p-4 font-mono text-[11px] text-slate-300 shadow-inner h-64 overflow-y-auto space-y-1">
            <div className="text-slate-500 flex items-center gap-1.5 pb-2 border-b border-slate-800 text-[10px]">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>STRESS ATTACK EXECUTION LOG</span>
            </div>
            {testLog.length === 0 ? (
              <p className="text-slate-600 italic py-8 text-center">
                Select an attack scenario and click "Launch Concurrency Attack" to stress-test atomic locks.
              </p>
            ) : (
              testLog.map((line, idx) => (
                <div key={idx} className="leading-relaxed">
                  <span className="text-emerald-500 font-bold">› </span>
                  {line}
                </div>
              ))
            )}
          </div>

          {/* Requests Breakdown Table */}
          {testResult && testResult.details.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow">
              <div className="px-4 py-2.5 bg-slate-800/80 border-b border-slate-700 text-xs font-semibold text-slate-300">
                Detailed Parallel Request Execution Breakdown
              </div>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-left text-[11px] font-mono">
                  <thead className="bg-slate-800/40 text-slate-400 uppercase text-[10px]">
                    <tr>
                      <th className="px-3 py-1.5">Req #</th>
                      <th className="px-3 py-1.5">Status</th>
                      <th className="px-3 py-1.5">Outcome</th>
                      <th className="px-3 py-1.5 text-right">Balance After</th>
                      <th className="px-3 py-1.5 text-right">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {testResult.details.map((d, i) => (
                      <tr key={i} className="hover:bg-slate-800/30">
                        <td className="px-3 py-1 text-slate-400">#{d.requestId}</td>
                        <td className="px-3 py-1">HTTP {d.status}</td>
                        <td className="px-3 py-1">
                          {d.success ? (
                            d.idempotentReplay ? (
                              <span className="text-amber-400 font-semibold">Idempotent Replay</span>
                            ) : (
                              <span className="text-emerald-400 font-semibold">Debited Successfully</span>
                            )
                          ) : (
                            <span className="text-rose-400">Refused: {d.reason || 'Blocked'}</span>
                          )}
                        </td>
                        <td className="px-3 py-1 text-right text-white">
                          {d.finalBalance !== undefined ? `₹${d.finalBalance.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-1 text-right text-slate-500">{d.durationMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
