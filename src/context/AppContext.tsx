import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { CREATORS, INITIAL_PROMPTS } from '../data/prompts';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { CreatorProfile, PromptItem } from '../types/prompt';

interface ToastState {
  id: number;
  message: string;
  tone: 'teal' | 'terracotta' | 'deep';
}

interface AppContextValue {
  prompts: PromptItem[];
  likedIds: string[];
  savedIds: string[];
  copiedId: string | null;
  toast: ToastState | null;
  activeUserProfile: CreatorProfile;
  getCreator: (username: string) => CreatorProfile;
  toggleLike: (id: string) => void;
  toggleSave: (id: string) => void;
  copyPrompt: (id: string) => Promise<boolean>;
  refreshPublicPrompts: () => Promise<void>;
  removePromptLocally: (id: string) => void;
  publishPrompt: (
    item: Omit<
      PromptItem,
      'id' | 'likes' | 'copies' | 'views' | 'createdAt' | 'trendingCollections' | 'creatorUsername'
    >
  ) => PromptItem;
  updateActiveUserProfile: (
    updates: Pick<CreatorProfile, 'displayName' | 'username' | 'bio' | 'role' | 'location'>
  ) => void;
  showToast: (message: string, tone?: ToastState['tone']) => void;
  dismissToast: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const STORAGE_LIKES_KEY = 'imagelab_liked_ids_v1';
const STORAGE_SAVES_KEY = 'imagelab_saved_ids_v1';

const OFFICIAL_CREATOR: CreatorProfile = {
  username: 'imagelab_official',
  displayName: 'ImageLab Editorial Studio',
  role: 'Official Curation',
  bio: 'Verified official prompts and visual reference studies curated by the ImageLab editorial team.',
  avatarUrl: '/src/assets/images/art_architectural_editorial_1794836298275.jpg',
  location: 'ImageLab Studio',
  followers: 1240,
  following: 18,
};

function toIsoDate(val: unknown): string {
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
  return new Date().toISOString().slice(0, 10);
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!ok) {
    throw new Error('Clipboard copy failed');
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, getIdToken } = useAuth();
  const [sessionPrompts, setSessionPrompts] = useState<PromptItem[]>([]);
  const [firestoreApprovedPrompts, setFirestoreApprovedPrompts] = useState<PromptItem[]>([]);
  const [publicHydrated, setPublicHydrated] = useState(false);
  const [likedIds, setLikedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_LIKES_KEY);
      return raw ? JSON.parse(raw) : ['travertine-solstice-atrium'];
    } catch {
      return ['travertine-solstice-atrium'];
    }
  });
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_SAVES_KEY);
      return raw ? JSON.parse(raw) : ['harbor-line-number-twelve', 'speckled-stoneware-carafe'];
    } catch {
      return ['harbor-line-number-twelve', 'speckled-stoneware-carafe'];
    }
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [activeUserProfile, setActiveUserProfile] = useState<CreatorProfile>(CREATORS.elenavance);
  const [likeDeltas, setLikeDeltas] = useState<Record<string, number>>({});
  const [copyDeltas, setCopyDeltas] = useState<Record<string, number>>({});

  const refreshPublicPrompts = useCallback(async () => {
    try {
      const res = await fetch('/api/prompts/public', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { prompts?: PromptItem[]; seeded?: boolean };
      if (Array.isArray(data.prompts)) {
        const sanitized: PromptItem[] = data.prompts.map((item) => ({
          id: String(item.id),
          title: String(item.title || 'Untitled Artwork'),
          promptText: typeof item.promptText === 'string' ? item.promptText : '',
          imageUrl: String(item.imageUrl || '/src/assets/images/art_digital_dreamscape_1794836302512.jpg'),
          aspectRatio: (['16:9', '4:3', '3:4', '1:1'].includes(item.aspectRatio)
            ? item.aspectRatio
            : '4:3') as PromptItem['aspectRatio'],
          creatorUsername: String(item.creatorUsername || 'contributor'),
          authorUid: typeof item.authorUid === 'string' ? item.authorUid : undefined,
          authorType: item.authorType === 'official' ? 'official' : 'contributor',
          authorLabel: typeof item.authorLabel === 'string' ? item.authorLabel : undefined,
          status: 'approved',
          likes: typeof item.likes === 'number' ? item.likes : 1,
          copies: typeof item.copies === 'number' ? item.copies : 0,
          views: typeof item.views === 'number' ? item.views : 1,
          createdAt: toIsoDate(item.createdAt),
          trendingCollections: Array.isArray(item.trendingCollections)
            ? item.trendingCollections
            : ['recent', 'today'],
        }));
        setFirestoreApprovedPrompts(sanitized);
        if (data.seeded) {
          setPublicHydrated(true);
        }
      }
    } catch {
      // Non-fatal fallback to seeded public metadata
    }
  }, []);

  // Load approved prompt gallery from server API
  useEffect(() => {
    refreshPublicPrompts();
  }, [refreshPublicPrompts]);

  // Subscribe cleanly to real-time approved prompt updates from Firestore
  useEffect(() => {
    if (!db) return;
    const approvedQuery = query(
      collection(db, 'prompts'),
      where('status', '==', 'approved')
    );
    const unsub = onSnapshot(
      approvedQuery,
      (snap) => {
        setFirestoreApprovedPrompts((prev) => {
          const prevTextMap = new Map(prev.map((p) => [p.id, p.promptText || '']));
          const mapped: PromptItem[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            const aspect = (['16:9', '4:3', '3:4', '1:1'].includes(d.aspectRatio)
              ? d.aspectRatio
              : '4:3') as PromptItem['aspectRatio'];

            return {
              id: docSnap.id,
              title: String(d.title || 'Untitled Artwork'),
              promptText:
                (typeof d.promptText === 'string' && d.promptText) ||
                prevTextMap.get(docSnap.id) ||
                '',
              imageUrl: String(d.imageUrl || '/src/assets/images/art_digital_dreamscape_1794836302512.jpg'),
              aspectRatio: aspect,
              creatorUsername: String(d.authorUsername || 'contributor'),
              authorUid: typeof d.authorUid === 'string' ? d.authorUid : undefined,
              authorType: d.authorType === 'official' ? 'official' : 'contributor',
              authorLabel: typeof d.authorLabel === 'string' ? d.authorLabel : undefined,
              status: 'approved',
              likes: typeof d.likes === 'number' ? d.likes : 1,
              copies: typeof d.copies === 'number' ? d.copies : 0,
              views: typeof d.views === 'number' ? d.views : 1,
              createdAt: toIsoDate(d.createdAt),
              trendingCollections: ['recent', 'today'],
            };
          });
          mapped.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          if (snap.docs.length > 0) {
            setPublicHydrated(true);
          }
          return mapped;
        });
      },
      () => {
        // Ignore transient offline errors; /api/prompts/public remains hydrated
      }
    );

    return () => unsub();
  }, [firebaseUser]);

  const prompts = useMemo(() => {
    const mergedMap = new Map<string, PromptItem>();
    for (const item of firestoreApprovedPrompts) {
      mergedMap.set(item.id, item);
    }
    for (const item of sessionPrompts) {
      if (item.status !== 'unpublished' && !mergedMap.has(item.id)) {
        mergedMap.set(item.id, item);
      }
    }
    if (!publicHydrated) {
      for (const item of INITIAL_PROMPTS) {
        if (!mergedMap.has(item.id)) {
          mergedMap.set(item.id, item);
        }
      }
    }

    return Array.from(mergedMap.values()).map((item) => ({
      ...item,
      likes: Math.max(0, item.likes + (likeDeltas[item.id] || 0)),
      copies: Math.max(0, item.copies + (copyDeltas[item.id] || 0)),
    }));
  }, [firestoreApprovedPrompts, sessionPrompts, publicHydrated, likeDeltas, copyDeltas]);

  const removePromptLocally = useCallback((id: string) => {
    setFirestoreApprovedPrompts((prev) => prev.filter((item) => item.id !== id));
    setSessionPrompts((prev) => prev.filter((item) => item.id !== id));
    setLikedIds((prev) => prev.filter((item) => item !== id));
    setSavedIds((prev) => prev.filter((item) => item !== id));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_LIKES_KEY, JSON.stringify(likedIds));
    } catch {
      // Ignore storage quota errors
    }
  }, [likedIds]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SAVES_KEY, JSON.stringify(savedIds));
    } catch {
      // Ignore storage quota errors
    }
  }, [savedIds]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string, tone: ToastState['tone'] = 'teal') => {
    setToast({ id: Date.now(), message, tone });
  };

  const dismissToast = () => setToast(null);

  const getCreator = (username: string): CreatorProfile => {
    if (username === 'imagelab_official') {
      return OFFICIAL_CREATOR;
    }
    if (username === activeUserProfile.username) {
      return activeUserProfile;
    }
    if (CREATORS[username]) {
      return CREATORS[username];
    }
    return {
      username,
      displayName: `@${username}`,
      role: 'Community Contributor',
      bio: 'ImageLab community creator sharing AI artwork and curated visual studies.',
      avatarUrl: '',
      location: 'ImageLab Community',
      followers: 0,
      following: 0,
    };
  };

  const toggleLike = (id: string) => {
    setLikedIds((prev) => {
      const alreadyLiked = prev.includes(id);
      setLikeDeltas((current) => ({
        ...current,
        [id]: (current[id] || 0) + (alreadyLiked ? -1 : 1),
      }));
      return alreadyLiked ? prev.filter((item) => item !== id) : [...prev, id];
    });
  };

  const toggleSave = (id: string) => {
    setSavedIds((prev) => {
      const alreadySaved = prev.includes(id);
      showToast(
        alreadySaved ? 'Removed from Saved Prompts' : 'Saved to your collection',
        alreadySaved ? 'deep' : 'teal'
      );
      return alreadySaved ? prev.filter((item) => item !== id) : [...prev, id];
    });
  };

  const copyPrompt = async (id: string): Promise<boolean> => {
    try {
      const target =
        prompts.find((item) => item.id === id) ||
        sessionPrompts.find((item) => item.id === id);
      let promptText = target?.promptText || '';

      if (!promptText) {
        try {
          const pubRes = await fetch(`/api/prompts/public/${encodeURIComponent(id)}`, {
            cache: 'no-store',
          });
          if (pubRes.ok) {
            const pubData = (await pubRes.json()) as { prompt?: PromptItem };
            if (typeof pubData.prompt?.promptText === 'string') {
              promptText = pubData.prompt.promptText;
            }
          }
        } catch {
          // Fallback below
        }
      }

      if (!promptText && firebaseUser) {
        const token = await getIdToken();
        if (token) {
          const res = await fetch(`/api/prompts/${encodeURIComponent(id)}/secret`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          });
          if (res.ok) {
            const data = (await res.json()) as { promptText?: string };
            promptText = typeof data.promptText === 'string' ? data.promptText : '';
          } else if (res.status === 503 && db) {
            const secretSnap = await getDoc(doc(db, 'promptSecrets', id));
            if (secretSnap.exists() && typeof secretSnap.data()?.promptText === 'string') {
              promptText = secretSnap.data().promptText;
            }
          }
        }
      }

      if (!promptText) {
        showToast('Prompt text is unavailable for this artwork.', 'terracotta');
        return false;
      }

      await writeTextToClipboard(promptText);
      setCopiedId(id);
      setCopyDeltas((current) => ({
        ...current,
        [id]: (current[id] || 0) + 1,
      }));
      showToast('Prompt copied!', 'teal');

      fetch(`/api/prompts/${encodeURIComponent(id)}/copy`, {
        method: 'POST',
      }).catch(() => {});

      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 2200);
      return true;
    } catch {
      showToast('Clipboard access blocked. Please allow clipboard permissions and try again.', 'terracotta');
      return false;
    }
  };

  const publishPrompt = (
    item: Omit<
      PromptItem,
      'id' | 'likes' | 'copies' | 'views' | 'createdAt' | 'trendingCollections' | 'creatorUsername'
    >
  ): PromptItem => {
    const slug = item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const newItem: PromptItem = {
      id: `${slug || 'creation'}-${Date.now()}`,
      title: item.title,
      promptText: item.promptText || '',
      imageUrl: item.imageUrl,
      aspectRatio: item.aspectRatio,
      authorUid: item.authorUid,
      authorType: item.authorType,
      authorLabel: item.authorLabel,
      status: item.status,
      creatorUsername: activeUserProfile.username,
      likes: 1,
      copies: 0,
      views: 1,
      createdAt: new Date().toISOString().slice(0, 10),
      trendingCollections: ['recent'],
      isSessionPublished: true,
    };
    setSessionPrompts((prev) => [newItem, ...prev]);
    setLikedIds((prev) => [...prev, newItem.id]);
    showToast('Prompt submitted', 'terracotta');
    return newItem;
  };

  const updateActiveUserProfile = (
    updates: Pick<CreatorProfile, 'displayName' | 'username' | 'bio' | 'role' | 'location'>
  ) => {
    const oldUsername = activeUserProfile.username;
    const cleanUsername = updates.username.toLowerCase().replace(/[^a-z0-9_]/g, '') || oldUsername;
    setActiveUserProfile((prev) => ({
      ...prev,
      ...updates,
      username: cleanUsername,
    }));
    if (cleanUsername !== oldUsername) {
      setSessionPrompts((prev) =>
        prev.map((p) =>
          p.creatorUsername === oldUsername ? { ...p, creatorUsername: cleanUsername } : p
        )
      );
    }
    showToast('Profile details updated', 'teal');
  };

  return (
    <AppContext.Provider
      value={{
        prompts,
        likedIds,
        savedIds,
        copiedId,
        toast,
        activeUserProfile,
        getCreator,
        toggleLike,
        toggleSave,
        copyPrompt,
        refreshPublicPrompts,
        removePromptLocally,
        publishPrompt,
        updateActiveUserProfile,
        showToast,
        dismissToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return ctx;
}
