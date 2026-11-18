import React, { useEffect, useState } from 'react';
import { Settings, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { PageTransition } from '../components/PageTransition';
import { SeoHead } from '../components/SeoHead';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { AccountStatus, UserRole } from '../server/rbac';

interface ManagedUser {
  uid: string;
  fullName: string;
  username: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
}

export function SuperAdminDashboardPage() {
  const { userProfile, getIdToken, serverAdminConfigured } = useAuth();
  const { showToast } = useApp();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [siteName, setSiteName] = useState('ImageLab');
  const [allowRegistrations, setAllowRegistrations] = useState(true);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  useEffect(() => {
    if (!db || !userProfile || userProfile.role !== 'super_admin') return;

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        setUsers(
          snap.docs.map((d) => ({
            uid: d.id,
            ...(d.data() as Omit<ManagedUser, 'uid'>),
          }))
        );
      },
      (err) => {
        if (!auth?.currentUser) return;
        handleFirestoreError(err, OperationType.LIST, 'users');
      }
    );

    getDoc(doc(db, 'siteSettings', 'global'))
      .then((snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setSiteName(d.siteName || 'ImageLab');
          setAllowRegistrations(Boolean(d.allowRegistrations ?? true));
          setMaintenanceMode(Boolean(d.maintenanceMode ?? false));
        }
      })
      .catch(() => {});

    return () => unsubUsers();
  }, [userProfile]);

  const handleRoleChange = async (target: ManagedUser, nextRole: 'admin' | 'contributor') => {
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/super-admin/users/${target.uid}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: nextRole }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload.error || 'Unable to change role on server', 'terracotta');
        return;
      }
      showToast(`Updated @${target.username} to ${nextRole}`, 'teal');
    } catch {
      showToast('Network error while updating role', 'terracotta');
    }
  };

  const handleDeleteUser = async (target: ManagedUser) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/super-admin/users/${target.uid}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload.error || 'Unable to remove user', 'terracotta');
        return;
      }
      showToast(`Removed user @${target.username}`, 'deep');
    } catch {
      showToast('Network error while removing user', 'terracotta');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await setDoc(doc(db, 'siteSettings', 'global'), {
        siteName: siteName.trim() || 'ImageLab',
        allowRegistrations,
        requirePromptModeration: false,
        maintenanceMode,
        updatedAt: serverTimestamp(),
      });
      showToast('Website settings updated', 'teal');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'siteSettings/global');
    }
  };

  return (
    <PageTransition>
      <SeoHead
        title="Super Admin Console — ImageLab"
        description="System-wide administration console for ImageLab."
        canonicalPath="/super-admin"
        noindex
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16 space-y-8">
        <div>
          <BackButton fallbackTo="/admin" label="Back" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#E76F51] mb-1.5">
              Super Administrator
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight text-[#264653]">
              Super Admin Control Center
            </h1>
            <p className="text-sm text-[#264653]/75 mt-1">
              Manage Admin roles, oversee all user accounts, and configure global website settings.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Link
              to="/admin/ads"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-xs font-semibold transition-colors"
            >
              <span>Ads Manager</span>
            </Link>
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-xs font-semibold transition-colors"
            >
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              <span>Admin Dashboard</span>
            </Link>
          </div>
        </div>

        {serverAdminConfigured === false && (
          <div className="rounded-2xl bg-[#FAF7F2] border border-[#E76F51]/40 p-5 text-xs text-[#264653] leading-relaxed">
            <strong>Server-Side Admin Credentials Missing:</strong> Set{' '}
            <code className="font-mono">FIREBASE_SERVICE_ACCOUNT_JSON</code> in the server environment to enable Firebase Admin SDK role assignments and account removal endpoints.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Role & User Management */}
          <section className="lg:col-span-8 rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden">
            <div className="p-6 border-b border-[#264653]/10 flex items-center gap-2.5">
              <UserCog className="w-5 h-5 text-[#E76F51]" aria-hidden="true" />
              <h2 className="text-base font-bold text-[#264653]">
                User & Admin Role Management ({users.length})
              </h2>
            </div>

            <div className="divide-y divide-[#264653]/10">
              {users.map((u) => (
                <div
                  key={u.uid}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <p className="text-sm font-bold text-[#264653]">
                      {u.fullName}{' '}
                      <span className="font-mono font-normal text-xs text-[#264653]/65">
                        @{u.username}
                      </span>
                    </p>
                    <p className="text-xs text-[#264653]/70">
                      {u.email} · Role: <strong>{u.role}</strong> · {u.accountStatus}
                    </p>
                  </div>

                  {u.role === 'super_admin' ? (
                    <span className="text-xs font-semibold text-[#E76F51]">
                      Primary Super Admin
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {u.role === 'contributor' ? (
                        <button
                          type="button"
                          onClick={() => handleRoleChange(u, 'admin')}
                          className="px-3.5 py-2 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-xs font-semibold transition-colors"
                        >
                          Promote to Admin
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRoleChange(u, 'contributor')}
                          className="px-3.5 py-2 rounded-xl bg-[#264653] hover:bg-[#355C6B] text-white text-xs font-semibold transition-colors"
                        >
                          Remove Admin Role
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-[#E76F51]/12 text-[#D05A3C] hover:bg-[#E76F51] hover:text-white text-xs font-semibold transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Website Settings */}
          <form
            onSubmit={handleSaveSettings}
            className="lg:col-span-4 rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-6 space-y-5"
          >
            <div className="flex items-center gap-2.5">
              <Settings className="w-5 h-5 text-[#2A9D8F]" aria-hidden="true" />
              <h2 className="text-base font-bold text-[#264653]">Website Settings</h2>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#264653] mb-1.5">
                Platform Name
              </label>
              <input
                type="text"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-sm"
              />
            </div>

            <label className="flex items-center justify-between gap-3 text-sm text-[#264653]">
              <span>Allow New Registrations</span>
              <input
                type="checkbox"
                checked={allowRegistrations}
                onChange={(e) => setAllowRegistrations(e.target.checked)}
                className="w-4 h-4 accent-[#2A9D8F]"
              />
            </label>

            <label className="flex items-center justify-between gap-3 text-sm text-[#264653]">
              <span>Maintenance Mode</span>
              <input
                type="checkbox"
                checked={maintenanceMode}
                onChange={(e) => setMaintenanceMode(e.target.checked)}
                className="w-4 h-4 accent-[#E76F51]"
              />
            </label>

            <button
              type="submit"
              className="w-full h-11 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors"
            >
              Save Site Settings
            </button>
          </form>
        </div>
      </div>
    </PageTransition>
  );
}
