import { GoogleGenAI, Type } from '@google/genai';
import { db } from './db.js';
import crypto from 'crypto';
import type { AnomalyFlag } from '../types.js';

let aiClient: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch (err) {
    console.warn('Gemini AI client initialization skipped:', err);
  }
}

export class AnomalyService {
  /**
   * Returns list of recorded anomaly flags
   */
  static listFlags(): AnomalyFlag[] {
    const rows = db.prepare(`
      SELECT f.*, a.account_number
      FROM anomaly_flags f
      JOIN accounts a ON f.account_id = a.id
      ORDER BY f.detected_at DESC
    `).all() as any[];

    return rows.map(r => ({
      id: r.id,
      accountId: r.account_id,
      accountNumber: r.account_number,
      severity: r.severity,
      title: r.title,
      description: r.description,
      suggestedAction: r.suggested_action,
      detectedAt: r.detected_at,
      status: r.status,
      humanReviewNote: r.human_review_note,
      reviewedByUserId: r.reviewed_by_user_id,
      reviewedAt: r.reviewed_at,
    }));
  }

  /**
   * Run anomaly scan across accounts and recent ledger entries.
   * Uses Gemini 3.8 Flash with structured schema when available, with
   * deterministic financial heuristics fallback.
   * AI NEVER moves money! Only generates suggested flags for human review.
   */
  static async scanForAnomalies(): Promise<AnomalyFlag[]> {
    const now = new Date().toISOString();

    // Fetch recent ledger activity and refusals
    const recentEntries = db.prepare(`
      SELECT le.*, a.account_number
      FROM ledger_entries le
      JOIN accounts a ON le.account_id = a.id
      ORDER BY le.sequence DESC
      LIMIT 25
    `).all() as any[];

    const recentRefusals = db.prepare(`
      SELECT ar.*, a.account_number
      FROM audit_refusals ar
      JOIN accounts a ON ar.account_id = a.id
      ORDER BY ar.timestamp DESC
      LIMIT 20
    `).all() as any[];

    const accounts = db.prepare(`SELECT * FROM accounts`).all() as any[];

    // 1. First, check heuristic deterministic flags
    const newFlags: Array<{
      accountId: string;
      severity: 'low' | 'medium' | 'high';
      title: string;
      description: string;
      suggestedAction: string;
    }> = [];

    // Check high refusal velocity
    const refusalCountsByAccount: Record<string, { count: number; number: string }> = {};
    for (const ref of recentRefusals) {
      if (!refusalCountsByAccount[ref.account_id]) {
        refusalCountsByAccount[ref.account_id] = { count: 0, number: ref.account_number };
      }
      refusalCountsByAccount[ref.account_id].count++;
    }

    for (const [accId, meta] of Object.entries(refusalCountsByAccount)) {
      if (meta.count >= 3) {
        newFlags.push({
          accountId: accId,
          severity: meta.count >= 5 ? 'high' : 'medium',
          title: `High Refusal Velocity Detected (${meta.count} rejections)`,
          description: `Account ${meta.number} incurred ${meta.count} refused attempts in recent activity. Potential automated script or concurrent brute-force attempt.`,
          suggestedAction: 'Auditor should inspect IP/client fingerprints and consider temporary operational hold if unauthorized.',
        });
      }
    }

    // Check overdraft utilization
    for (const acc of accounts) {
      if (acc.balance < 0) {
        newFlags.push({
          accountId: acc.id,
          severity: 'medium',
          title: `Authorized Overdraft Utilized (${acc.account_number})`,
          description: `Account balance is ₹${acc.balance.toFixed(2)} against limit of ₹${acc.overdraft_limit.toFixed(2)}.`,
          suggestedAction: 'Notify account holder of negative interest accrual and track incoming receivables.',
        });
      }
    }

    // 2. Query Gemini 3.8 Flash for deeper pattern recognition if available
    if (aiClient && process.env.GEMINI_API_KEY) {
      try {
        const prompt = `
          You are an institutional banking anomaly and reconciliation analyst reviewing double-entry ledger activity.
          Rules:
          - You NEVER authorise or move money.
          - Identify anomalies like rapid velocity, round number structuring, or suspicious counterparties.
          
          Accounts: ${JSON.stringify(accounts.map(a => ({ id: a.id, number: a.account_number, balance: a.balance })))}
          Recent Entries: ${JSON.stringify(recentEntries.map(e => ({ acc: e.account_number, dir: e.direction, amt: e.amount, desc: e.description })))}
          Recent Refusals: ${JSON.stringify(recentRefusals.map(r => ({ acc: r.account_number, amt: r.attempted_amount, reason: r.reason })))}
        `;

        const response = await aiClient.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            systemInstruction: 'You are LedgerLine Senior Audit AI. Return only structured JSON matching the schema.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  accountId: { type: Type.STRING },
                  severity: { type: Type.STRING },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  suggestedAction: { type: Type.STRING },
                },
                required: ['accountId', 'severity', 'title', 'description', 'suggestedAction'],
              },
            },
          },
        });

        if (response.text) {
          const aiSuggestions = JSON.parse(response.text.trim());
          if (Array.isArray(aiSuggestions)) {
            for (const s of aiSuggestions) {
              const matchedAcc = accounts.find(a => a.id === s.accountId || a.account_number === s.accountId);
              if (matchedAcc) {
                newFlags.push({
                  accountId: matchedAcc.id,
                  severity: (['low', 'medium', 'high'].includes(s.severity) ? s.severity : 'medium') as any,
                  title: s.title || 'AI Audit Observation',
                  description: s.description || 'Observed transaction pattern',
                  suggestedAction: s.suggestedAction || 'Review with account holder',
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn('Gemini anomaly analysis non-fatal fallback:', err);
      }
    }

    // Insert unique flags into anomaly_flags table
    const insertFlag = db.prepare(`
      INSERT INTO anomaly_flags (id, account_id, severity, title, description, suggested_action, detected_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_review')
    `);

    for (const flag of newFlags) {
      // Check if duplicate title exists in last 24h
      const existing = db.prepare(`
        SELECT id FROM anomaly_flags WHERE account_id = ? AND title = ? AND status = 'pending_review'
      `).get(flag.accountId, flag.title);

      if (!existing) {
        const id = `anom-${crypto.randomUUID().slice(0, 8)}`;
        insertFlag.run(id, flag.accountId, flag.severity, flag.title, flag.description, flag.suggestedAction, now);
      }
    }

    return this.listFlags();
  }

  /**
   * Human auditor/admin decision on an anomaly flag
   * Records decision in the audit log. Machine only suggests; human decides.
   */
  static reviewFlag(params: {
    flagId: string;
    decision: 'acknowledged' | 'dismissed';
    note: string;
    userId: string;
  }): AnomalyFlag | null {
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE anomaly_flags
      SET status = ?,
          human_review_note = ?,
          reviewed_by_user_id = ?,
          reviewed_at = ?
      WHERE id = ?
    `).run(params.decision, params.note, params.userId, now, params.flagId);

    const updated = db.prepare(`
      SELECT f.*, a.account_number
      FROM anomaly_flags f
      JOIN accounts a ON f.account_id = a.id
      WHERE f.id = ?
    `).get(params.flagId) as any;

    if (!updated) return null;

    return {
      id: updated.id,
      accountId: updated.account_id,
      accountNumber: updated.account_number,
      severity: updated.severity,
      title: updated.title,
      description: updated.description,
      suggestedAction: updated.suggested_action,
      detectedAt: updated.detected_at,
      status: updated.status,
      humanReviewNote: updated.human_review_note,
      reviewedByUserId: updated.reviewed_by_user_id,
      reviewedAt: updated.reviewed_at,
    };
  }
}
