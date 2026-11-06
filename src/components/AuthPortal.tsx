import React, { useState } from 'react';
import { ShieldCheck, Lock, Mail, User, Key, ArrowRight, Sparkles, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import type { User as UserType } from '../types.js';

interface AuthPortalProps {
  onAuthSuccess: (user: UserType, token: string) => void;
}

export const AuthPortal: React.FC<AuthPortalProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<'account_holder' | 'administrator' | 'auditor'>('account_holder');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (mode === 'signup') {
      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match. Please verify.');
        return;
      }
      if (password.length < 6) {
        setErrorMsg('Password must be at least 6 characters.');
        return;
      }
    }

    setIsLoading(true);

    try {
      const endpoint = mode === 'signup' ? '/api/auth/register' : '/api/auth/login';
      const payload = mode === 'signup'
        ? { name: name.trim(), email: email.trim(), password, role }
        : { email: email.trim(), password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      onAuthSuccess(data.user, data.token);
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemoLogin = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('password123');
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: demoEmail, password: 'password123' }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Demo sign-in failed');
      }

      onAuthSuccess(data.user, data.token);
    } catch (err: any) {
      setErrorMsg(err.message || 'Demo sign in failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 sm:px-6 py-12 selection:bg-emerald-500 selection:text-white">
      {/* Brand Header */}
      <div className="text-center max-w-md w-full mb-8 space-y-2">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400 shadow-lg shadow-emerald-500/10">
          <ShieldCheck className="w-7 h-7" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          LedgerLine Banking
        </h1>
        <p className="text-xs text-slate-400">
          Atomic Double-Entry Core • Cryptographically Chained Ledger
        </p>
      </div>

      {/* Main Authentication Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-6">
        {/* Sign In vs Sign Up Tabs */}
        <div className="bg-slate-950/80 p-1 rounded-2xl flex items-center gap-1 border border-slate-800">
          <button
            type="button"
            onClick={() => { setMode('login'); setErrorMsg(null); }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              mode === 'login'
                ? 'bg-emerald-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setErrorMsg(null); }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              mode === 'signup'
                ? 'bg-emerald-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Create New Account
          </button>
        </div>

        {errorMsg && (
          <div className="p-3.5 bg-rose-950/50 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {mode === 'signup' && (
          <div className="bg-emerald-950/30 border border-emerald-500/20 p-3.5 rounded-2xl text-xs text-slate-300 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <p>
              <strong>Zero Starting Balance:</strong> Your account will be provisioned starting strictly with a <strong>₹0.00 balance</strong> and no transaction history.
            </p>
          </div>
        )}

        {/* Authentication Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {mode === 'signup' && (
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Full Name</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-800/90 border border-slate-700 rounded-xl pl-10 pr-10 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {mode === 'signup' && (
              <span className="text-[10px] text-slate-500 mt-1 block">Minimum 6 characters</span>
            )}
          </div>

          {mode === 'signup' && (
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Confirm Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Account Role</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value as any)}
                className="w-full bg-slate-800/90 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="account_holder">Account Holder (Individual Customer)</option>
                <option value="administrator">Administrator (Manage institution & accounts)</option>
                <option value="auditor">Auditor (Read-only inspection)</option>
              </select>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-sm shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {isLoading ? (
                <span>Authenticating...</span>
              ) : (
                <>
                  <span>{mode === 'login' ? 'Sign In to LedgerLine' : 'Complete Registration & Open Account'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Quick Demo Logins (Convenient for Judges) */}
        {mode === 'login' && (
          <div className="pt-4 border-t border-slate-800 space-y-2.5">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-center">
              Quick Demo Personas (1-Click Sign-In)
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleQuickDemoLogin('samira.new@ledgerline.internal')}
                className="p-2.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 rounded-xl text-left transition-colors"
              >
                <div className="font-semibold text-white flex items-center gap-1">
                  <span>Samira Khan</span>
                  <span className="text-[9px] bg-sky-500/20 text-sky-300 px-1 rounded font-mono">₹0 New</span>
                </div>
                <div className="text-[10px] text-slate-400">Fresh Zero Balance</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickDemoLogin('alice@ledgerline.internal')}
                className="p-2.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 rounded-xl text-left transition-colors"
              >
                <div className="font-semibold text-white">Alice Chen</div>
                <div className="text-[10px] text-slate-400">Account Holder</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickDemoLogin('clara.admin@ledgerline.internal')}
                className="p-2.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 rounded-xl text-left transition-colors"
              >
                <div className="font-semibold text-white">Clara Oswald</div>
                <div className="text-[10px] text-slate-400">Administrator</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickDemoLogin('dave.auditor@ledgerline.internal')}
                className="p-2.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 rounded-xl text-left transition-colors"
              >
                <div className="font-semibold text-white">Dave Thorne</div>
                <div className="text-[10px] text-slate-400">Auditor (Read-Only)</div>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 text-center pt-1 font-mono">
              Default password: password123
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
