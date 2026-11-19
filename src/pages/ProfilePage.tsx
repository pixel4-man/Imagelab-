import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Edit3,
  LayoutDashboard,
  LogOut,
  MapPin,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { EmptyState } from '../components/FeedbackStates';
import { PageTransition } from '../components/PageTransition';
import { PromptCard } from '../components/PromptCard';
import { SafeImage } from '../components/SafeImage';
import { SeoHead } from '../components/SeoHead';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { getDashboardPathForRole } from '../server/rbac';
import { PromptItem } from '../types/prompt';

export function ProfilePage() {
  const { username } = useParams<{ username?: string }>();
  const { prompts, getCreator, showToast } = useApp();
  const { userProfile, firebaseUser, updateOwnProfile, deleteOwnAccount, logout } =
    useAuth();
  const navigate = useNavigate();

  const isViewingOwnPrivateProfile = !username;
  const publicCreator = username ? getCreator(username) : null;

  const displayNameValue = isViewingOwnPrivateProfile
    ? userProfile?.fullName || ''
    : publicCreator?.displayName || '';
  const usernameValue = isViewingOwnPrivateProfile
    ? userProfile?.username || ''
    : publicCreator?.username || '';
  const bioValue = isViewingOwnPrivateProfile
    ? userProfile?.bio || 'Creative prompt explorer on ImageLab.'
    : publicCreator?.bio || '';
  const avatarValue = isViewingOwnPrivateProfile
    ? userProfile?.photoURL || ''
    : publicCreator?.avatarUrl || '';
  const roleLabel = isViewingOwnPrivateProfile
    ? userProfile?.role === 'super_admin'
      ? 'Super Admin'
      : userProfile?.role === 'admin'
        ? 'Admin'
        : 'Contributor'
    : publicCreator?.role || 'Contributor';

  const [ownFirestorePrompts, setOwnFirestorePrompts] = useState<PromptItem[]>([]);

  useEffect(() => {
    if (!isViewingOwnPrivateProfile || !db || !firebaseUser) {
      setOwnFirestorePrompts([]);
      return;
    }

    const q = query(
      collection(db, 'prompts'),
      where('authorUid', '==', firebaseUser.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PromptItem[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          const aspect = (['16:9', '4:3', '3:4', '1:1'].includes(d.aspectRatio)
            ? d.aspectRatio
            : '4:3') as PromptItem['aspectRatio'];
          return {
            id: docSnap.id,
            title: String(d.title || 'Untitled Artwork'),
            imageUrl: String(
              d.imageUrl || '/src/assets/images/art_digital_dreamscape_1794836302512.jpg'
            ),
            aspectRatio: aspect,
            creatorUsername: String(d.authorUsername || usernameValue || 'contributor'),
            authorUid: typeof d.authorUid === 'string' ? d.authorUid : undefined,
            authorType: d.authorType === 'official' ? 'official' : 'contributor',
            authorLabel: typeof d.authorLabel === 'string' ? d.authorLabel : undefined,
            status: (d.status as PromptItem['status']) || 'approved',
            likes: typeof d.likes === 'number' ? d.likes : 1,
            copies: typeof d.copies === 'number' ? d.copies : 0,
            views: typeof d.views === 'number' ? d.views : 1,
            createdAt: new Date().toISOString().slice(0, 10),
            trendingCollections: ['recent'],
          };
        });
        setOwnFirestorePrompts(list);
      },
      () => {
        // Fallback silently to context prompts
      }
    );
    return () => unsub();
  }, [isViewingOwnPrivateProfile, firebaseUser, usernameValue]);

  const publishedPrompts = useMemo(() => {
    const merged = new Map<string, PromptItem>();
    for (const p of ownFirestorePrompts) {
      merged.set(p.id, p);
    }
    for (const p of prompts) {
      if (
        p.creatorUsername === usernameValue ||
        (isViewingOwnPrivateProfile && firebaseUser && p.authorUid === firebaseUser.uid)
      ) {
        if (!merged.has(p.id)) {
          merged.set(p.id, p);
        }
      }
    }
    return Array.from(merged.values());
  }, [ownFirestorePrompts, prompts, usernameValue, isViewingOwnPrivateProfile, firebaseUser]);

  const totalLikes = useMemo(
    () => publishedPrompts.reduce((sum, p) => sum + p.likes, 0),
    [publishedPrompts]
  );

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editHandle, setEditHandle] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const usesPasswordProvider = Boolean(
    firebaseUser?.providerData.some((p) => p.providerId === 'password')
  );

  const openEditModal = () => {
    if (!userProfile) return;
    setEditName(userProfile.fullName);
    setEditHandle(userProfile.username);
    setEditBio(userProfile.bio);
    setEditError(null);
    setEditModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    if (!editName.trim() || editName.trim().length < 2) {
      setEditError('Display name must be at least 2 characters.');
      return;
    }

    setSavingEdit(true);
    try {
      await updateOwnProfile({
        fullName: editName.trim(),
        username: editHandle.trim(),
        bio: editBio.trim(),
      });
      setEditModalOpen(false);
      showToast('Profile updated', 'teal');
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Unable to save profile updates.'
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteError(null);
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm permanent account removal.');
      return;
    }
    if (usesPasswordProvider && !deletePassword) {
      setDeleteError('Please enter your current password to verify account deletion.');
      return;
    }

    setDeleting(true);
    try {
      await deleteOwnAccount(deletePassword || undefined);
      setDeleteModalOpen(false);
      showToast('Your account has been permanently deleted.', 'deep');
      navigate('/');
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Unable to delete your account.'
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <PageTransition>
      <SeoHead
        title={
          isViewingOwnPrivateProfile
            ? 'Your Creator Profile — ImageLab'
            : `${displayNameValue || usernameValue} (@${usernameValue}) — ImageLab Creator`
        }
        description={
          isViewingOwnPrivateProfile
            ? 'Manage your private ImageLab creator profile.'
            : `Browse AI artworks and visual prompt studies published by @${usernameValue} on ImageLab.`
        }
        canonicalPath={
          isViewingOwnPrivateProfile
            ? '/profile'
            : `/creator/${encodeURIComponent(usernameValue)}`
        }
        noindex={isViewingOwnPrivateProfile}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="mb-5">
          <BackButton fallbackTo="/" label="Back" />
        </div>
        {/* Profile Header Card */}
        <section className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-6 sm:p-10 mb-10 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-[#E8DEC8] border border-[#264653]/12 flex items-center justify-center shrink-0">
                {avatarValue ? (
                  <SafeImage
                    src={avatarValue}
                    alt={displayNameValue}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="font-display text-3xl font-bold text-[#264653]">
                    {(displayNameValue || 'U').charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              <div className="space-y-2 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#264653]/65">
                  <span className="font-semibold text-[#2A9D8F]">{roleLabel}</span>
                  {!isViewingOwnPrivateProfile && publicCreator?.location && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                        {publicCreator.location}
                      </span>
                    </>
                  )}
                  {isViewingOwnPrivateProfile && userProfile && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{userProfile.email}</span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-baseline gap-3">
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#264653]">
                    {displayNameValue}
                  </h1>
                  <span className="text-sm font-mono text-[#264653]/60">
                    @{usernameValue}
                  </span>
                </div>

                <p className="text-sm text-[#264653]/80 leading-relaxed">
                  {bioValue || 'No bio added yet.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0 self-start md:self-center">
              {isViewingOwnPrivateProfile && userProfile && (
                <>
                  <Link
                    to={getDashboardPathForRole(userProfile.role)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#264653] hover:bg-[#355C6B] text-white text-sm font-semibold transition-colors min-h-[44px]"
                  >
                    <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
                    <span>Dashboard</span>
                  </Link>
                  <button
                    type="button"
                    onClick={openEditModal}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#264653]/20 hover:border-[#264653] text-sm font-semibold text-[#264653] transition-colors min-h-[44px]"
                  >
                    <Edit3 className="w-4 h-4" aria-hidden="true" />
                    <span>Edit Profile</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F4EDE4] hover:bg-[#E8DEC8] text-sm font-semibold text-[#264653] transition-colors min-h-[44px]"
                  >
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                    <span>Logout</span>
                  </button>
                </>
              )}
              <Link
                to="/publish"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors min-h-[44px]"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Publish Prompt</span>
              </Link>
            </div>
          </div>

          {/* Stats Strip */}
          <div className="mt-8 pt-6 border-t border-[#264653]/10 grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div>
              <p className="text-2xl font-extrabold font-display text-[#264653] tabular-nums">
                {publishedPrompts.length}
              </p>
              <p className="text-xs text-[#264653]/65 mt-0.5">Published Prompts</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold font-display text-[#264653] tabular-nums">
                {totalLikes.toLocaleString()}
              </p>
              <p className="text-xs text-[#264653]/65 mt-0.5">Total Likes</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold font-display text-[#264653] tabular-nums">
                {publicCreator ? publicCreator.followers.toLocaleString() : '0'}
              </p>
              <p className="text-xs text-[#264653]/65 mt-0.5">Followers</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold font-display text-[#264653] tabular-nums">
                {publicCreator ? publicCreator.following.toLocaleString() : '0'}
              </p>
              <p className="text-xs text-[#264653]/65 mt-0.5">Following</p>
            </div>
          </div>

          {isViewingOwnPrivateProfile &&
            userProfile &&
            (userProfile.role === 'admin' || userProfile.role === 'super_admin') && (
              <div className="mt-6 pt-5 border-t border-[#264653]/10 space-y-2.5">
                <p className="text-[11px] font-bold tracking-wider uppercase text-[#E76F51]">
                  ADMINISTRATION
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Link
                    to="/admin"
                    className="px-3.5 py-2 rounded-xl bg-[#264653] hover:bg-[#355C6B] text-white text-xs font-semibold transition-colors"
                  >
                    Admin Dashboard
                  </Link>
                  <Link
                    to="/admin/ads"
                    className="px-3.5 py-2 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-xs font-semibold transition-colors"
                  >
                    Ads Manager
                  </Link>
                  <Link
                    to="/admin?tab=official"
                    className="px-3.5 py-2 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-xs font-semibold transition-colors"
                  >
                    Official Publishing
                  </Link>
                  {userProfile.role === 'super_admin' && (
                    <Link
                      to="/super-admin"
                      className="px-3.5 py-2 rounded-xl bg-[#F4EDE4] hover:bg-[#E8DEC8] text-[#264653] text-xs font-semibold transition-colors"
                    >
                      Super Admin Console
                    </Link>
                  )}
                </div>
              </div>
            )}

          {isViewingOwnPrivateProfile &&
            userProfile &&
            userProfile.role !== 'super_admin' && (
              <div className="mt-6 pt-5 border-t border-[#264653]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-[#264653]/65">
                  Need to permanently close your ImageLab account and remove your profile?
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteConfirmText('');
                    setDeletePassword('');
                    setDeleteError(null);
                    setDeleteModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D05A3C] hover:underline self-start sm:self-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Delete Account</span>
                </button>
              </div>
            )}
        </section>

        {/* Published Prompts Grid */}
        <section>
          <div className="flex items-center justify-between gap-4 mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-[#264653]">
              Published Prompts by @{usernameValue}
            </h2>
            <span className="text-xs font-mono tabular-nums text-[#264653]/60">
              {publishedPrompts.length}{' '}
              {publishedPrompts.length === 1 ? 'creation' : 'creations'}
            </span>
          </div>

          {publishedPrompts.length === 0 ? (
            <EmptyState
              icon={<Plus className="w-6 h-6" />}
              title="No published prompts yet"
              description="Share your first AI artwork and prompt study with the ImageLab community."
              actionLabel="Publish a Prompt"
              actionTo="/publish"
            />
          ) : (
            <div className="grid grid-cols-2 gap-3.5 sm:gap-5 lg:gap-6">
              {publishedPrompts.map((prompt) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Edit Profile Modal */}
      {editModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-profile-title"
          className="fixed inset-0 z-50 bg-[#264653]/55 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-3xl bg-[#FAF7F2] border border-[#264653]/15 shadow-2xl p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4 mb-6">
              <h2 id="edit-profile-title" className="text-xl font-bold text-[#264653]">
                Edit Profile
              </h2>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                aria-label="Close modal"
                className="p-2 rounded-xl text-[#264653]/70 hover:bg-[#F4EDE4]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editError && (
              <div className="mb-4 rounded-xl bg-[#E76F51]/10 border border-[#E76F51]/35 p-3 flex items-start gap-2 text-xs text-[#264653]">
                <AlertCircle className="w-4 h-4 text-[#D05A3C] shrink-0 mt-0.5" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/70 border border-[#264653]/15 text-sm text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={editHandle}
                  onChange={(e) => setEditHandle(e.target.value.toLowerCase())}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/70 border border-[#264653]/15 text-sm font-mono text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1.5">
                  Bio
                </label>
                <textarea
                  rows={3}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  className="w-full p-3.5 rounded-xl bg-[#F4EDE4]/70 border border-[#264653]/15 text-sm text-[#264653] focus:outline-none focus:border-[#2A9D8F] leading-relaxed"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {deleteModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          className="fixed inset-0 z-50 bg-[#264653]/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#FAF7F2] border border-[#E76F51]/30 shadow-2xl p-6 sm:p-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="delete-account-title" className="text-lg font-bold text-[#264653]">
                Delete Account
              </h2>
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                aria-label="Close modal"
                className="p-2 rounded-xl text-[#264653]/70 hover:bg-[#F4EDE4]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-[#264653]/80 leading-relaxed">
              This permanently removes your ImageLab profile and authentication credentials. This action cannot be undone.
            </p>

            {deleteError && (
              <div className="rounded-xl bg-[#E76F51]/10 border border-[#E76F51]/35 p-3 text-xs font-medium text-[#D05A3C]">
                {deleteError}
              </div>
            )}

            <form onSubmit={handleDeleteAccount} className="space-y-4">
              {usesPasswordProvider && (
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Confirm your password"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/70 border border-[#264653]/15 text-sm"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1.5">
                  Type <span className="font-mono text-[#D05A3C]">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/70 border border-[#264653]/15 text-sm font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deleting}
                  className="px-5 py-2.5 rounded-xl bg-[#D05A3C] hover:bg-[#b5482c] disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                >
                  {deleting ? 'Deleting...' : 'Permanently Delete'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageTransition>
  );
}
