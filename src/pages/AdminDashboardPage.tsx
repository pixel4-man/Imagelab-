import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Edit3,
  ExternalLink,
  EyeOff,
  FileText,
  Flag,
  ImagePlus,
  Megaphone,
  RotateCcw,
  Search,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { Link, useSearchParams } from 'react-router-dom';
import { AdsManagerWorkspace } from '../components/AdsManagerWorkspace';
import { BackButton } from '../components/BackButton';
import { PageTransition } from '../components/PageTransition';
import { SafeImage } from '../components/SafeImage';
import { SeoHead } from '../components/SeoHead';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { auth, db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { resolvePersistableArtworkUrl } from '../lib/imageUpload';
import { AccountStatus, UserRole } from '../server/rbac';

interface DirectoryUser {
  uid: string;
  fullName: string;
  username: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
}

type PromptStatus = 'approved' | 'unpublished' | 'pending' | 'rejected' | 'draft';

interface AdminPromptRow {
  id: string;
  title: string;
  promptText: string;
  imageUrl: string;
  aspectRatio?: '16:9' | '4:3' | '3:4' | '1:1';
  authorUid: string;
  authorUsername: string;
  authorEmail?: string;
  authorType?: 'contributor' | 'official';
  authorLabel?: string;
  status: PromptStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface ReportRow {
  id: string;
  promptId: string;
  reporterUid: string;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt?: unknown;
}

type AdminTab =
  | 'prompts'
  | 'users'
  | 'ads'
  | 'reports'
  | 'admin_management'
  | 'website_settings';

type PromptFilter = 'all' | 'official' | 'contributor' | 'published' | 'unpublished';

type EditFocusTarget = 'all' | 'image' | 'title' | 'prompt';

function detectAspectRatio(width: number, height: number): '16:9' | '4:3' | '3:4' | '1:1' {
  if (!width || !height) return '4:3';
  const ratio = width / height;
  if (ratio >= 1.55) return '16:9';
  if (ratio >= 1.12) return '4:3';
  if (ratio <= 0.88) return '3:4';
  return '1:1';
}

function formatDateDisplay(val: unknown): string {
  if (
    val &&
    typeof val === 'object' &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  }
  if (typeof val === 'string' && val.length >= 10) {
    return val.slice(0, 10);
  }
  return '—';
}

export function AdminDashboardPage() {
  const { userProfile, firebaseUser, getIdToken } = useAuth();
  const { showToast, refreshPublicPrompts, removePromptLocally } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  const isSuperAdmin = userProfile?.role === 'super_admin';

  const validTabs: AdminTab[] = [
    'prompts',
    'users',
    'ads',
    'reports',
    'admin_management',
    'website_settings',
  ];
  const rawTab = searchParams.get('tab') as AdminTab | null;
  const initialTab: AdminTab =
    rawTab && validTabs.includes(rawTab)
      ? rawTab
      : 'prompts';
  const [tab, setTab] = useState<AdminTab>(initialTab);

  useEffect(() => {
    const paramTab = searchParams.get('tab') as AdminTab | null;
    if (paramTab && validTabs.includes(paramTab)) {
      if (
        (paramTab === 'admin_management' || paramTab === 'website_settings') &&
        !isSuperAdmin
      ) {
        return;
      }
      setTab(paramTab);
    }
  }, [searchParams, isSuperAdmin]);

  const selectTab = (next: AdminTab) => {
    setTab(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  };

  // Live collections (real Firebase database counts)
  const [promptsList, setPromptsList] = useState<AdminPromptRow[]>([]);
  const [usersList, setUsersList] = useState<DirectoryUser[]>([]);
  const [reportsList, setReportsList] = useState<ReportRow[]>([]);
  const [activeAdsCount, setActiveAdsCount] = useState(0);

  // Prompt Management Filters & Modals
  const [promptSearch, setPromptSearch] = useState('');
  const [promptFilter, setPromptFilter] = useState<PromptFilter>('all');
  const [editingPrompt, setEditingPrompt] = useState<AdminPromptRow | null>(null);
  const [editFocusTarget, setEditFocusTarget] = useState<EditFocusTarget>('all');
  const editFileRef = useRef<HTMLInputElement>(null);
  const editTitleRef = useRef<HTMLInputElement>(null);
  const editPromptRef = useRef<HTMLTextAreaElement>(null);
  const [editPromptFile, setEditPromptFile] = useState<File | null>(null);
  const [editPromptForm, setEditPromptForm] = useState({
    imageUrl: '',
    aspectRatio: '4:3' as '16:9' | '4:3' | '3:4' | '1:1',
    title: '',
    promptText: '',
    status: 'approved' as PromptStatus,
  });
  const [savingPromptEdit, setSavingPromptEdit] = useState(false);

  // Confirmation Modals (Unpublish + Delete Permanently)
  const [unpublishTarget, setUnpublishTarget] = useState<AdminPromptRow | null>(null);
  const [unpublishing, setUnpublishing] = useState(false);
  const [deletePromptTarget, setDeletePromptTarget] = useState<AdminPromptRow | null>(null);
  const [deletingPrompt, setDeletingPrompt] = useState(false);

  // Official Prompt Modal (accessible from All Prompts)
  const [officialModalOpen, setOfficialModalOpen] = useState(false);
  const officialFileRef = useRef<HTMLInputElement>(null);
  const [officialFile, setOfficialFile] = useState<File | null>(null);
  const [officialPreview, setOfficialPreview] = useState('');
  const [officialAspect, setOfficialAspect] = useState<'16:9' | '4:3' | '3:4' | '1:1'>('4:3');
  const [officialTitle, setOfficialTitle] = useState('');
  const [officialPromptText, setOfficialPromptText] = useState('');
  const [officialLabel, setOfficialLabel] = useState('ImageLab Official');
  const [officialError, setOfficialError] = useState<string | null>(null);
  const [publishingOfficial, setPublishingOfficial] = useState(false);

  // Users Search
  const [userSearch, setUserSearch] = useState('');

  // Super Admin Website Settings
  const [siteName, setSiteName] = useState('ImageLab');
  const [allowRegistrations, setAllowRegistrations] = useState(true);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  const fetchAdminPrompts = React.useCallback(async () => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/prompts', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const payload = (await res.json()) as { prompts?: AdminPromptRow[] };
      if (Array.isArray(payload.prompts)) {
        setPromptsList(payload.prompts);
      }
    } catch {
      // Fallback handled by live Firestore snapshot
    }
  }, [getIdToken]);

  useEffect(() => {
    if (!db || !userProfile) return;

    fetchAdminPrompts();

    const unsubPrompts = onSnapshot(
      collection(db, 'prompts'),
      (snap) => {
        setPromptsList((prev) => {
          const prevMap = new Map(prev.map((row) => [row.id, row]));
          return snap.docs.map((d) => {
            const data = d.data() as Omit<AdminPromptRow, 'id'>;
            const existing = prevMap.get(d.id);
            return {
              id: d.id,
              ...data,
              promptText: data.promptText || existing?.promptText || '',
              authorEmail: existing?.authorEmail,
            };
          });
        });
        fetchAdminPrompts();
      },
      (err) => {
        if (!auth?.currentUser) return;
        handleFirestoreError(err, OperationType.LIST, 'prompts');
      }
    );

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        setUsersList(
          snap.docs.map((d) => ({
            uid: d.id,
            ...(d.data() as Omit<DirectoryUser, 'uid'>),
          }))
        );
      },
      (err) => {
        if (!auth?.currentUser) return;
        handleFirestoreError(err, OperationType.LIST, 'users');
      }
    );

    const unsubReports = onSnapshot(
      collection(db, 'reports'),
      (snap) => {
        setReportsList(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ReportRow, 'id'>),
          }))
        );
      },
      (err) => {
        if (!auth?.currentUser) return;
        handleFirestoreError(err, OperationType.LIST, 'reports');
      }
    );

    const unsubAds = onSnapshot(
      collection(db, 'ads'),
      (snap) => {
        const activeCount = snap.docs.filter((d) => d.data()?.status === 'active').length;
        setActiveAdsCount(activeCount);
      },
      () => {
        // Admin API fallback below
      }
    );

    if (isSuperAdmin) {
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
    }

    return () => {
      unsubPrompts();
      unsubUsers();
      unsubReports();
      unsubAds();
    };
  }, [userProfile, fetchAdminPrompts, isSuperAdmin]);

  useEffect(() => {
    if (!userProfile) return;
    getIdToken()
      .then((token) =>
        token
          ? fetch('/api/admin/ads', {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            })
          : null
      )
      .then(async (res) => {
        if (
          !res ||
          !res.ok ||
          !res.headers.get('content-type')?.toLowerCase().includes('application/json')
        ) {
          return;
        }
        const payload = (await res.json()) as { ads?: { status?: string }[] };
        if (Array.isArray(payload.ads)) {
          setActiveAdsCount(payload.ads.filter((a) => a.status === 'active').length);
        }
      })
      .catch(() => {});
  }, [userProfile, getIdToken]);

  const userEmailByUid = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of usersList) {
      if (u.uid && u.email) {
        map.set(u.uid, u.email);
      }
    }
    return map;
  }, [usersList]);

  // Simplified 3 overview statistics from real Firebase data
  const metrics = useMemo(
    () => ({
      registeredUsers: usersList.length,
      totalPrompts: promptsList.length,
      activeAds: activeAdsCount,
    }),
    [usersList.length, promptsList.length, activeAdsCount]
  );

  const filteredPrompts = useMemo(() => {
    const q = promptSearch.trim().toLowerCase();
    return promptsList.filter((p) => {
      const isPublished = p.status === 'approved';
      if (promptFilter === 'official' && p.authorType !== 'official') return false;
      if (promptFilter === 'contributor' && p.authorType === 'official') return false;
      if (promptFilter === 'published' && !isPublished) return false;
      if (promptFilter === 'unpublished' && isPublished) return false;

      if (!q) return true;
      const email = (
        p.authorEmail ||
        userEmailByUid.get(p.authorUid) ||
        (p.authorType === 'official' ? 'editorial@imagelab.app' : '')
      ).toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        (p.authorUsername || '').toLowerCase().includes(q) ||
        email.includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [promptsList, promptSearch, promptFilter, userEmailByUid]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return usersList;
    return usersList.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    );
  }, [usersList, userSearch]);

  const handlePromptStatus = async (promptId: string, status: PromptStatus) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/admin/prompts/${encodeURIComponent(promptId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        if (status !== 'approved') {
          removePromptLocally(promptId);
        }
        await refreshPublicPrompts();
        await fetchAdminPrompts();
        showToast(
          status === 'approved'
            ? 'Prompt republished live'
            : 'Prompt unpublished and hidden from public website',
          status === 'approved' ? 'teal' : 'deep'
        );
        return true;
      }
      if (res.status === 503 && db) {
        await updateDoc(doc(db, 'prompts', promptId), {
          status,
          updatedAt: serverTimestamp(),
        });
        if (status !== 'approved') {
          removePromptLocally(promptId);
        }
        await refreshPublicPrompts();
        await fetchAdminPrompts();
        showToast(
          status === 'approved' ? 'Prompt republished live' : 'Prompt unpublished',
          status === 'approved' ? 'teal' : 'deep'
        );
        return true;
      }
      const payload = await res.json().catch(() => ({}));
      showToast(payload.error || 'Could not update prompt visibility', 'terracotta');
      return false;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `prompts/${promptId}`);
      return false;
    }
  };

  const handleConfirmUnpublish = async () => {
    if (!unpublishTarget) return;
    setUnpublishing(true);
    const ok = await handlePromptStatus(unpublishTarget.id, 'unpublished');
    setUnpublishing(false);
    if (ok) {
      setUnpublishTarget(null);
    }
  };

  const openEditPromptModal = (item: AdminPromptRow, focusTarget: EditFocusTarget = 'all') => {
    setEditingPrompt(item);
    setEditFocusTarget(focusTarget);
    setEditPromptFile(null);
    setEditPromptForm({
      imageUrl: item.imageUrl || '',
      aspectRatio: item.aspectRatio || '4:3',
      title: item.title,
      promptText: item.promptText || '',
      status: item.status || 'approved',
    });

    window.setTimeout(() => {
      if (focusTarget === 'image') {
        editFileRef.current?.click();
      } else if (focusTarget === 'title') {
        editTitleRef.current?.focus();
      } else if (focusTarget === 'prompt') {
        editPromptRef.current?.focus();
      }
    }, 80);
  };

  const handleEditFileChange = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please select a valid PNG, JPG, or WebP image file.', 'terracotta');
      return;
    }
    setEditPromptFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const dataUrl = reader.result;
        const probe = new Image();
        probe.onload = () => {
          setEditPromptForm((p) => ({
            ...p,
            imageUrl: dataUrl,
            aspectRatio: detectAspectRatio(probe.naturalWidth, probe.naturalHeight),
          }));
        };
        probe.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSavePromptEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPrompt) return;
    if (editPromptForm.title.trim().length < 3) {
      showToast('Title must be at least 3 characters.', 'terracotta');
      return;
    }
    if (editPromptForm.promptText.trim().length < 10) {
      showToast('Complete AI Generation Prompt must be at least 10 characters.', 'terracotta');
      return;
    }

    setSavingPromptEdit(true);
    try {
      let nextImageUrl = editPromptForm.imageUrl.trim();
      if (editPromptFile && firebaseUser) {
        nextImageUrl = await resolvePersistableArtworkUrl({
          file: editPromptFile,
          previewDataUrl: nextImageUrl,
          uid: firebaseUser.uid,
          folder: 'prompts',
        });
      }

      const token = await getIdToken();
      const res = await fetch(`/api/admin/prompts/${encodeURIComponent(editingPrompt.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          imageUrl: nextImageUrl,
          aspectRatio: editPromptForm.aspectRatio,
          title: editPromptForm.title.trim(),
          promptText: editPromptForm.promptText.trim(),
          status: editPromptForm.status,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 503) {
        showToast(payload.error || 'Unable to save prompt edits', 'terracotta');
        return;
      }
      if (res.status === 503 && db && firebaseUser) {
        const batch = writeBatch(db);
        batch.update(doc(db, 'prompts', editingPrompt.id), {
          imageUrl: nextImageUrl,
          aspectRatio: editPromptForm.aspectRatio,
          title: editPromptForm.title.trim(),
          promptText: editPromptForm.promptText.trim(),
          status: editPromptForm.status,
          updatedAt: serverTimestamp(),
        });
        batch.set(
          doc(db, 'promptSecrets', editingPrompt.id),
          {
            id: editingPrompt.id,
            promptText: editPromptForm.promptText.trim(),
            authorUid: editingPrompt.authorUid || firebaseUser.uid,
            createdAt: editingPrompt.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        await batch.commit();
      }

      await fetchAdminPrompts();
      await refreshPublicPrompts();
      setEditingPrompt(null);
      setEditPromptFile(null);
      showToast('Prompt updated successfully (creator attribution preserved)', 'teal');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `prompts/${editingPrompt.id}`);
    } finally {
      setSavingPromptEdit(false);
    }
  };

  const handleConfirmDeletePrompt = async () => {
    if (!deletePromptTarget) return;
    setDeletingPrompt(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/admin/prompts/${encodeURIComponent(deletePromptTarget.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 503) {
        const payload = await res.json().catch(() => ({}));
        showToast(payload.error || 'Could not delete prompt', 'terracotta');
        return;
      }
      if (res.status === 503 && db) {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'prompts', deletePromptTarget.id));
        batch.delete(doc(db, 'promptSecrets', deletePromptTarget.id));
        await batch.commit();
      }
      removePromptLocally(deletePromptTarget.id);
      await fetchAdminPrompts();
      await refreshPublicPrompts();
      setDeletePromptTarget(null);
      showToast('Prompt permanently deleted', 'deep');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `prompts/${deletePromptTarget.id}`);
    } finally {
      setDeletingPrompt(false);
    }
  };

  const handleOfficialFileChange = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) {
      setOfficialError('Please select a valid PNG, JPG, or WebP image file.');
      return;
    }
    setOfficialFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const dataUrl = reader.result;
        setOfficialPreview(dataUrl);
        setOfficialError(null);
        const probe = new Image();
        probe.onload = () => {
          setOfficialAspect(detectAspectRatio(probe.naturalWidth, probe.naturalHeight));
        };
        probe.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePublishOfficial = async (e: React.FormEvent) => {
    e.preventDefault();
    setOfficialError(null);
    if (!officialPreview) {
      setOfficialError('Please upload an AI-generated artwork image.');
      return;
    }
    if (officialTitle.trim().length < 3) {
      setOfficialError('Image Title must be at least 3 characters.');
      return;
    }
    if (officialPromptText.trim().length < 10) {
      setOfficialError('Complete AI Generation Prompt must be at least 10 characters.');
      return;
    }
    if (!firebaseUser) return;

    setPublishingOfficial(true);
    try {
      const resolvedImageUrl = await resolvePersistableArtworkUrl({
        file: officialFile,
        previewDataUrl: officialPreview,
        uid: firebaseUser.uid,
        folder: 'official_prompts',
      });

      const token = await getIdToken();
      const res = await fetch('/api/admin/prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          imageUrl: resolvedImageUrl,
          aspectRatio: officialAspect,
          title: officialTitle.trim(),
          promptText: officialPromptText.trim(),
          authorLabel: officialLabel.trim() || 'ImageLab Official',
          status: 'approved',
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOfficialError(payload.error || 'Unable to publish official prompt.');
        return;
      }

      await fetchAdminPrompts();
      await refreshPublicPrompts();
      setOfficialModalOpen(false);
      setOfficialFile(null);
      setOfficialPreview('');
      setOfficialAspect('4:3');
      setOfficialTitle('');
      setOfficialPromptText('');
      showToast('Official prompt published live to ImageLab', 'teal');
    } catch {
      setOfficialError('Unable to publish official prompt right now.');
    } finally {
      setPublishingOfficial(false);
    }
  };

  const handleToggleUserStatus = async (target: DirectoryUser) => {
    if (target.role === 'super_admin') {
      showToast('Super Admin accounts cannot be altered', 'terracotta');
      return;
    }
    const nextStatus: AccountStatus =
      target.accountStatus === 'active' ? 'suspended' : 'active';

    try {
      const token = await getIdToken();
      const res = await fetch(`/api/admin/users/${target.uid}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ accountStatus: nextStatus }),
      });

      if (res.ok) {
        showToast(`Account updated to ${nextStatus}`, 'teal');
        return;
      }

      if (res.status === 503 && db) {
        await updateDoc(doc(db, 'users', target.uid), {
          accountStatus: nextStatus,
        });
        showToast(`Account status updated to ${nextStatus}`, 'teal');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      showToast(payload.error || 'Action not permitted', 'terracotta');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${target.uid}`);
    }
  };

  const handleRoleChange = async (target: DirectoryUser, nextRole: 'admin' | 'contributor') => {
    if (!isSuperAdmin) return;
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

  const handleDeleteUser = async (target: DirectoryUser) => {
    if (!isSuperAdmin) return;
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/super-admin/users/${target.uid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
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
    if (!db || !isSuperAdmin) return;
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

  const handleReportStatus = async (reportId: string, status: 'resolved' | 'dismissed') => {
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/admin/reports/${reportId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        showToast(`Report marked as ${status}`, 'teal');
      } else if (db) {
        await updateDoc(doc(db, 'reports', reportId), { status });
        showToast(`Report marked as ${status}`, 'teal');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `reports/${reportId}`);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/admin/reports/${reportId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showToast('Report removed', 'deep');
      } else if (db) {
        await deleteDoc(doc(db, 'reports', reportId));
        showToast('Report removed', 'deep');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `reports/${reportId}`);
    }
  };

  const adminTabs = useMemo(() => {
    const base: { id: AdminTab; label: string; icon: typeof FileText }[] = [
      { id: 'prompts', label: 'All Prompts', icon: FileText },
      { id: 'users', label: 'Users Directory', icon: Users },
      { id: 'ads', label: 'Ads Manager', icon: Megaphone },
      { id: 'reports', label: `Reports (${reportsList.length})`, icon: Flag },
    ];
    if (isSuperAdmin) {
      base.push(
        { id: 'admin_management', label: 'Admin Management', icon: UserCog },
        { id: 'website_settings', label: 'Website Settings', icon: Settings }
      );
    }
    return base;
  }, [reportsList.length, isSuperAdmin]);

  return (
    <PageTransition>
      <SeoHead
        title="Admin Dashboard — ImageLab"
        description="Administrative moderation workspace for ImageLab."
        canonicalPath="/admin"
        noindex
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16 space-y-8">
        <div className="flex items-center justify-between gap-4">
          <BackButton fallbackTo="/" label="Back" />
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setOfficialError(null);
                setOfficialModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-xs font-semibold transition-colors min-h-[40px]"
            >
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              <span>Publish Official Prompt</span>
            </button>
            <Link
              to="/admin/ads"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-xs font-semibold transition-colors min-h-[40px]"
            >
              <Megaphone className="w-4 h-4" aria-hidden="true" />
              <span>Open Ads Manager</span>
            </Link>
          </div>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#2A9D8F] mb-1">
              ADMINISTRATION
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight text-[#264653]">
              Admin Dashboard
            </h1>
            <p className="text-sm text-[#264653]/75 mt-1">
              Complete administrative control over all public, ready-made, official, and contributor prompts, users, visual ads, and reports.
            </p>
          </div>
          {isSuperAdmin && (
            <Link
              to="/super-admin"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#264653] text-white text-xs font-semibold hover:bg-[#355C6B] transition-colors shrink-0"
            >
              <Shield className="w-4 h-4" aria-hidden="true" />
              <span>Super Admin Console</span>
            </Link>
          )}
        </div>

        {/* Simplified 3-Card Live Overview Statistics Strip */}
        <section
          aria-label="Platform Overview Metrics"
          className="grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          {[
            { label: 'Registered Users', value: metrics.registeredUsers, accent: 'text-[#264653]' },
            { label: 'Total Prompts', value: metrics.totalPrompts, accent: 'text-[#264653]' },
            { label: 'Active Ads', value: metrics.activeAds, accent: 'text-[#2A9D8F]' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/12 p-5 space-y-1 shadow-xs"
            >
              <p className="text-xs font-semibold text-[#264653]/65">
                {stat.label}
              </p>
              <p className={`text-3xl font-extrabold font-mono tabular-nums ${stat.accent}`}>
                {stat.value.toLocaleString()}
              </p>
            </div>
          ))}
        </section>

        {/* Admin Navigation Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 border-b border-[#264653]/10">
          {adminTabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 min-h-[42px] transition-colors ${
                  active
                    ? 'bg-[#264653] text-[#FAF7F2]'
                    : 'bg-[#FAF7F2] text-[#264653]/80 border border-[#264653]/12 hover:text-[#264653]'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: Unified All Prompts Management */}
        {tab === 'prompts' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <Search
                  className="w-4 h-4 text-[#264653]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={promptSearch}
                  onChange={(e) => setPromptSearch(e.target.value)}
                  placeholder="Search prompt title, @username, creator email, or Prompt ID..."
                  aria-label="Search all prompts"
                  className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-[#FAF7F2] border border-[#264653]/14 text-sm text-[#264653]"
                />
              </div>

              <select
                value={promptFilter}
                onChange={(e) => setPromptFilter(e.target.value as PromptFilter)}
                aria-label="Filter prompts"
                className="h-11 px-3.5 rounded-xl bg-[#FAF7F2] border border-[#264653]/14 text-sm text-[#264653]"
              >
                <option value="all">All prompts</option>
                <option value="official">Official ImageLab prompts</option>
                <option value="contributor">Contributor prompts</option>
                <option value="published">Published prompts</option>
                <option value="unpublished">Unpublished prompts</option>
              </select>
            </div>

            <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-[#264653]/10 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold text-[#264653]">
                  All Prompts ({filteredPrompts.length})
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setOfficialError(null);
                    setOfficialModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2A9D8F]/12 text-[#218175] hover:bg-[#2A9D8F] hover:text-white text-xs font-semibold transition-colors"
                >
                  <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Add Official Prompt</span>
                </button>
              </div>

              {filteredPrompts.length === 0 ? (
                <p className="p-10 text-sm text-[#264653]/65 text-center">
                  No prompts matched your search or filter.
                </p>
              ) : (
                <div className="divide-y divide-[#264653]/10">
                  {filteredPrompts.map((item) => {
                    const isPublished = item.status === 'approved';
                    const resolvedEmail =
                      item.authorEmail ||
                      userEmailByUid.get(item.authorUid) ||
                      (item.authorType === 'official' ? 'editorial@imagelab.app' : 'Unavailable');

                    return (
                      <div key={item.id} className="p-5 space-y-4">
                        <div className="flex flex-col sm:flex-row items-start gap-4">
                          <div className="w-24 h-24 rounded-xl overflow-hidden bg-[#E8DEC8] shrink-0">
                            <SafeImage
                              src={item.imageUrl}
                              alt={item.title}
                              className="w-full h-full object-cover"
                            />
                          </div>

                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-semibold ${
                                  isPublished
                                    ? 'bg-[#2A9D8F]/14 text-[#218175]'
                                    : 'bg-[#E76F51]/14 text-[#D05A3C]'
                                }`}
                              >
                                {isPublished ? 'Published' : 'Unpublished'}
                              </span>
                              <span className="text-[11px] font-semibold text-[#264653]/70">
                                {item.authorType === 'official'
                                  ? item.authorLabel || 'Official ImageLab'
                                  : 'Community Contributor'}
                              </span>
                            </div>

                            <h3 className="text-base font-bold text-[#264653]">
                              {item.title}
                            </h3>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-xs text-[#264653]/75">
                              <p>
                                Creator:{' '}
                                <strong className="text-[#2A9D8F]">
                                  @{item.authorUsername}
                                </strong>
                              </p>
                              <p className="truncate" title={resolvedEmail}>
                                Email: <strong>{resolvedEmail}</strong>
                              </p>
                              <p className="truncate font-mono text-[11px]" title={item.authorUid}>
                                UID: {item.authorUid || '—'}
                              </p>
                              <p>
                                Published: <strong>{formatDateDisplay(item.createdAt)}</strong>
                              </p>
                              <p className="truncate font-mono text-[11px] sm:col-span-2" title={item.id}>
                                Prompt ID: {item.id}
                              </p>
                            </div>

                            {item.promptText && (
                              <p className="font-sans font-normal text-xs leading-relaxed text-[#264653]/80 bg-[#F4EDE4]/80 px-3 py-2 rounded-lg line-clamp-2">
                                {item.promptText}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* All 7 Required Admin Management Buttons */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Link
                            to={`/prompt/${item.id}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#F4EDE4] hover:bg-[#E8DEC8] text-[#264653] text-xs font-semibold transition-colors min-h-[36px]"
                          >
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>View Prompt</span>
                          </Link>

                          <button
                            type="button"
                            onClick={() => openEditPromptModal(item, 'all')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#264653]/10 text-[#264653] hover:bg-[#264653] hover:text-white text-xs font-semibold transition-colors min-h-[36px]"
                          >
                            <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Edit Prompt</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditPromptModal(item, 'image')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#264653]/10 text-[#264653] hover:bg-[#264653] hover:text-white text-xs font-semibold transition-colors min-h-[36px]"
                          >
                            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Replace Image</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditPromptModal(item, 'title')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#264653]/10 text-[#264653] hover:bg-[#264653] hover:text-white text-xs font-semibold transition-colors min-h-[36px]"
                          >
                            <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Edit Title</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditPromptModal(item, 'prompt')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#264653]/10 text-[#264653] hover:bg-[#264653] hover:text-white text-xs font-semibold transition-colors min-h-[36px]"
                          >
                            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Edit Complete AI Prompt</span>
                          </button>

                          {isPublished ? (
                            <button
                              type="button"
                              onClick={() => setUnpublishTarget(item)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#E76F51]/12 text-[#D05A3C] hover:bg-[#E76F51] hover:text-white text-xs font-semibold transition-colors min-h-[36px]"
                            >
                              <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Unpublish</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handlePromptStatus(item.id, 'approved')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#2A9D8F]/14 text-[#218175] hover:bg-[#2A9D8F] hover:text-white text-xs font-semibold transition-colors min-h-[36px]"
                            >
                              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Republish</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setDeletePromptTarget(item)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#D05A3C]/12 text-[#D05A3C] hover:bg-[#D05A3C] hover:text-white text-xs font-semibold transition-colors min-h-[36px]"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Delete Permanently</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Users Directory */}
        {tab === 'users' && (
          <div className="space-y-4">
            <div className="relative max-w-md">
              <Search
                className="w-4 h-4 text-[#264653]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search users by name, @username, email, role..."
                aria-label="Search users"
                className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-[#FAF7F2] border border-[#264653]/14 text-sm text-[#264653]"
              />
            </div>

            <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden">
              <div className="p-6 border-b border-[#264653]/10">
                <h2 className="text-base font-bold text-[#264653]">
                  Registered Users ({filteredUsers.length})
                </h2>
              </div>
              <div className="divide-y divide-[#264653]/10">
                {filteredUsers.map((u) => (
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
                        {u.email} · Role: <strong>{u.role}</strong> · Status:{' '}
                        <span
                          className={
                            u.accountStatus === 'active'
                              ? 'text-[#2A9D8F] font-semibold'
                              : 'text-[#D05A3C] font-semibold'
                          }
                        >
                          {u.accountStatus}
                        </span>
                      </p>
                    </div>

                    {u.role === 'super_admin' ? (
                      <span className="text-xs font-semibold text-[#E76F51]">
                        Protected Super Admin
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleToggleUserStatus(u)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors min-h-[40px] ${
                          u.accountStatus === 'active'
                            ? 'bg-[#E76F51]/12 text-[#D05A3C] hover:bg-[#E76F51] hover:text-white'
                            : 'bg-[#2A9D8F]/12 text-[#218175] hover:bg-[#2A9D8F] hover:text-white'
                        }`}
                      >
                        {u.accountStatus === 'active' ? 'Suspend User' : 'Restore User'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Full Ads Manager Embedded */}
        {tab === 'ads' && (
          <AdsManagerWorkspace
            onCountChange={(counts) => setActiveAdsCount(counts.active)}
          />
        )}

        {/* TAB 4: Reports */}
        {tab === 'reports' && (
          <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden">
            <div className="p-6 border-b border-[#264653]/10">
              <h2 className="text-base font-bold text-[#264653]">
                Content Moderation Reports ({reportsList.length})
              </h2>
            </div>
            {reportsList.length === 0 ? (
              <p className="p-10 text-sm text-[#264653]/65 text-center">
                No moderation reports submitted right now.
              </p>
            ) : (
              <div className="divide-y divide-[#264653]/10">
                {reportsList.map((rep) => {
                  const targetPrompt = promptsList.find((p) => p.id === rep.promptId);
                  return (
                    <div
                      key={rep.id}
                      className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-[#E76F51]">
                          Status: {rep.status} · Prompt ID:{' '}
                          <span className="font-mono">{rep.promptId}</span>
                        </p>
                        <h3 className="text-sm font-bold text-[#264653]">
                          {targetPrompt ? targetPrompt.title : 'Referenced Prompt'}
                        </h3>
                        <p className="text-xs text-[#264653]/75">{rep.reason}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleReportStatus(rep.id, 'resolved')}
                          className="px-3 py-1.5 rounded-lg bg-[#2A9D8F]/12 text-[#218175] text-xs font-semibold"
                        >
                          Resolve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReportStatus(rep.id, 'dismissed')}
                          className="px-3 py-1.5 rounded-lg bg-[#264653]/10 text-[#264653] text-xs font-semibold"
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteReport(rep.id)}
                          className="px-3 py-1.5 rounded-lg bg-[#E76F51]/10 text-[#D05A3C] text-xs font-semibold"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 5 (Super Admin ONLY): Admin Management */}
        {tab === 'admin_management' && isSuperAdmin && (
          <section className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden">
            <div className="p-6 border-b border-[#264653]/10 flex items-center gap-2.5">
              <UserCog className="w-5 h-5 text-[#E76F51]" aria-hidden="true" />
              <h2 className="text-base font-bold text-[#264653]">
                Admin Management ({usersList.length} accounts)
              </h2>
            </div>

            <div className="divide-y divide-[#264653]/10">
              {usersList.map((u) => (
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
                        <span>Delete User</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* TAB 6 (Super Admin ONLY): Website Settings */}
        {tab === 'website_settings' && isSuperAdmin && (
          <form
            onSubmit={handleSaveSettings}
            className="max-w-xl rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-6 sm:p-8 space-y-5"
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
              className="px-6 h-11 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors"
            >
              Save Site Settings
            </button>
          </form>
        )}
      </div>

      {/* Edit Prompt Modal (Image, Image Title, Complete AI Generation Prompt, Status) */}
      {editingPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-prompt-modal-title"
          className="fixed inset-0 z-50 bg-[#264653]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-2xl rounded-3xl bg-[#FAF7F2] border border-[#264653]/15 shadow-2xl p-6 sm:p-8 my-8 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="edit-prompt-modal-title" className="text-xl font-bold text-[#264653]">
                  {editFocusTarget === 'image'
                    ? 'Replace Prompt Image'
                    : editFocusTarget === 'title'
                      ? 'Edit Title'
                      : editFocusTarget === 'prompt'
                        ? 'Edit Complete AI Prompt'
                        : 'Edit Prompt'}
                </h2>
                <p className="text-xs text-[#264653]/65">
                  Creator @{editingPrompt.authorUsername} and original creation date remain preserved.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingPrompt(null);
                  setEditPromptFile(null);
                }}
                aria-label="Close modal"
                className="p-2 rounded-xl text-[#264653]/70 hover:bg-[#F4EDE4]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePromptEdit} className="space-y-4">
              {/* Image Preview + Replace */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-2xl bg-[#F4EDE4]/70 border border-[#264653]/12">
                <div className="w-28 h-20 rounded-xl overflow-hidden bg-[#E8DEC8] shrink-0">
                  <SafeImage
                    src={editPromptForm.imageUrl}
                    alt={editPromptForm.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="space-y-2 flex-1">
                  <p className="text-xs font-bold text-[#264653]">Artwork Image</p>
                  <input
                    ref={editFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => handleEditFileChange(e.target.files?.[0])}
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

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">
                    Image Title
                  </label>
                  <input
                    ref={editTitleRef}
                    type="text"
                    required
                    value={editPromptForm.title}
                    onChange={(e) =>
                      setEditPromptForm((p) => ({ ...p, title: e.target.value }))
                    }
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">
                    Visibility
                  </label>
                  <select
                    value={editPromptForm.status === 'approved' ? 'approved' : 'unpublished'}
                    onChange={(e) =>
                      setEditPromptForm((p) => ({
                        ...p,
                        status: e.target.value as PromptStatus,
                      }))
                    }
                    className="w-full h-11 px-3 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 text-xs font-semibold"
                  >
                    <option value="approved">Published (Live)</option>
                    <option value="unpublished">Unpublished (Hidden)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1.5">
                  Complete AI Generation Prompt
                </label>
                <textarea
                  ref={editPromptRef}
                  rows={5}
                  required
                  value={editPromptForm.promptText}
                  onChange={(e) =>
                    setEditPromptForm((p) => ({ ...p, promptText: e.target.value }))
                  }
                  className="w-full p-3.5 rounded-xl bg-[#F4EDE4]/65 border border-[#264653]/15 font-sans font-normal text-sm leading-relaxed text-[#264653]"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#264653]/10">
                <button
                  type="button"
                  onClick={() => {
                    setEditingPrompt(null);
                    setEditPromptFile(null);
                  }}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPromptEdit}
                  className="px-5 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-sm font-semibold"
                >
                  {savingPromptEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Official Prompt Publish Modal */}
      {officialModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="official-prompt-modal-title"
          className="fixed inset-0 z-50 bg-[#264653]/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-xl rounded-3xl bg-[#FAF7F2] border border-[#264653]/15 shadow-2xl p-6 sm:p-8 my-8 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#E76F51]">Official ImageLab</p>
                <h2 id="official-prompt-modal-title" className="text-xl font-bold text-[#264653]">
                  Publish Official Prompt
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOfficialModalOpen(false)}
                aria-label="Close modal"
                className="p-2 rounded-xl text-[#264653]/70 hover:bg-[#F4EDE4]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {officialError && (
              <div
                role="alert"
                className="rounded-xl bg-[#E76F51]/10 border border-[#E76F51]/35 p-3.5 flex items-start gap-2 text-xs font-medium text-[#264653]"
              >
                <AlertCircle className="w-4 h-4 text-[#D05A3C] shrink-0 mt-0.5" />
                <span>{officialError}</span>
              </div>
            )}

            <form onSubmit={handlePublishOfficial} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1.5">
                  1. Upload Image *
                </label>
                <div
                  onClick={() => officialFileRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      officialFileRef.current?.click();
                    }
                  }}
                  className="rounded-2xl border-2 border-dashed border-[#264653]/20 bg-[#F4EDE4]/55 hover:border-[#2A9D8F] p-5 text-center cursor-pointer transition-colors"
                >
                  <input
                    ref={officialFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => handleOfficialFileChange(e.target.files?.[0])}
                    className="sr-only"
                  />
                  {officialPreview ? (
                    <img
                      src={officialPreview}
                      alt="Official artwork preview"
                      className="max-h-48 rounded-xl object-contain mx-auto"
                    />
                  ) : (
                    <div className="py-4 space-y-2 text-[#264653]/65">
                      <Upload className="w-6 h-6 mx-auto" aria-hidden="true" />
                      <p className="text-xs font-semibold">
                        Click to upload AI image (PNG, JPG, WebP)
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">
                    2. Image Title *
                  </label>
                  <input
                    type="text"
                    value={officialTitle}
                    onChange={(e) => setOfficialTitle(e.target.value)}
                    placeholder="Editorial artwork title"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/60 border border-[#264653]/15 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1.5">
                    Official Label
                  </label>
                  <input
                    type="text"
                    value={officialLabel}
                    onChange={(e) => setOfficialLabel(e.target.value)}
                    placeholder="ImageLab Official"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/60 border border-[#264653]/15 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1.5">
                  3. Complete AI Generation Prompt *
                </label>
                <textarea
                  rows={5}
                  value={officialPromptText}
                  onChange={(e) => setOfficialPromptText(e.target.value)}
                  placeholder="Paste the exact AI generation prompt..."
                  className="w-full p-3.5 rounded-xl bg-[#F4EDE4]/60 border border-[#264653]/15 font-sans font-normal text-sm leading-relaxed text-[#264653]"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#264653]/10">
                <button
                  type="button"
                  onClick={() => setOfficialModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={publishingOfficial}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-sm font-semibold"
                >
                  <ImagePlus className="w-4 h-4" />
                  <span>
                    {publishingOfficial ? 'Publishing...' : 'Publish Official Prompt'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unpublish Confirmation Modal */}
      {unpublishTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unpublish-confirm-title"
          className="fixed inset-0 z-50 bg-[#264653]/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#FAF7F2] border border-[#E76F51]/30 shadow-2xl p-6 space-y-4">
            <h3 id="unpublish-confirm-title" className="text-lg font-bold text-[#264653]">
              Unpublish Prompt
            </h3>
            <p className="text-sm text-[#264653]/80 leading-relaxed">
              Are you sure you want to unpublish <strong>{unpublishTarget.title}</strong>? It will immediately disappear from public Homepage, Explore, Trending, search results, and the XML sitemap, while staying saved in Firestore so you can republish it later.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setUnpublishTarget(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={unpublishing}
                onClick={handleConfirmUnpublish}
                className="px-5 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-sm font-semibold"
              >
                {unpublishing ? 'Unpublishing...' : 'Confirm Unpublish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Prompt Permanently Confirmation Modal */}
      {deletePromptTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-prompt-confirm-title"
          className="fixed inset-0 z-50 bg-[#264653]/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#FAF7F2] border border-[#E76F51]/30 shadow-2xl p-6 space-y-4">
            <h3 id="delete-prompt-confirm-title" className="text-lg font-bold text-[#264653]">
              Delete Prompt Permanently
            </h3>
            <p className="text-sm text-[#264653]/80 leading-relaxed">
              Are you sure you want to permanently remove{' '}
              <strong>{deletePromptTarget.title}</strong>? This deletes its Firestore document, uploaded Storage image, and saved/liked references permanently.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeletePromptTarget(null)}
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
    </PageTransition>
  );
}
