import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { CREATORS, INITIAL_PROMPTS } from '../data/prompts';
import { copyTextWithFallback } from '../lib/clipboard';
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
  clipboardErrorId: string | null;
  unlockedPrompts: Record<string, string>;
  toast: ToastState | null;
  activeUserProfile: CreatorProfile;
  getCreator: (username: string) => CreatorProfile;
  toggleLike: (id: string) => void;
  toggleSave: (id: string) => void;
  unlockPrompt: (id: string, options?: { silent?: boolean }) => Promise<string | null>;
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
  const [clipboardErrorId, setClipboardErrorId] = useState<string | null>(null);
  const [unlockedPrompts, setUnlockedPrompts] = useState<Record<string, string>>({});
  const unlockedPromptsRef = useRef<Record<string, string>>({});
  unlockedPromptsRef.current = unlockedPrompts;
  const inFlightUnlocksRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [activeUserProfile, setActiveUserProfile] = useState<CreatorProfile>(CREATORS.elenavance);
  const [likeDeltas, setLikeDeltas] = useState<Record<string, number>>({});
  const [copyDeltas, setCopyDeltas] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!firebaseUser) {
      setUnlockedPrompts({});
      setClipboardErrorId(null);
      inFlightUnlocksRef.current.clear();
    }
  }, [firebaseUser]);

  const refreshPublicPrompts = useCallback(async () => {
    try {
      const res = await fetch('/api/prompts/public', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { prompts?: PromptItem[]; seeded?: boolean };
      if (Array.isArray(data.prompts)) {
        const sanitized: PromptItem[] = data.prompts.map((item) => ({
          id: String(item.id),
          title: String(item.title || 'Untitled Artwork'),
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
        setFirestoreApprovedPrompts(() => {
          const mapped: PromptItem[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            const aspect = (['16:9', '4:3', '3:4', '1:1'].includes(d.aspectRatio)
              ? d.aspectRatio
              : '4:3') as PromptItem['aspectRatio'];

            return {
              id: docSnap.id,
              title: String(d.title || 'Untitled Artwork'),
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

  const unlockPrompt = useCallback(
    async (id: string, options: { silent?: boolean } = {}): Promise<string | null> => {
      const silent = Boolean(options.silent);
      if (!firebaseUser || !id) {
        return null;
      }

      const cached = unlockedPromptsRef.current[id];
      if (cached) {
        return cached;
      }

      const existingPromise = inFlightUnlocksRef.current.get(id);
      if (existingPromise) {
        return existingPromise;
      }

      const runUnlock = (async () => {
        try {
          const token = await getIdToken();
          if (!token) {
            if (!silent) {
              showToast('Please sign in again to unlock the full prompt.', 'terracotta');
            }
            return null;
          }

          let promptText = '';
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
          } else {
            if (!silent) {
              const payload = await res.json().catch(() => ({}));
              showToast(payload.error || 'Unable to unlock prompt right now.', 'terracotta');
            }
            return null;
          }

          if (!promptText) {
            if (!silent) {
              showToast('Prompt text is unavailable for this artwork.', 'terracotta');
            }
            return null;
          }

          setUnlockedPrompts((prev) =>
            prev[id] === promptText ? prev : { ...prev, [id]: promptText }
          );
          return promptText;
        } catch {
          if (!silent) {
            showToast('Unable to unlock prompt right now. Please try again.', 'terracotta');
          }
          return null;
        } finally {
          inFlightUnlocksRef.current.delete(id);
        }
      })();

      inFlightUnlocksRef.current.set(id, runUnlock);
      return runUnlock;
    },
    [firebaseUser, getIdToken]
  );

  const copyPrompt = useCallback(
    async (id: string): Promise<boolean> => {
      if (!firebaseUser) {
        return false;
      }

      setClipboardErrorId(null);

      // CRITICAL: Check cached prompt synchronously first so `navigator.clipboard.writeText`
      // starts immediately inside the click interaction before any `await` expires user activation.
      const cachedPrompt = unlockedPromptsRef.current[id] || '';
      const promptText = cachedPrompt || (await unlockPrompt(id, { silent: false })) || '';

      if (!promptText) {
        return false;
      }

      const result = await copyTextWithFallback(promptText);
      if (result.ok) {
        setClipboardErrorId(null);
        setCopiedId(id);
        setCopyDeltas((current) => ({
          ...current,
          [id]: (current[id] || 0) + 1,
        }));
        showToast('Prompt copied successfully!', 'teal');

        window.setTimeout(() => {
          setCopiedId((current) => (current === id ? null : current));
        }, 2400);
        return true;
      }

      setClipboardErrorId(id);
      showToast(
        'Automatic clipboard copy was blocked. Use the selectable prompt box below to copy manually.',
        'terracotta'
      );
      return false;
    },
    [firebaseUser, unlockPrompt]
  );

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
        clipboardErrorId,
        unlockedPrompts,
        toast,
        activeUserProfile,
        getCreator,
        toggleLike,
        toggleSave,
        unlockPrompt,
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
