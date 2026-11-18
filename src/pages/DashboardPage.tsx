import { useEffect, useState } from 'react';
import {
  Bookmark,
  Compass,
  LogOut,
  Plus,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { EmptyState } from '../components/FeedbackStates';
import { PageTransition } from '../components/PageTransition';
import { SafeImage } from '../components/SafeImage';
import { SeoHead } from '../components/SeoHead';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';

interface FirestorePromptDoc {
  id: string;
  title: string;
  imageUrl: string;
  status: string;
  authorUid: string;
  authorUsername: string;
}

export function DashboardPage() {
  const { userProfile, firebaseUser, getIdToken, logout, serverAdminConfigured } = useAuth();
  const { savedIds, refreshPublicPrompts, removePromptLocally, showToast } = useApp();
  const navigate = useNavigate();

  const [myPrompts, setMyPrompts] = useState<FirestorePromptDoc[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(true);

  useEffect(() => {
    if (!db || !firebaseUser) {
      setLoadingPrompts(false);
      return;
    }

    const q = query(
      collection(db, 'prompts'),
      where('authorUid', '==', firebaseUser.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<FirestorePromptDoc, 'id'>),
        }));
        setMyPrompts(list);
        setLoadingPrompts(false);
      },
      (err) => {
        setLoadingPrompts(false);
        if (!auth?.currentUser || auth.currentUser.uid !== firebaseUser.uid) {
          return;
        }
        handleFirestoreError(err, OperationType.LIST, 'prompts');
      }
    );

    return () => unsub();
  }, [firebaseUser]);

  const handleDeletePrompt = async (promptId: string) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/prompts/${encodeURIComponent(promptId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 503 && db) {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'prompts', promptId));
        batch.delete(doc(db, 'promptSecrets', promptId));
        await batch.commit();
      } else if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        showToast(payload.error || 'Could not delete prompt', 'terracotta');
        return;
      }
      removePromptLocally(promptId);
      await refreshPublicPrompts();
      showToast('Prompt permanently removed from your creations', 'deep');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `prompts/${promptId}`);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (!userProfile) return null;

  const roleLabel =
    userProfile.role === 'super_admin'
      ? 'Super Admin'
      : userProfile.role === 'admin'
        ? 'Admin'
        : 'Contributor';

  return (
    <PageTransition>
      <SeoHead
        title="Contributor Dashboard — ImageLab"
        description="Manage your private ImageLab creator dashboard."
        canonicalPath="/dashboard"
        noindex
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16 space-y-8">
        <div>
          <BackButton fallbackTo="/" label="Back" />
        </div>
        {/* Header Card */}
        <section className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-[#E8DEC8] border border-[#264653]/12 flex items-center justify-center shrink-0">
                {userProfile.photoURL ? (
                  <SafeImage
                    src={userProfile.photoURL}
                    alt={userProfile.fullName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="font-display text-2xl font-bold text-[#264653]">
                    {userProfile.fullName.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-[#2A9D8F] mb-1">
                  {roleLabel} · @{userProfile.username}
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#264653]">
                  Welcome, {userProfile.fullName}
                </h1>
                <p className="text-xs text-[#264653]/65 mt-1">
                  {userProfile.email}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {userProfile.role === 'super_admin' && (
                <Link
                  to="/super-admin"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#264653] hover:bg-[#355C6B] text-white text-xs font-semibold transition-colors min-h-[42px]"
                >
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                  <span>Super Admin Console</span>
                </Link>
              )}
              {(userProfile.role === 'admin' || userProfile.role === 'super_admin') && (
                <Link
                  to="/admin"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-xs font-semibold transition-colors min-h-[42px]"
                >
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                  <span>Admin Dashboard</span>
                </Link>
              )}
              <Link
                to="/publish"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-xs font-semibold transition-colors min-h-[42px]"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Publish Prompt</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F4EDE4] hover:bg-[#E8DEC8] text-[#264653] text-xs font-semibold transition-colors min-h-[42px]"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>

          {userProfile.email.toLowerCase() === 'adilwss67@gmail.com' &&
            userProfile.role !== 'super_admin' &&
            serverAdminConfigured === false && (
              <div className="mt-6 rounded-2xl bg-[#F4EDE4] border border-[#E76F51]/35 p-4 text-xs text-[#264653] leading-relaxed">
                <strong>Server configuration note:</strong> Configure{' '}
                <code className="font-mono">FIREBASE_SERVICE_ACCOUNT_JSON</code> on the server so the backend Admin SDK can complete your Super Admin role bootstrap securely.
              </div>
            )}
        </section>

        {/* Quick Navigation Strip */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <Link
            to="/profile"
            className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/10 p-5 hover:border-[#2A9D8F]/50 transition-colors flex items-center gap-4"
          >
            <div className="w-11 h-11 rounded-xl bg-[#F4EDE4] text-[#264653] flex items-center justify-center shrink-0">
              <User className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#264653]">Manage Profile</h2>
              <p className="text-xs text-[#264653]/70">Update bio, handle, or account settings</p>
            </div>
          </Link>

          <Link
            to="/saved"
            className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/10 p-5 hover:border-[#2A9D8F]/50 transition-colors flex items-center gap-4"
          >
            <div className="w-11 h-11 rounded-xl bg-[#F4EDE4] text-[#2A9D8F] flex items-center justify-center shrink-0">
              <Bookmark className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#264653] tabular-nums">
                Saved Prompts ({savedIds.length})
              </h2>
              <p className="text-xs text-[#264653]/70">View your bookmarked inspiration</p>
            </div>
          </Link>

          <Link
            to="/explore"
            className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/10 p-5 hover:border-[#E76F51]/50 transition-colors flex items-center gap-4"
          >
            <div className="w-11 h-11 rounded-xl bg-[#F4EDE4] text-[#E76F51] flex items-center justify-center shrink-0">
              <Compass className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#264653]">Explore Gallery</h2>
              <p className="text-xs text-[#264653]/70">Discover community AI artworks</p>
            </div>
          </Link>
        </section>

        {/* User's Published Prompts */}
        <section>
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-bold text-[#264653]">Your Published Prompts</h2>
              <p className="text-xs text-[#264653]/65 mt-0.5">
                Creations stored under your contributor account
              </p>
            </div>
            <Link
              to="/publish"
              className="text-xs font-semibold text-[#E76F51] hover:underline"
            >
              + New Prompt
            </Link>
          </div>

          {loadingPrompts ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-64 rounded-2xl bg-[#FAF7F2] border border-[#264653]/10 animate-pulse"
                />
              ))}
            </div>
          ) : myPrompts.length === 0 ? (
            <EmptyState
              icon={<Plus className="w-6 h-6" />}
              title="No prompts published yet"
              description="Publish your first AI creation with its complete generation prompt to build your portfolio."
              actionLabel="Publish a Prompt"
              actionTo="/publish"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {myPrompts.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/10 overflow-hidden flex flex-col shadow-xs"
                >
                  <Link to={`/prompt/${item.id}`} className="aspect-[4/3] bg-[#E8DEC8] overflow-hidden">
                    <SafeImage
                      src={item.imageUrl}
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                  </Link>
                  <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                    <div>
                      <p className="text-xs text-[#2A9D8F] font-medium mb-1">
                        @{item.authorUsername} · {item.status}
                      </p>
                      <h3 className="text-base font-bold text-[#264653] line-clamp-1">
                        {item.title}
                      </h3>
                      <p className="font-sans text-xs font-normal text-[#264653]/65 leading-relaxed mt-1.5">
                        Open details to view artwork stats or copy your full prompt.
                      </p>
                    </div>
                    <div className="pt-3 border-t border-[#264653]/10 flex items-center justify-between">
                      <Link
                        to={`/prompt/${item.id}`}
                        className="text-xs font-semibold text-[#264653] hover:text-[#E76F51]"
                      >
                        View Details →
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDeletePrompt(item.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#D05A3C] hover:underline"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </PageTransition>
  );
}
