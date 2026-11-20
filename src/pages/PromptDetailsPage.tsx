import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  Copy,
  Edit3,
  Expand,
  Eye,
  EyeOff,
  Heart,
  ImageOff,
  ImagePlus,
  Lock,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { BackButton } from '../components/BackButton';
import { EmptyState } from '../components/FeedbackStates';
import { PageTransition } from '../components/PageTransition';
import { PromptCard } from '../components/PromptCard';
import { SafeImage } from '../components/SafeImage';
import {
  SeoHead,
  resolveAbsoluteUrl,
  resolveCanonicalOrigin,
} from '../components/SeoHead';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { selectElementText } from '../lib/clipboard';
import { db } from '../lib/firebase';
import { resolvePersistableArtworkUrl } from '../lib/imageUpload';
import { PromptItem } from '../types/prompt';

function detectAspectRatio(width: number, height: number): '16:9' | '4:3' | '3:4' | '1:1' {
  if (!width || !height) return '4:3';
  const ratio = width / height;
  if (ratio >= 1.55) return '16:9';
  if (ratio >= 1.12) return '4:3';
  if (ratio <= 0.88) return '3:4';
  return '1:1';
}

export function PromptDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    prompts,
    likedIds,
    savedIds,
    copiedId,
    clipboardErrorId,
    unlockedPrompts,
    toggleLike,
    toggleSave,
    unlockPrompt,
    copyPrompt,
    refreshPublicPrompts,
    removePromptLocally,
    showToast,
    getCreator,
  } = useApp();
  const { firebaseUser, userProfile, getIdToken } = useAuth();

  const isVerifiedAdmin = Boolean(
    firebaseUser &&
      firebaseUser.emailVerified &&
      userProfile &&
      (userProfile.role === 'admin' || userProfile.role === 'super_admin') &&
      userProfile.accountStatus === 'active'
  );

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [fetchedPrompt, setFetchedPrompt] = useState<PromptItem | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [copyingPrompt, setCopyingPrompt] = useState(false);
  const [copySuccessBanner, setCopySuccessBanner] = useState(false);
  const manualCopyTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Admin & Owner management modals
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editPromptText, setEditPromptText] = useState('');
  const [loadingEditPrompt, setLoadingEditPrompt] = useState(false);
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editAspectRatio, setEditAspectRatio] = useState<'16:9' | '4:3' | '3:4' | '1:1'>('4:3');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);

  const [confirmUnpublishOpen, setConfirmUnpublishOpen] = useState(false);
  const [togglingPublish, setTogglingPublish] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingPrompt, setDeletingPrompt] = useState(false);

  const publicPrompt = prompts.find((item) => item.id === id);

  useEffect(() => {
    setCopySuccessBanner(false);
  }, [id, firebaseUser]);

  // Eagerly unlock the authorized prompt when a signed-in user opens the detail page so
  // clicking "Copy Full Prompt" writes to the clipboard synchronously inside the user gesture.
  useEffect(() => {
    if (!firebaseUser || !id) return;
    if (unlockedPrompts[id]) return;
    void unlockPrompt(id, { silent: true });
  }, [firebaseUser, id, unlockedPrompts, unlockPrompt]);

  useEffect(() => {
    let active = true;
    if (publicPrompt || !id) {
      if (publicPrompt) {
        setFetchedPrompt(null);
        setLoadingDetails(false);
      }
      return;
    }

    const loadSinglePrompt = async () => {
      setLoadingDetails(true);
      try {
        const res = await fetch(`/api/prompts/public/${encodeURIComponent(id)}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const payload = (await res.json()) as { prompt?: PromptItem };
          if (active && payload.prompt) {
            setFetchedPrompt(payload.prompt);
            setLoadingDetails(false);
            return;
          }
        }
      } catch {
        // Fallback below
      }

      if (firebaseUser) {
        try {
          const token = await getIdToken();
          if (token) {
            const manageRes = await fetch(
              `/api/prompts/${encodeURIComponent(id)}/manage`,
              {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
              }
            );
            if (manageRes.ok) {
              const payload = (await manageRes.json()) as { prompt?: PromptItem };
              if (active && payload.prompt) {
                setFetchedPrompt(payload.prompt);
                setLoadingDetails(false);
                return;
              }
            }
          }
        } catch {
          // Fallback to Firestore client SDK
        }
      }

      if (db && firebaseUser) {
        try {
          const snap = await getDoc(doc(db, 'prompts', id));
          if (!active) return;
          if (snap.exists()) {
            const d = snap.data();
            const aspect = (['16:9', '4:3', '3:4', '1:1'].includes(d.aspectRatio)
              ? d.aspectRatio
              : '4:3') as PromptItem['aspectRatio'];

            setFetchedPrompt({
              id: snap.id,
              title: String(d.title || 'Untitled Artwork'),
              imageUrl: String(
                d.imageUrl || '/src/assets/images/art_digital_dreamscape_1794836302512.jpg'
              ),
              aspectRatio: aspect,
              creatorUsername: String(d.authorUsername || 'contributor'),
              authorUid: typeof d.authorUid === 'string' ? d.authorUid : undefined,
              authorType: d.authorType === 'official' ? 'official' : 'contributor',
              authorLabel: typeof d.authorLabel === 'string' ? d.authorLabel : undefined,
              status: (d.status as PromptItem['status']) || 'approved',
              likes: typeof d.likes === 'number' ? d.likes : 0,
              copies: typeof d.copies === 'number' ? d.copies : 0,
              views: typeof d.views === 'number' ? d.views : 0,
              createdAt: new Date().toISOString().slice(0, 10),
              trendingCollections: ['recent'],
            });
          } else {
            setFetchedPrompt(null);
          }
        } catch {
          if (active) setFetchedPrompt(null);
        }
      } else if (active) {
        setFetchedPrompt(null);
      }

      if (active) setLoadingDetails(false);
    };

    loadSinglePrompt();

    return () => {
      active = false;
    };
  }, [publicPrompt, id, firebaseUser, getIdToken]);

  const prompt = publicPrompt || fetchedPrompt;

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen]);

  const relatedPrompts = useMemo(() => {
    if (!prompt) return [];
    return prompts.filter((item) => item.id !== prompt.id).slice(0, 4);
  }, [prompts, prompt]);

  const isOwner = Boolean(
    firebaseUser && prompt?.authorUid && prompt.authorUid === firebaseUser.uid
  );

  const openManageEditModal = async (openImagePicker = false) => {
    if (!prompt) return;
    const knownPromptText = unlockedPrompts[prompt.id] || prompt.promptText || '';
    setEditTitle(prompt.title);
    setEditPromptText(knownPromptText);
    setEditImageUrl(prompt.imageUrl);
    setEditAspectRatio(prompt.aspectRatio || '4:3');
    setEditFile(null);
    setEditModalOpen(true);
    if (openImagePicker) {
      window.setTimeout(() => editFileRef.current?.click(), 80);
    }

    if (!knownPromptText && firebaseUser) {
      setLoadingEditPrompt(true);
      try {
        const token = await getIdToken();
        if (token) {
          const manageRes = await fetch(
            `/api/prompts/${encodeURIComponent(prompt.id)}/manage`,
            {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            }
          );
          if (manageRes.ok) {
            const payload = (await manageRes.json()) as { prompt?: PromptItem };
            if (typeof payload.prompt?.promptText === 'string') {
              setEditPromptText(payload.prompt.promptText);
              return;
            }
          } else if (manageRes.status === 503 && db) {
            const secretSnap = await getDoc(doc(db, 'promptSecrets', prompt.id));
            if (secretSnap.exists() && typeof secretSnap.data()?.promptText === 'string') {
              setEditPromptText(secretSnap.data().promptText);
            }
          }
        }
      } catch {
        // Admin/owner can still re-enter prompt text if unavailable
      } finally {
        setLoadingEditPrompt(false);
      }
    }
  };

  const handleEditImageFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please select a valid PNG, JPG, or WebP image file.', 'terracotta');
      return;
    }
    setEditFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const dataUrl = reader.result;
        setEditImageUrl(dataUrl);
        const probe = new Image();
        probe.onload = () => {
          setEditAspectRatio(detectAspectRatio(probe.naturalWidth, probe.naturalHeight));
        };
        probe.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveManageEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt || !firebaseUser) return;
    if (editTitle.trim().length < 3) {
      showToast('Title must be at least 3 characters.', 'terracotta');
      return;
    }
    if (editPromptText.trim().length < 10) {
      showToast('Complete AI Generation Prompt must be at least 10 characters.', 'terracotta');
      return;
    }

    setSavingEdit(true);
    try {
      let nextImage = editImageUrl.trim();
      if (editFile) {
        nextImage = await resolvePersistableArtworkUrl({
          file: editFile,
          previewDataUrl: nextImage,
          uid: firebaseUser.uid,
          folder: 'prompts',
        });
      }

      const token = await getIdToken();
      const endpoint = isVerifiedAdmin
        ? `/api/admin/prompts/${encodeURIComponent(prompt.id)}`
        : `/api/prompts/${encodeURIComponent(prompt.id)}`;

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: editTitle.trim(),
          promptText: editPromptText.trim(),
          imageUrl: nextImage,
          aspectRatio: editAspectRatio,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload.error || 'Unable to save prompt updates', 'terracotta');
        return;
      }

      setFetchedPrompt((prev) =>
        prev
          ? {
              ...prev,
              title: editTitle.trim(),
              promptText: editPromptText.trim(),
              imageUrl: nextImage,
              aspectRatio: editAspectRatio,
            }
          : {
              ...prompt,
              title: editTitle.trim(),
              promptText: editPromptText.trim(),
              imageUrl: nextImage,
              aspectRatio: editAspectRatio,
            }
      );
      await refreshPublicPrompts();
      setEditModalOpen(false);
      setEditFile(null);
      showToast('Prompt updated successfully', 'teal');
    } catch {
      showToast('Unable to save prompt updates right now.', 'terracotta');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleTogglePublishStatus = async (targetStatus: 'approved' | 'unpublished') => {
    if (!prompt || !isVerifiedAdmin) return;
    setTogglingPublish(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/admin/prompts/${encodeURIComponent(prompt.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: targetStatus }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload.error || 'Could not update prompt visibility', 'terracotta');
        return;
      }

      setFetchedPrompt({ ...prompt, status: targetStatus });
      if (targetStatus === 'unpublished') {
        removePromptLocally(prompt.id);
        showToast('Prompt unpublished and removed from public pages', 'deep');
      } else {
        await refreshPublicPrompts();
        showToast('Prompt republished to ImageLab', 'teal');
      }
      setConfirmUnpublishOpen(false);
    } catch {
      showToast('Network error updating prompt visibility', 'terracotta');
    } finally {
      setTogglingPublish(false);
    }
  };

  const handleConfirmDeletePrompt = async () => {
    if (!prompt) return;
    setDeletingPrompt(true);
    try {
      const token = await getIdToken();
      const endpoint = isVerifiedAdmin
        ? `/api/admin/prompts/${encodeURIComponent(prompt.id)}`
        : `/api/prompts/${encodeURIComponent(prompt.id)}`;
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload.error || 'Could not delete prompt', 'terracotta');
        return;
      }
      removePromptLocally(prompt.id);
      await refreshPublicPrompts();
      setConfirmDeleteOpen(false);
      showToast('Prompt permanently deleted', 'deep');
      navigate('/explore');
    } catch {
      showToast('Unable to permanently delete prompt.', 'terracotta');
    } finally {
      setDeletingPrompt(false);
    }
  };

  if (!prompt) {
    if (loadingDetails) {
      return (
        <PageTransition>
          <SeoHead
            title="Loading Artwork — ImageLab"
            description="Inspect curated AI artwork and creator details on ImageLab."
            canonicalPath={id ? `/prompt/${encodeURIComponent(id)}` : '/explore'}
            noindex
          />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-20 space-y-6">
            <BackButton fallbackTo="/explore" label="Back" />
            <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-12 text-center text-sm font-sans text-[#264653]/70">
              Loading artwork details...
            </div>
          </div>
        </PageTransition>
      );
    }

    return (
      <PageTransition>
        <SeoHead
          title="Artwork Not Found — ImageLab"
          description="This artwork may have been unpublished or removed. Explore curated AI creations on ImageLab."
          canonicalPath="/explore"
          noindex
        />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-20 space-y-6">
          <BackButton fallbackTo="/explore" label="Back" />
          <EmptyState
            icon={<ImageOff className="w-6 h-6" />}
            title="Artwork not found"
            description="This artwork may have been unpublished, removed, or the URL is incomplete. Browse the full Explore gallery to discover curated AI creations."
            actionLabel="Explore Prompts"
            actionTo="/explore"
          />
        </div>
      </PageTransition>
    );
  }

  const creator = getCreator(prompt.creatorUsername);
  const isLiked = likedIds.includes(prompt.id);
  const isSaved = savedIds.includes(prompt.id);
  const isCopied = copiedId === prompt.id;
  const hasClipboardError = Boolean(firebaseUser && clipboardErrorId === prompt.id);
  const isPublished = (prompt.status || 'approved') === 'approved';
  const canonicalOrigin = resolveCanonicalOrigin();
  const canonicalPromptPath = `/prompt/${encodeURIComponent(prompt.id)}`;
  const unlockedPromptText = firebaseUser ? unlockedPrompts[prompt.id] || '' : '';

  const handleCopyFullPrompt = async () => {
    if (!firebaseUser) {
      const targetUrl = `/prompt/${prompt.id}`;
      try {
        sessionStorage.setItem('imagelab_post_auth_redirect', targetUrl);
      } catch {
        // Ignore storage errors
      }
      navigate(`/signup?redirect=${encodeURIComponent(targetUrl)}`);
      return;
    }

    setCopySuccessBanner(false);
    setCopyingPrompt(true);
    try {
      const ok = await copyPrompt(prompt.id);
      if (ok) {
        setCopySuccessBanner(true);
      } else {
        window.requestAnimationFrame(() => {
          selectElementText(manualCopyTextareaRef.current);
        });
      }
    } finally {
      setCopyingPrompt(false);
    }
  };

  return (
    <PageTransition>
      <SeoHead
        title={`${prompt.title} — ImageLab AI Artwork`}
        description={`Inspect "${prompt.title}" by @${creator.username} on ImageLab. View full-resolution AI artwork and creator details.`}
        canonicalPath={canonicalPromptPath}
        noindex={!isPublished}
        ogType="article"
        imageUrl={prompt.imageUrl}
        structuredData={
          isPublished
            ? {
                '@context': 'https://schema.org',
                '@type': 'ImageObject',
                name: prompt.title,
                url: `${canonicalOrigin}${canonicalPromptPath}`,
                contentUrl: resolveAbsoluteUrl(canonicalOrigin, prompt.imageUrl),
                datePublished: prompt.createdAt,
                creator: {
                  '@type': 'Person',
                  name: creator.displayName,
                  alternateName: `@${creator.username}`,
                },
              }
            : undefined
        }
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16 font-sans">
        {/* Back Control */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <BackButton fallbackTo="/explore" label="Back" />

          <div className="flex items-center gap-3">
            {!isPublished && (isVerifiedAdmin || isOwner) && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#E76F51]/14 text-[#D05A3C] text-xs font-semibold">
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Unpublished (Hidden from public website)</span>
              </span>
            )}
          </div>
        </div>

        {/* Admin & Super Admin Control Panel (Visible ONLY to verified Admins/Super Admins) */}
        {isVerifiedAdmin && (
          <section
            aria-label="Administrative Prompt Controls"
            className="mb-8 rounded-2xl bg-[#FAF7F2] border border-[#264653]/18 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#264653] text-[#FAF7F2] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-bold text-[#264653]">
                  Administrative Controls
                </p>
                <p className="text-xs text-[#264653]/70">
                  Manage this prompt directly across all public pages and Firestore.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openManageEditModal(false)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264653] hover:bg-[#355C6B] text-white text-xs font-semibold transition-colors min-h-[38px]"
              >
                <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Edit Prompt</span>
              </button>

              <button
                type="button"
                onClick={() => openManageEditModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F4EDE4] hover:bg-[#E8DEC8] text-[#264653] text-xs font-semibold transition-colors min-h-[38px]"
              >
                <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Replace Image</span>
              </button>

              {isPublished ? (
                <button
                  type="button"
                  onClick={() => setConfirmUnpublishOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E76F51]/14 text-[#D05A3C] hover:bg-[#E76F51] hover:text-white text-xs font-semibold transition-colors min-h-[38px]"
                >
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Unpublish Prompt</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={togglingPublish}
                  onClick={() => handleTogglePublishStatus('approved')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-xs font-semibold transition-colors min-h-[38px]"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Republish Prompt</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#D05A3C] hover:bg-[#b5482c] text-white text-xs font-semibold transition-colors min-h-[38px]"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Delete Prompt</span>
              </button>
            </div>
          </section>
        )}

        {/* Owner-Only Controls for Contributors on Their Own Prompt */}
        {!isVerifiedAdmin && isOwner && (
          <section
            aria-label="Your Prompt Controls"
            className="mb-8 rounded-2xl bg-[#FAF7F2] border border-[#2A9D8F]/25 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div>
              <p className="text-xs font-bold text-[#264653]">Your Creation</p>
              <p className="text-xs text-[#264653]/70">
                You can update your image, title, or prompt text, or delete this prompt.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openManageEditModal(false)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-xs font-semibold transition-colors min-h-[38px]"
              >
                <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Edit My Prompt</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E76F51]/12 text-[#D05A3C] hover:bg-[#D05A3C] hover:text-white text-xs font-semibold transition-colors min-h-[38px]"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Delete My Prompt</span>
              </button>
            </div>
          </section>
        )}

        {/* Main Detail Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
          {/* Large 9:16 Portrait Image */}
          <div
            data-ad-slot="prompt_details_image"
            data-ad-label="Prompt Details Image Column"
            className="lg:col-span-6"
          >
            <div className="relative w-full max-w-[440px] mx-auto aspect-[9/16] rounded-3xl overflow-hidden bg-[#FAF7F2] border border-[#264653]/12 shadow-[0_14px_40px_-14px_rgba(38,70,83,0.18)] group">
              <SafeImage
                src={prompt.imageUrl}
                alt={prompt.title}
                fallbackTitle={prompt.title}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                aria-label="Open full-screen artwork preview"
                className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264653]/85 hover:bg-[#264653] text-[#FAF7F2] text-xs font-semibold backdrop-blur-xs transition-colors min-h-[40px]"
              >
                <Expand className="w-3.5 h-3.5" aria-hidden="true" />
                <span>View Full Size</span>
              </button>
            </div>
          </div>

          {/* Right Info, Engagement, Protected AI Prompt & Creator Column */}
          <div
            data-ad-slot="prompt_details_panel"
            data-ad-label="Prompt Details Info Panel"
            className="lg:col-span-6 space-y-6"
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-normal text-[#264653]/70">
                <Link
                  to={`/creator/${creator.username}`}
                  className="font-semibold text-[#2A9D8F] hover:text-[#218175] transition-colors"
                >
                  @{creator.username}
                </Link>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{prompt.createdAt}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {prompt.views.toLocaleString()} views
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {prompt.copies.toLocaleString()} copies
                </span>
              </div>

              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#264653] leading-tight">
                {prompt.title}
              </h1>
            </div>

            {/* Protected AI Generation Prompt Panel (Zero public prompt leakage; auth-gated Copy Full Prompt) */}
            <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-5 sm:p-6 space-y-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-[#264653]">
                  Complete AI Generation Prompt
                </h2>
                <button
                  type="button"
                  disabled={copyingPrompt}
                  onClick={handleCopyFullPrompt}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all min-h-[42px] shadow-xs disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                    isCopied
                      ? 'bg-[#2A9D8F] text-white focus-visible:ring-[#2A9D8F]'
                      : 'bg-[#E76F51] hover:bg-[#D05A3C] text-white focus-visible:ring-[#E76F51]'
                  }`}
                >
                  {isCopied ? (
                    <>
                      <Check className="w-4 h-4" aria-hidden="true" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" aria-hidden="true" />
                      <span>{copyingPrompt ? 'Copying...' : 'Copy Full Prompt'}</span>
                    </>
                  )}
                </button>
              </div>

              {(copySuccessBanner || isCopied) && !hasClipboardError && (
                <div
                  role="status"
                  className="rounded-xl bg-[#2A9D8F]/12 border border-[#2A9D8F]/30 px-3.5 py-2.5 flex items-center gap-2 text-xs font-semibold text-[#218175]"
                >
                  <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Prompt copied successfully!</span>
                </div>
              )}

              {hasClipboardError && (
                <div
                  role="alert"
                  className="rounded-xl bg-[#E76F51]/12 border border-[#E76F51]/35 px-3.5 py-3 space-y-2 text-xs text-[#264653]"
                >
                  <p className="font-semibold text-[#D05A3C]">
                    Clipboard permission or browser restriction prevented automatic copying.
                  </p>
                  <p className="text-[#264653]/80">
                    {unlockedPromptText
                      ? 'Use the selectable field below to copy manually, or tap "Copy Full Prompt" again.'
                      : 'Sign in or try tapping "Copy Full Prompt" again.'}
                  </p>
                </div>
              )}

              <div className="rounded-2xl bg-[#F4EDE4]/75 border border-[#264653]/10 p-4 sm:p-5">
                {!firebaseUser ? (
                  <div className="flex items-start gap-2.5 text-sm text-[#264653]/80 leading-relaxed">
                    <Lock className="w-4 h-4 text-[#E76F51] shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      This prompt is protected. Click <strong>Copy Full Prompt</strong> to sign in or create a free account and return here to copy it.
                    </span>
                  </div>
                ) : hasClipboardError && unlockedPromptText ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="manual-copy-prompt-field"
                        className="text-xs font-semibold text-[#264653]"
                      >
                        Manual Copy Prompt Text
                      </label>
                      <button
                        type="button"
                        onClick={() => selectElementText(manualCopyTextareaRef.current)}
                        className="px-2.5 py-1 rounded-lg bg-[#264653] hover:bg-[#355C6B] text-[#FAF7F2] text-xs font-semibold transition-colors"
                      >
                        Select Text
                      </button>
                    </div>
                    <textarea
                      id="manual-copy-prompt-field"
                      ref={manualCopyTextareaRef}
                      readOnly
                      rows={5}
                      value={unlockedPromptText}
                      onFocus={(e) => selectElementText(e.currentTarget)}
                      onClick={(e) => selectElementText(e.currentTarget)}
                      className="w-full p-3 rounded-xl bg-[#FAF7F2] border border-[#E76F51]/40 font-sans font-normal text-sm leading-relaxed text-[#264653] focus:outline-none focus:ring-2 focus:ring-[#E76F51]"
                    />
                  </div>
                ) : unlockedPromptText ? (
                  <p className="font-sans font-normal text-sm sm:text-[15px] leading-relaxed text-[#264653] whitespace-pre-wrap select-all">
                    {unlockedPromptText}
                  </p>
                ) : (
                  <div className="flex items-start gap-2.5 text-sm text-[#264653]/80 leading-relaxed">
                    <Lock className="w-4 h-4 text-[#2A9D8F] shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      Click <strong>Copy Full Prompt</strong> above to copy the complete generation prompt to your clipboard.
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => toggleLike(prompt.id)}
                  aria-pressed={isLiked}
                  className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all min-h-[46px] tabular-nums ${
                    isLiked
                      ? 'bg-[#E76F51] text-white shadow-sm'
                      : 'bg-[#F4EDE4]/70 border border-[#264653]/12 text-[#264653] hover:border-[#E76F51]/45'
                  }`}
                >
                  <Heart
                    className={`w-4 h-4 ${isLiked ? 'fill-white text-white' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{prompt.likes.toLocaleString()} Likes</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleSave(prompt.id)}
                  aria-pressed={isSaved}
                  className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all min-h-[46px] ${
                    isSaved
                      ? 'bg-[#2A9D8F] text-white shadow-sm'
                      : 'bg-[#F4EDE4]/70 border border-[#264653]/12 text-[#264653] hover:border-[#2A9D8F]/45'
                  }`}
                >
                  <Bookmark
                    className={`w-4 h-4 ${isSaved ? 'fill-white text-white' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{isSaved ? 'Saved' : 'Save'}</span>
                </button>
              </div>
            </div>

            {/* Creator Profile Card */}
            <Link
              to={`/creator/${creator.username}`}
              className="flex items-center gap-4 p-5 rounded-2xl bg-[#FAF7F2] border border-[#264653]/12 hover:border-[#2A9D8F]/50 transition-colors group"
            >
              <div className="w-14 h-14 rounded-full overflow-hidden bg-[#E8DEC8] shrink-0">
                <SafeImage
                  src={creator.avatarUrl}
                  alt={creator.displayName}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-[#264653] group-hover:text-[#E76F51] transition-colors truncate">
                    {creator.displayName}
                  </h2>
                  <span className="text-xs font-semibold text-[#2A9D8F] shrink-0">
                    View Profile →
                  </span>
                </div>
                <p className="text-xs text-[#264653]/65 mb-1">
                  @{creator.username} · {creator.role}
                </p>
                <p className="text-xs sm:text-sm font-normal text-[#264653]/75 leading-relaxed line-clamp-2">
                  {creator.bio}
                </p>
              </div>
            </Link>
          </div>
        </div>

        {/* Related Prompts */}
        <section
          data-ad-slot="prompt_details_related"
          data-ad-label="Prompt Details Related Section"
          className="mt-16 pt-12 border-t border-[#264653]/10"
        >
          <div className="flex items-end justify-between gap-4 mb-7">
            <div>
              <p className="text-xs font-semibold text-[#2A9D8F] mb-1">
                Continue Exploring
              </p>
              <h2 className="text-2xl font-bold tracking-tight text-[#264653]">
                Related Creations
              </h2>
            </div>
            <Link
              to="/explore"
              className="text-sm font-semibold text-[#E76F51] hover:text-[#D05A3C]"
            >
              Explore All Prompts →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3.5 sm:gap-5 lg:gap-6">
            {relatedPrompts.map((item) => (
              <PromptCard key={item.id} prompt={item} />
            ))}
          </div>
        </section>
      </div>

      {/* Edit Prompt Modal (Admin or Owner) */}
      {editModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-edit-prompt-title"
          className="fixed inset-0 z-50 bg-[#264653]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-2xl rounded-3xl bg-[#FAF7F2] border border-[#264653]/15 shadow-2xl p-6 sm:p-8 my-8 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="manage-edit-prompt-title" className="text-xl font-bold text-[#264653]">
                  Edit Prompt
                </h2>
                <p className="text-xs text-[#264653]/65">
                  Creator @{prompt.creatorUsername} and creation date remain preserved.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                aria-label="Close modal"
                className="p-2 rounded-xl text-[#264653]/70 hover:bg-[#F4EDE4]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveManageEdit} className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-2xl bg-[#F4EDE4]/70 border border-[#264653]/12">
                <div className="w-28 h-20 rounded-xl overflow-hidden bg-[#E8DEC8] shrink-0">
                  <SafeImage
                    src={editImageUrl}
                    alt={editTitle}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="space-y-2 flex-1">
                  <p className="text-xs font-bold text-[#264653]">Artwork Image</p>
                  <input
                    ref={editFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => handleEditImageFile(e.target.files?.[0])}
                    className="sr-only"
                  />
                  <button
                    type="button"
                    onClick={() => editFileRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-[#264653]/18 hover:border-[#2A9D8F] text-xs font-semibold text-[#264653]"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Replace Image</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1.5">
                  Image Title
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-sm text-[#264653]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1.5">
                  Complete AI Generation Prompt
                </label>
                <textarea
                  rows={5}
                  required
                  disabled={loadingEditPrompt}
                  placeholder={loadingEditPrompt ? 'Loading protected prompt...' : 'Enter the complete AI generation prompt...'}
                  value={editPromptText}
                  onChange={(e) => setEditPromptText(e.target.value)}
                  className="w-full p-3.5 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 font-sans font-normal text-sm leading-relaxed text-[#264653] disabled:opacity-60"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#264653]/10">
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
                  className="px-5 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-sm font-semibold"
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unpublish Confirmation Modal */}
      {confirmUnpublishOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unpublish-prompt-title"
          className="fixed inset-0 z-50 bg-[#264653]/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#FAF7F2] border border-[#E76F51]/30 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Eye className="w-5 h-5 text-[#E76F51]" aria-hidden="true" />
              <h3 id="unpublish-prompt-title" className="text-lg font-bold text-[#264653]">
                Unpublish Prompt
              </h3>
            </div>
            <p className="text-sm text-[#264653]/80 leading-relaxed">
              Unpublishing <strong>{prompt.title}</strong> will immediately hide it from Homepage, Explore, Trending, public search, and the XML sitemap. The Firestore record is preserved so you can republish it later.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmUnpublishOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={togglingPublish}
                onClick={() => handleTogglePublishStatus('unpublished')}
                className="px-5 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-sm font-semibold"
              >
                {togglingPublish ? 'Unpublishing...' : 'Confirm Unpublish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-details-prompt-title"
          className="fixed inset-0 z-50 bg-[#264653]/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#FAF7F2] border border-[#E76F51]/30 shadow-2xl p-6 space-y-4">
            <h3 id="delete-details-prompt-title" className="text-lg font-bold text-[#264653]">
              Delete Prompt Permanently
            </h3>
            <p className="text-sm text-[#264653]/80 leading-relaxed">
              Are you sure you want to permanently delete <strong>{prompt.title}</strong>? This removes its Firestore document and uploaded Storage image and cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingPrompt}
                onClick={handleConfirmDeletePrompt}
                className="px-5 py-2.5 rounded-xl bg-[#D05A3C] hover:bg-[#b5482c] disabled:opacity-60 text-white text-sm font-semibold"
              >
                {deletingPrompt ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Lightbox */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Full size artwork: ${prompt.title}`}
          className="fixed inset-0 z-50 bg-[#13242B]/95 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            aria-label="Close lightbox"
            className="absolute top-5 right-5 inline-flex items-center justify-center w-11 h-11 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div
            className="max-w-5xl max-h-[90vh] flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <SafeImage
              src={prompt.imageUrl}
              alt={prompt.title}
              className="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl"
            />
            <p className="text-sm font-medium text-[#FAF7F2]">
              {prompt.title} — by @{creator.username}
            </p>
          </div>
        </div>
      )}
    </PageTransition>
  );
}
