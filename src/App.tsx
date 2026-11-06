import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.js';
import { AccountList } from './components/AccountList.js';
import { TransactionForm } from './components/TransactionForm.js';
import { StatementView } from './components/StatementView.js';
import { AuditDevHub } from './components/AuditDevHub.js';
import { CreateUserModal } from './components/CreateUserModal.js';
import { AuthPortal } from './components/AuthPortal.js';
import type { User, Account, InvariantReport, OperationType } from './types.js';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('ledgerline_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [authToken, setAuthToken] = useState<string | null>(() => {
    return localStorage.getItem('ledgerline_token') || null;
  });

  const [users, setUsers] = useState<User[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [invariant, setInvariant] = useState<InvariantReport | null>(null);
  const [activeTab, setActiveTab] = useState<string>('accounts');
  const [selectedAccountForStatement, setSelectedAccountForStatement] = useState<Account | null>(null);
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);

  // Quick action state passed to TransactionForm
  const [formInitialType, setFormInitialType] = useState<OperationType>('transfer');
  const [formInitialSource, setFormInitialSource] = useState<Account | null>(null);

  // Verify and refresh session if token exists
  useEffect(() => {
    if (authToken) {
      fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })
        .then(res => (res.ok ? res.json() : Promise.reject()))
        .then(data => {
          if (data.user) {
            setCurrentUser(data.user);
            localStorage.setItem('ledgerline_user', JSON.stringify(data.user));
          }
        })
        .catch(() => {
          // Token expired or invalid
          setAuthToken(null);
          setCurrentUser(null);
          localStorage.removeItem('ledgerline_token');
          localStorage.removeItem('ledgerline_user');
        });
    }
  }, [authToken]);

  // Fetch Users & Current Persona list
  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.availableUsers || []);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  // Fetch Accounts for the current user
  const fetchAccounts = async (userToFetch?: User | null) => {
    const user = userToFetch || currentUser;
    if (!user) return;

    try {
      const headers: Record<string, string> = {
        'X-User-Id': user.id,
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch('/api/accounts', { headers });
      if (res.ok) {
        const data = await res.json();
        setAccounts(data || []);
      }
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  };

  // Fetch Invariant Report
  const fetchInvariant = async () => {
    try {
      const res = await fetch('/api/audit/invariant');
      if (res.ok) {
        const data = await res.json();
        setInvariant(data);
      }
    } catch (err) {
      console.error('Failed to load invariant:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchInvariant();
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchAccounts(currentUser);
    } else {
      setAccounts([]);
    }
  }, [currentUser]);

  const handleAuthSuccess = (user: User, token: string) => {
    setCurrentUser(user);
    setAuthToken(token);
    localStorage.setItem('ledgerline_user', JSON.stringify(user));
    localStorage.setItem('ledgerline_token', token);
    fetchAccounts(user);
    fetchUsers();
    fetchInvariant();
    setActiveTab('accounts');
  };

  const handleLogout = async () => {
    if (authToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch {}
    }
    setCurrentUser(null);
    setAuthToken(null);
    localStorage.removeItem('ledgerline_token');
    localStorage.removeItem('ledgerline_user');
    setAccounts([]);
  };

  const handleSelectUser = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem('ledgerline_user', JSON.stringify(user));
    fetchAccounts(user);
    fetchInvariant();
  };

  const handleRefreshAll = () => {
    fetchAccounts();
    fetchInvariant();
  };

  const handleSelectAccountForStatement = (account: Account) => {
    setSelectedAccountForStatement(account);
    setActiveTab('statement');
  };

  const handleInitiateTransfer = (sourceAccount: Account) => {
    setFormInitialType('transfer');
    setFormInitialSource(sourceAccount);
    setActiveTab('transfer');
  };

  const handleInitiateCash = (account: Account, type: 'deposit' | 'withdrawal') => {
    setFormInitialType(type);
    setFormInitialSource(account);
    setActiveTab('transfer');
  };

  const handleCreateAccount = async (data: {
    accountNumber: string;
    ownerId: string;
    overdraftLimit: number;
    initialDeposit: number;
  }) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-User-Id': currentUser?.id || 'usr-admin-1',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create account');
    }

    handleRefreshAll();
  };

  const handleUserCreated = (newUser: User) => {
    setUsers(prev => [...prev, newUser]);
    handleSelectUser(newUser);
  };

  // If not authenticated, display proper Sign In & Sign Up Portal
  if (!currentUser) {
    return <AuthPortal onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      {/* Navigation Header */}
      <Header
        currentUser={currentUser}
        users={users}
        onSelectUser={handleSelectUser}
        invariant={invariant}
        onRefreshInvariant={fetchInvariant}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenNewUserModal={() => setIsNewUserModalOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main View Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {activeTab === 'accounts' && (
          <AccountList
            accounts={accounts}
            currentUser={currentUser}
            invariant={invariant}
            onSelectAccountForStatement={handleSelectAccountForStatement}
            onInitiateTransfer={handleInitiateTransfer}
            onInitiateCash={handleInitiateCash}
            onCreateAccount={handleCreateAccount}
            users={users}
            onOpenNewUserModal={() => setIsNewUserModalOpen(true)}
          />
        )}

        {activeTab === 'transfer' && (
          <TransactionForm
            accounts={accounts}
            currentUser={currentUser}
            initialType={formInitialType}
            initialSourceAccount={formInitialSource}
            onSuccess={handleRefreshAll}
          />
        )}

        {activeTab === 'statement' && (
          <StatementView
            accounts={accounts}
            selectedAccount={selectedAccountForStatement}
            onSelectAccount={setSelectedAccountForStatement}
            currentUser={currentUser}
            onNavigateToTransfer={() => setActiveTab('transfer')}
          />
        )}

        {activeTab === 'audit_dev' && (
          <AuditDevHub
            accounts={accounts}
            currentUser={currentUser}
            invariant={invariant}
            onRefreshData={handleRefreshAll}
          />
        )}
      </main>

      {/* Register Fresh Customer Modal */}
      <CreateUserModal
        isOpen={isNewUserModalOpen}
        onClose={() => setIsNewUserModalOpen(false)}
        onUserCreated={handleUserCreated}
      />

      {/* Clean Footer */}
      <footer className="bg-slate-900/60 border-t border-slate-800/80 py-4 text-center text-xs text-slate-500">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-400">LedgerLine Core</span>
            <span>•</span>
            <span>Authenticated Session: <strong className="text-slate-300 font-mono">{currentUser.email}</strong></span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveTab('audit_dev')}
              className="hover:text-emerald-400 transition-colors"
            >
              Evaluation & Audit Lab ↗
            </button>
            <button
              onClick={handleLogout}
              className="text-rose-400 hover:text-rose-300 transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
