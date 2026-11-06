import React, { useState, useEffect } from 'react';
import { Bot, AlertTriangle, ShieldCheck, CheckCircle2, XCircle, RefreshCw, UserCheck, MessageSquare } from 'lucide-react';
import type { AnomalyFlag, User } from '../types.js';

interface AnomalyReviewProps {
  currentUser: User | null;
}

export const AnomalyReview: React.FC<AnomalyReviewProps> = ({ currentUser }) => {
  const [flags, setFlags] = useState<AnomalyFlag[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedFlag, setSelectedFlag] = useState<AnomalyFlag | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchFlags = async () => {
    try {
      const res = await fetch('/api/anomalies');
      if (res.ok) {
        const data = await res.json();
        setFlags(data || []);
      }
    } catch (err) {
      console.error('Failed to load anomaly flags:', err);
    }
  };

  const runScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/anomalies/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': currentUser?.id || 'usr-admin-1',
        },
      });
      if (res.ok) {
        const data = await res.json();
        setFlags(data || []);
      }
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const submitReview = async (decision: 'acknowledged' | 'dismissed') => {
    if (!selectedFlag) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/anomalies/${selectedFlag.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': currentUser?.id || 'usr-admin-1',
        },
        body: JSON.stringify({
          decision,
          note: reviewNote.trim() || `Reviewed and ${decision} by ${currentUser?.name}`,
        }),
      });

      if (res.ok) {
        setSelectedFlag(null);
        setReviewNote('');
        await fetchFlags();
      }
    } catch (err) {
      console.error('Failed to submit review:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    fetchFlags();
  }, []);

  const canReview = currentUser?.role === 'administrator' || currentUser?.role === 'auditor';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Bot className="w-5 h-5 text-indigo-400" />
              AI Anomaly & Reconciliation Review Assistant
            </h2>
            <p className="text-xs text-slate-400">
              Pattern recognition & velocity anomaly suggestions powered by Gemini. AI never moves money on its own; a human auditor authorises every decision.
            </p>
          </div>

          {canReview && (
            <button
              onClick={runScan}
              disabled={isScanning}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              Run Ledger Anomaly Scan
            </button>
          )}
        </div>

        {/* Human-in-the-Loop Architecture Note */}
        <div className="bg-indigo-950/40 border border-indigo-500/30 p-3.5 rounded-xl text-indigo-200 text-xs flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-indigo-400 flex-shrink-0" />
          <p>
            <strong>Institutional Governance Policy:</strong> The model generates structured advisory flags only. An authorized officer (Administrator or Auditor) must inspect the observations and record their signed decision into the immutable audit trail.
          </p>
        </div>
      </div>

      {/* Flags List */}
      <div className="space-y-3">
        {flags.length === 0 ? (
          <div className="p-8 text-center text-slate-500 bg-slate-900 border border-slate-800 rounded-2xl text-xs">
            No anomalies currently detected. Click "Run Ledger Anomaly Scan" to evaluate recent velocity.
          </div>
        ) : (
          flags.map(flag => {
            const isPending = flag.status === 'pending_review';

            return (
              <div
                key={flag.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow space-y-3 text-xs"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        flag.severity === 'high'
                          ? 'bg-rose-950/60 text-rose-300 border border-rose-500/30'
                          : flag.severity === 'medium'
                          ? 'bg-amber-950/60 text-amber-300 border border-amber-500/30'
                          : 'bg-blue-950/60 text-blue-300 border border-blue-500/30'
                      }`}
                    >
                      {flag.severity} Priority
                    </span>
                    <span className="font-bold text-white text-sm">{flag.title}</span>
                  </div>

                  <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px]">
                    <span>Account: <strong className="text-slate-200">{flag.accountNumber}</strong></span>
                    <span>•</span>
                    <span>{new Date(flag.detectedAt).toLocaleTimeString()}</span>
                  </div>
                </div>

                <p className="text-slate-300 leading-relaxed">{flag.description}</p>

                <div className="bg-slate-950/60 border border-slate-800/80 p-2.5 rounded-lg text-slate-400">
                  <span className="font-semibold text-indigo-300 block mb-0.5">Suggested Action:</span>
                  <span>{flag.suggestedAction}</span>
                </div>

                {/* Review Status or Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Review Status:</span>
                    <span
                      className={`font-semibold uppercase text-[11px] ${
                        flag.status === 'acknowledged'
                          ? 'text-emerald-400'
                          : flag.status === 'dismissed'
                          ? 'text-slate-500'
                          : 'text-amber-400'
                      }`}
                    >
                      {flag.status.replace('_', ' ')}
                    </span>
                    {flag.humanReviewNote && (
                      <span className="text-slate-400 italic">
                        — "{flag.humanReviewNote}" (by {flag.reviewedByUserId})
                      </span>
                    )}
                  </div>

                  {isPending && canReview && (
                    <button
                      onClick={() => {
                        setSelectedFlag(flag);
                        setReviewNote('');
                      }}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 font-semibold"
                    >
                      Review & Authorise Verdict
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Review Modal */}
      {selectedFlag && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-400" />
                Human Auditor Review & Decision
              </h3>
              <button onClick={() => setSelectedFlag(null)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 block font-medium">Flag Title:</span>
              <span className="text-white font-semibold">{selectedFlag.title}</span>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Auditor Assessment Note (Logged into Audit Record)
              </label>
              <textarea
                rows={3}
                value={reviewNote}
                onChange={e => setReviewNote(e.target.value)}
                placeholder="Document your findings, justification, or operational steps taken..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-white text-xs"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => submitReview('dismissed')}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold flex items-center gap-1.5"
              >
                <XCircle className="w-4 h-4 text-slate-400" />
                Dismiss (False Positive)
              </button>
              <button
                type="button"
                onClick={() => submitReview('acknowledged')}
                disabled={isSubmitting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow"
              >
                <CheckCircle2 className="w-4 h-4" />
                Acknowledge & Sign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
