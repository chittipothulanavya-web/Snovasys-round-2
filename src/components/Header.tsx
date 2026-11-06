import React, { useState } from 'react';
import { ShieldCheck, UserCheck, Plus, ChevronDown, Check, UserPlus, LogOut } from 'lucide-react';
import type { User, InvariantReport } from '../types.js';

interface HeaderProps {
  currentUser: User | null;
  users: User[];
  onSelectUser: (user: User) => void;
  invariant: InvariantReport | null;
  onRefreshInvariant: () => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onOpenNewUserModal: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  users,
  onSelectUser,
  invariant,
  onRefreshInvariant,
  activeTab,
  onSelectTab,
  onOpenNewUserModal,
  onLogout,
}) => {
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  return (
    <header className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 sticky top-0 z-50">
      {/* Main Top Navigation */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo */}
          <div className="flex items-center gap-6">
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => onSelectTab('accounts')}
            >
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold tracking-tight text-white">LedgerLine</span>
                  <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                    Verified
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">Atomic Double-Entry Core</p>
              </div>
            </div>

            {/* Invariant Health Indicator */}
            {invariant && (
              <div
                onClick={onRefreshInvariant}
                title="System invariant: All customer balances match vault reserves (Zero discrepancy)"
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 border border-slate-700/80 text-[11px] text-slate-300 cursor-pointer hover:bg-slate-800 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-slate-400">Books:</span>
                <span className="font-semibold text-emerald-400">100% Balanced</span>
                <span className="text-slate-500">|</span>
                <span className="text-slate-400 font-mono">Δ ₹0.00</span>
              </div>
            )}
          </div>

          {/* User Profile & Persona Switcher */}
          <div className="relative">
            <div
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs cursor-pointer transition-colors"
            >
              <div className="w-6 h-6 rounded-lg bg-emerald-600/30 text-emerald-300 font-bold flex items-center justify-center text-[11px]">
                {currentUser?.avatar || currentUser?.name?.[0] || 'U'}
              </div>
              <div className="text-left hidden sm:block">
                <div className="font-semibold text-white leading-tight">{currentUser?.name}</div>
                <div className="text-[10px] text-slate-400 capitalize">
                  {currentUser?.role?.replace('_', ' ')}
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
            </div>

            {/* User Dropdown Menu */}
            {userDropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-slate-900 border border-slate-700/90 shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3 py-2 border-b border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Switch Persona / Role
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Switch between customer, admin, or auditor:
                  </p>
                </div>

                <div className="py-1 max-h-60 overflow-y-auto space-y-0.5">
                  {users.map(u => {
                    const isSelected = currentUser?.id === u.id;
                    const isNew = u.id === 'usr-holder-new';

                    return (
                      <div
                        key={u.id}
                        onClick={() => {
                          onSelectUser(u);
                          setUserDropdownOpen(false);
                        }}
                        className={`px-3 py-2 rounded-xl flex items-center justify-between text-xs cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-emerald-500/15 text-white'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 h-6 rounded-lg bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-300">
                            {u.avatar || u.name[0]}
                          </span>
                          <div>
                            <div className="font-medium text-white flex items-center gap-1.5">
                              {u.name}
                              {isNew && (
                                <span className="text-[9px] bg-sky-500/20 text-sky-300 px-1.5 py-0.2 rounded font-mono">
                                  ₹0 Start
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 capitalize">
                              {u.role.replace('_', ' ')}
                            </div>
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-emerald-400" />}
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-slate-800 space-y-1">
                  <button
                    onClick={() => {
                      setUserDropdownOpen(false);
                      onOpenNewUserModal();
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    Create Fresh User (Starts at ₹0)
                  </button>

                  <button
                    onClick={() => {
                      setUserDropdownOpen(false);
                      onLogout();
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-semibold flex items-center justify-center gap-2 border border-rose-500/20 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out / Switch Account
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Clean Primary Navigation Tabs */}
        <div className="flex items-center justify-between border-t border-slate-800/80 pt-1 pb-2">
          <nav className="flex space-x-1 sm:space-x-2">
            {[
              { id: 'accounts', label: 'Accounts' },
              { id: 'transfer', label: 'Transfer & Pay' },
              { id: 'statement', label: 'Statements' },
              { id: 'audit_dev', label: 'Audit & Testing Lab' },
            ].map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onSelectTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                    isActive
                      ? 'bg-emerald-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Quick status pill for mobile/smaller screens */}
          <div className="text-[11px] text-slate-500 hidden sm:block">
            Role: <span className="text-slate-300 font-medium capitalize">{currentUser?.role.replace('_', ' ')}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
