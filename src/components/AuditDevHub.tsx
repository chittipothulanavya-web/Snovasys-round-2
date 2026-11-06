import React, { useState } from 'react';
import { Zap, ShieldCheck, Bot, BookOpen, Activity } from 'lucide-react';
import { ConcurrencyLab } from './ConcurrencyLab.js';
import { CryptographicAudit } from './CryptographicAudit.js';
import { AnomalyReview } from './AnomalyReview.js';
import { DocViewer } from './DocViewer.js';
import type { Account, User, InvariantReport } from '../types.js';

interface AuditDevHubProps {
  accounts: Account[];
  currentUser: User | null;
  invariant: InvariantReport | null;
  onRefreshData: () => void;
}

export const AuditDevHub: React.FC<AuditDevHubProps> = ({
  accounts,
  currentUser,
  invariant,
  onRefreshData,
}) => {
  const [subTab, setSubTab] = useState<'concurrency' | 'crypto' | 'anomalies' | 'docs'>('concurrency');

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Dev Hub Sub-Navigation Bar */}
      <div className="bg-slate-900 border border-slate-800 p-1.5 rounded-2xl flex items-center justify-between gap-1 overflow-x-auto shadow-sm">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSubTab('concurrency')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              subTab === 'concurrency'
                ? 'bg-rose-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Zap className="w-4 h-4" />
            Concurrency Attack Lab
          </button>

          <button
            onClick={() => setSubTab('crypto')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              subTab === 'crypto'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Cryptographic Hash Chain
          </button>

          <button
            onClick={() => setSubTab('anomalies')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              subTab === 'anomalies'
                ? 'bg-indigo-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Bot className="w-4 h-4" />
            AI Anomaly Review
          </button>

          <button
            onClick={() => setSubTab('docs')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              subTab === 'docs'
                ? 'bg-teal-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            THREATS & PROMPTS
          </button>
        </div>

        {invariant && (
          <div className="hidden md:flex items-center gap-2 px-3 text-xs text-slate-400 font-mono">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>Invariant: {invariant.isConserved ? 'Conserved' : 'Breached'}</span>
          </div>
        )}
      </div>

      {/* Render Selected Tool */}
      <div>
        {subTab === 'concurrency' && (
          <ConcurrencyLab
            accounts={accounts}
            currentUser={currentUser}
            invariant={invariant}
            onRefreshData={onRefreshData}
          />
        )}

        {subTab === 'crypto' && (
          <CryptographicAudit currentUser={currentUser} />
        )}

        {subTab === 'anomalies' && (
          <AnomalyReview currentUser={currentUser} />
        )}

        {subTab === 'docs' && (
          <DocViewer />
        )}
      </div>
    </div>
  );
};
