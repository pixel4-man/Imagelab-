import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  ensureAuthPersistence,
  googleProvider,
  isFirebaseConfigured,
  missingFirebaseConfigKeys,
} from '../lib/firebase';
import {
  friendlyAuthError,
  handleFirestoreError,
  OperationType,
} from '../lib/firestoreErrors';
import {
  buildSafeProfileFields,
  normalizeUsername,
  ProfileEnsureCoordinator,
} from '../lib/profileSync';
import {
  AccountStatus,
  getDashboardPathForRole,
  UserRole,
} from '../server/rbac';

export interface AuthUserProfile {
  uid: string;
  fullName: string;
  username: string;
  email: string;
  photoURL: string;
  bio: string;
  role: UserRole;
  accountStatus: AccountStatus;
  createdAt?: unknown;
  lastLoginAt?: unknown;
}

interface RegisterInput {
  fullName: string;
  username: string;
  email: string;
  password: string;
}

interface AuthResult {
  profile: AuthUserProfile;
  redirectTo: string;
  redirecting?: boolean;
}

interface AuthContextValue {
  firebaseUser: User | null;
  userProfile: AuthUserProfile | null;
  authReady: boolean;
  isConfigured: boolean;
  missingConfigKeys: string[];
  serverAdminConfigured: boolean | null;
  authError: string | null;
  clearAuthError: () => void;
  retrySessionSync: () => Promise<void>;
  registerWithEmail: (input: RegisterInput) => Promise<AuthResult>;
  loginWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult | null>;
  sendPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  updateOwnProfile: (updates: {
    fullName: string;
    username: string;
    bio: string;
    photoURL?: string;
  }) => Promise<void>;
  deleteOwnAccount: (currentPassword?: string) => Promise<void>;
  checkUsernameAvailable: (username: string) => Promise<boolean>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const profileCoordinator = new ProfileEnsureCoordinator<AuthUserProfile>();

const REVOKED_TOKEN_ERROR_CODES = new Set([
  'auth/user-token-expired',
  'auth/user-disabled',
  'auth/user-not-found',
  'auth/invalid-user-token',
]);

function getErrorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code)
    : '';
}

async function generateUniqueUsername(base: string, forceRandomSuffix = false): Promise<string> {
  if (!db) return 'creator';
  const cleaned = normalizeUsername(base).slice(0, 22) || 'creator';
  const padded = cleaned.length < 3 ? `${cleaned}lab` : cleaned;

  for (let attempt = forceRandomSuffix ? 1 : 0; attempt < 8; attempt++) {
    const candidate =
      attempt === 0
        ? padded
        : `${padded.slice(0, 20)}${Math.floor(100 + Math.random() * 899)}`;
    try {
      const snap = await getDoc(doc(db, 'usernames', candidate));
      if (!snap.exists()) {
        return candidate;
      }
    } catch {
      // Try next candidate
    }
  }
  return `user_${Date.now().toString().slice(-6)}`;
}

async function syncServerSession(user: User): Promise<{
  serverAdminConfigured: boolean;
  role?: UserRole;
  accountStatus?: AccountStatus;
  bootstrappedSuperAdmin?: boolean;
  claimsUpdated?: boolean;
  sessionRevoked?: boolean;
}> {
  const callEndpoint = async (forceRefresh: boolean) => {
    const token = await user.getIdToken(forceRefresh);
    return fetch('/api/auth/bootstrap-session', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  };

  try {
    let res = await callEndpoint(false);
    if (res.status === 401) {
      res = await callEndpoint(true);
      if (res.status === 401) {
        return { serverAdminConfigured: false, sessionRevoked: true };
      }
    }
    if (!res.ok) {
      return { serverAdminConfigured: false };
    }
    const data = await res.json();
    if (data.bootstrappedSuperAdmin || data.claimsUpdated) {
      await user.getIdToken(true).catch(() => {});
    }
    return data;
  } catch (err) {
    if (REVOKED_TOKEN_ERROR_CODES.has(getErrorCode(err))) {
      return { serverAdminConfigured: false, sessionRevoked: true };
    }
    return { serverAdminConfigured: false };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<AuthUserProfile | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(!isFirebaseConfigured);
  const [serverAdminConfigured, setServerAdminConfigured] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const loadedUidRef = useRef<string | null>(null);
  const unsubscribeProfileRef = useRef<(() => void) | null>(null);

  const clearAuthError = () => setAuthError(null);

  const attachProfileListener = (uid: string) => {
    if (!db || !auth) return;
    if (unsubscribeProfileRef.current) {
      unsubscribeProfileRef.current();
      unsubscribeProfileRef.current = null;
    }
    unsubscribeProfileRef.current = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as AuthUserProfile;
          if (data.accountStatus === 'suspended') {
            loadedUidRef.current = null;
            signOut(auth!).catch(() => {});
            setAuthError('Your account has been suspended.');
            setUserProfile(null);
          } else {
            setUserProfile(data);
          }
        }
      },
      (err) => {
        if (!auth?.currentUser || auth.currentUser.uid !== uid) {
          return;
        }
        handleFirestoreError(err, OperationType.GET, `users/${uid}`);
      }
    );
  };

  const ensureUserProfile = (
    user: User,
    customProfile?: { fullName?: string; username?: string }
  ): Promise<AuthUserProfile> => {
    return profileCoordinator.run(user.uid, async () => {
      if (!db || !auth) {
        throw new Error('Authentication storage is not configured.');
      }

      await ensureAuthPersistence();
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady().catch(() => {});
      }

      try {
        await user.getIdToken();
      } catch (tokenErr) {
        if (REVOKED_TOKEN_ERROR_CODES.has(getErrorCode(tokenErr))) {
          await signOut(auth).catch(() => {});
          throw new Error('Your session expired or was revoked. Please sign in again.');
        }
      }

      const userDocRef = doc(db, 'users', user.uid);
      let existingSnap;
      try {
        existingSnap = await getDoc(userDocRef);
      } catch (err) {
        if (getErrorCode(err) === 'permission-denied') {
          try {
            await user.getIdToken(true);
          } catch (refreshErr) {
            if (REVOKED_TOKEN_ERROR_CODES.has(getErrorCode(refreshErr))) {
              await signOut(auth).catch(() => {});
              throw new Error('Your session expired or was revoked. Please sign in again.');
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
          try {
            existingSnap = await getDoc(userDocRef);
          } catch (retryErr) {
            handleFirestoreError(retryErr, OperationType.GET, `users/${user.uid}`);
          }
        } else {
          handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
        }
      }

      const handleExistingProfile = async (
        existingData: AuthUserProfile
      ): Promise<AuthUserProfile> => {
        if (existingData.accountStatus === 'suspended') {
          await signOut(auth!);
          throw new Error('This account has been suspended. Please contact an administrator.');
        }

        try {
          await updateDoc(userDocRef, {
            lastLoginAt: serverTimestamp(),
          });
        } catch {
          // Non-fatal if timestamp update is skipped
        }

        const serverState = await syncServerSession(user);
        if (serverState.sessionRevoked) {
          await signOut(auth!);
          throw new Error('Your session expired or was revoked. Please sign in again.');
        }
        setServerAdminConfigured(serverState.serverAdminConfigured);

        let latestProfile = existingData;
        try {
          const refreshed =
            serverState.bootstrappedSuperAdmin || serverState.claimsUpdated
              ? await getDocFromServer(userDocRef)
              : await getDoc(userDocRef);
          if (refreshed.exists()) {
            latestProfile = refreshed.data() as AuthUserProfile;
          }
        } catch {
          // Keep existingData on cache fallback
        }

        if (serverState.serverAdminConfigured && serverState.role) {
          return {
            ...latestProfile,
            role: serverState.role,
            accountStatus: serverState.accountStatus || latestProfile.accountStatus,
          };
        }
        return latestProfile;
      };

      if (existingSnap && existingSnap.exists()) {
        return handleExistingProfile(existingSnap.data() as AuthUserProfile);
      }

      const pending = profileCoordinator.getPendingRegistration(
        user.email || user.providerData?.[0]?.email
      );
      const effectiveFullName = customProfile?.fullName ?? pending?.fullName;
      const effectiveUsername = customProfile?.username ?? pending?.username;

      const safeFields = buildSafeProfileFields({
        email: user.email,
        providerEmail: user.providerData?.[0]?.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        customFullName: effectiveFullName,
      });

      const isExplicitUsername = Boolean(effectiveUsername);
      let lastBatchErr: unknown = null;
      let createdProfile: AuthUserProfile | null = null;

      const maxAttempts = isExplicitUsername ? 1 : 3;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const desiredUsername = effectiveUsername
          ? normalizeUsername(effectiveUsername)
          : await generateUniqueUsername(safeFields.fullName, attempt > 0);

        const candidateProfile: AuthUserProfile = {
          uid: user.uid,
          fullName: safeFields.fullName,
          username: desiredUsername,
          email: safeFields.email,
          photoURL: safeFields.photoURL,
          bio: '',
          role: 'contributor',
          accountStatus: 'active',
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        };

        const batch = writeBatch(db);
        batch.set(doc(db, 'usernames', desiredUsername), {
          uid: user.uid,
          username: desiredUsername,
          createdAt: serverTimestamp(),
        });
        batch.set(userDocRef, candidateProfile);

        try {
          await batch.commit();
          createdProfile = candidateProfile;
          break;
        } catch (err) {
          lastBatchErr = err;
          // If the user profile was concurrently created (e.g., another tab or server), load and return it
          try {
            const recheck = await getDocFromServer(userDocRef);
            if (recheck.exists()) {
              return handleExistingProfile(recheck.data() as AuthUserProfile);
            }
          } catch {
            // Continue handling batch failure
          }
          // If an auto-generated username collided just before commit, retry with a fresh random suffix
          if (!isExplicitUsername && attempt + 1 < maxAttempts) {
            continue;
          }
        }
      }

      if (!createdProfile) {
        handleFirestoreError(lastBatchErr, OperationType.CREATE, `users/${user.uid}`);
      }

      profileCoordinator.clearPendingRegistration(safeFields.email);

      // Server-side Super Admin bootstrap check (e.g., adilwss67@gmail.com)
      const serverState = await syncServerSession(user);
      if (serverState.sessionRevoked) {
        await signOut(auth);
        throw new Error('Your session expired or was revoked. Please sign in again.');
      }
      setServerAdminConfigured(serverState.serverAdminConfigured);

      try {
        const refreshed =
          serverState.bootstrappedSuperAdmin || serverState.claimsUpdated
            ? await getDocFromServer(userDocRef)
            : await getDoc(userDocRef);
        if (refreshed.exists()) {
          const freshData = refreshed.data() as AuthUserProfile;
          if (serverState.serverAdminConfigured && serverState.role) {
            return {
              ...freshData,
              role: serverState.role,
              accountStatus: serverState.accountStatus || freshData.accountStatus,
            };
          }
          return freshData;
        }
      } catch {
        // Return newly created profile
      }
      if (serverState.serverAdminConfigured && serverState.role) {
        return {
          ...createdProfile,
          role: serverState.role,
          accountStatus: serverState.accountStatus || createdProfile.accountStatus,
        };
      }
      return createdProfile;
    });
  };

  useEffect(() => {
    if (!isFirebaseConfigured || !auth || !db) {
      setAuthReady(true);
      return;
    }

    let cancelled = false;
    let unsubscribeAuth: (() => void) | null = null;

    const initializeSession = async () => {
      await ensureAuthPersistence();
      if (cancelled || !auth) return;

      // Handle Google redirect sign-in result before finalizing initial auth readiness
      try {
        const redirectResult = await getRedirectResult(auth);
        if (!cancelled && redirectResult?.user) {
          const profile = await ensureUserProfile(redirectResult.user);
          if (!cancelled) {
            loadedUidRef.current = redirectResult.user.uid;
            setFirebaseUser(redirectResult.user);
            setUserProfile(profile);
            setAuthError(null);
            attachProfileListener(redirectResult.user.uid);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = friendlyAuthError(err);
          if (msg) setAuthError(msg);
        }
      }

      if (cancelled) return;

      unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
        if (cancelled) return;

        setFirebaseUser(user);

        if (!user) {
          if (unsubscribeProfileRef.current) {
            unsubscribeProfileRef.current();
            unsubscribeProfileRef.current = null;
          }
          loadedUidRef.current = null;
          setUserProfile(null);
          setAuthReady(true);
          return;
        }

        // Skip redundant re-bootstrap if profile & live listener for this UID are already active
        if (loadedUidRef.current === user.uid && unsubscribeProfileRef.current) {
          setAuthReady(true);
          return;
        }

        setAuthReady(false);
        try {
          const profile = await ensureUserProfile(user);
          if (cancelled || auth?.currentUser?.uid !== user.uid) return;

          loadedUidRef.current = user.uid;
          setUserProfile(profile);
          setAuthError(null);
          attachProfileListener(user.uid);
        } catch (err) {
          if (!cancelled) {
            setAuthError(friendlyAuthError(err));
          }
        } finally {
          if (!cancelled) {
            setAuthReady(true);
          }
        }
      });
    };

    initializeSession();

    return () => {
      cancelled = true;
      if (unsubscribeAuth) unsubscribeAuth();
      if (unsubscribeProfileRef.current) {
        unsubscribeProfileRef.current();
        unsubscribeProfileRef.current = null;
      }
    };
  }, []);

  const retrySessionSync = async (): Promise<void> => {
    if (!auth?.currentUser) return;
    setAuthError(null);
    setAuthReady(false);
    try {
      const profile = await ensureUserProfile(auth.currentUser);
      loadedUidRef.current = auth.currentUser.uid;
      setUserProfile(profile);
      attachProfileListener(auth.currentUser.uid);
    } catch (err) {
      setAuthError(friendlyAuthError(err));
    } finally {
      setAuthReady(true);
    }
  };

  const checkUsernameAvailable = async (rawUsername: string): Promise<boolean> => {
    if (!db) return true;
    const normalized = normalizeUsername(rawUsername);
    if (!/^[a-z0-9_]{3,30}$/.test(normalized)) return false;
    try {
      const snap = await getDoc(doc(db, 'usernames', normalized));
      return !snap.exists();
    } catch {
      return false;
    }
  };

  const registerWithEmail = async (input: RegisterInput): Promise<AuthResult> => {
    if (!auth || !db) {
      throw new Error('Authentication service is not configured yet.');
    }
    setAuthError(null);
    await ensureAuthPersistence();

    const normalizedUsername = normalizeUsername(input.username);
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
      throw new Error(
        'Username must be 3–30 characters using lowercase letters, numbers, or underscores.'
      );
    }

    // Prevent duplicate usernames before creating auth record
    const available = await checkUsernameAvailable(normalizedUsername);
    if (!available) {
      throw new Error('This username is already taken. Please choose another one.');
    }

    const trimmedEmail = input.email.trim();
    const trimmedName = input.fullName.trim();
    profileCoordinator.setPendingRegistration(trimmedEmail, {
      fullName: trimmedName,
      username: normalizedUsername,
    });

    let createdUser: User | null = null;
    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        trimmedEmail,
        input.password
      );
      createdUser = credential.user;
      await updateProfile(credential.user, {
        displayName: trimmedName,
      });

      const profile = await ensureUserProfile(credential.user, {
        fullName: trimmedName,
        username: normalizedUsername,
      });

      sendEmailVerification(credential.user).catch(() => {
        // Non-blocking verification email
      });

      loadedUidRef.current = credential.user.uid;
      setFirebaseUser(credential.user);
      setUserProfile(profile);
      attachProfileListener(credential.user.uid);
      return {
        profile,
        redirectTo: getDashboardPathForRole(profile.role),
      };
    } catch (err) {
      // Rollback auth user if Firestore profile/username write failed
      if (createdUser) {
        await deleteUser(createdUser).catch(() => {});
      }
      const message = friendlyAuthError(err);
      setAuthError(message);
      throw new Error(message);
    } finally {
      profileCoordinator.clearPendingRegistration(trimmedEmail);
    }
  };

  const loginWithEmail = async (email: string, password: string): Promise<AuthResult> => {
    if (!auth || !db) {
      throw new Error('Authentication service is not configured yet.');
    }
    setAuthError(null);
    await ensureAuthPersistence();
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const profile = await ensureUserProfile(credential.user);
      loadedUidRef.current = credential.user.uid;
      setFirebaseUser(credential.user);
      setUserProfile(profile);
      attachProfileListener(credential.user.uid);
      return {
        profile,
        redirectTo: getDashboardPathForRole(profile.role),
      };
    } catch (err) {
      const message = friendlyAuthError(err);
      setAuthError(message);
      throw new Error(message);
    }
  };

  const signInWithGoogle = async (): Promise<AuthResult | null> => {
    if (!auth || !db || !googleProvider) {
      throw new Error('Authentication service is not configured yet.');
    }
    setAuthError(null);
    await ensureAuthPersistence();

    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const profile = await ensureUserProfile(credential.user);
      loadedUidRef.current = credential.user.uid;
      setFirebaseUser(credential.user);
      setUserProfile(profile);
      attachProfileListener(credential.user.uid);
      return {
        profile,
        redirectTo: getDashboardPathForRole(profile.role),
      };
    } catch (err) {
      const code = getErrorCode(err);

      // Redirect fallback when popup is blocked or unsupported (common on Android mobile browsers)
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(auth, googleProvider);
        return null;
      }

      const message = friendlyAuthError(err);
      setAuthError(message);
      throw new Error(message);
    }
  };

  const sendPasswordReset = async (email: string): Promise<void> => {
    if (!auth) {
      throw new Error('Authentication service is not configured yet.');
    }
    await ensureAuthPersistence();
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }
  };

  const logout = async (): Promise<void> => {
    if (!auth) return;
    loadedUidRef.current = null;
    await signOut(auth);
    setFirebaseUser(null);
    setUserProfile(null);
    setAuthError(null);
  };

  const updateOwnProfile = async (updates: {
    fullName: string;
    username: string;
    bio: string;
    photoURL?: string;
  }): Promise<void> => {
    if (!db || !firebaseUser || !userProfile) {
      throw new Error('You must be signed in to update your profile.');
    }

    const nextUsername = normalizeUsername(updates.username);
    if (!/^[a-z0-9_]{3,30}$/.test(nextUsername)) {
      throw new Error(
        'Username must be 3–30 characters using lowercase letters, numbers, or underscores.'
      );
    }

    if (nextUsername !== userProfile.username) {
      const available = await checkUsernameAvailable(nextUsername);
      if (!available) {
        throw new Error('This username is already taken.');
      }
      const batch = writeBatch(db);
      batch.set(doc(db, 'usernames', nextUsername), {
        uid: firebaseUser.uid,
        username: nextUsername,
        createdAt: serverTimestamp(),
      });
      if (userProfile.username) {
        batch.delete(doc(db, 'usernames', userProfile.username));
      }
      batch.update(doc(db, 'users', firebaseUser.uid), {
        fullName: updates.fullName.trim().slice(0, 100),
        username: nextUsername,
        bio: updates.bio.trim().slice(0, 500),
        photoURL: (updates.photoURL ?? userProfile.photoURL).slice(0, 1000),
        lastLoginAt: serverTimestamp(),
      });
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    } else {
      try {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          fullName: updates.fullName.trim().slice(0, 100),
          bio: updates.bio.trim().slice(0, 500),
          photoURL: (updates.photoURL ?? userProfile.photoURL).slice(0, 1000),
          lastLoginAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    }

    await updateProfile(firebaseUser, {
      displayName: updates.fullName.trim(),
    }).catch(() => {});
  };

  const deleteOwnAccount = async (currentPassword?: string): Promise<void> => {
    if (!auth || !db || !firebaseUser || !userProfile) {
      throw new Error('No active account session found.');
    }
    if (userProfile.role === 'super_admin') {
      throw new Error('The Super Admin account cannot be self-deleted.');
    }

    try {
      const usesPassword = firebaseUser.providerData.some(
        (p) => p.providerId === 'password'
      );
      if (usesPassword && currentPassword && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
        await reauthenticateWithCredential(firebaseUser, cred);
      } else if (
        firebaseUser.providerData.some((p) => p.providerId === 'google.com') &&
        googleProvider
      ) {
        await reauthenticateWithPopup(firebaseUser, googleProvider);
      }

      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        // Fallback client-side cleanup when server Admin SDK credentials are not configured
        if (res.status === 503) {
          if (userProfile.username) {
            await deleteDoc(doc(db, 'usernames', userProfile.username)).catch(() => {});
          }
          await deleteDoc(doc(db, 'users', firebaseUser.uid));
          await deleteUser(firebaseUser);
        } else {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.error || 'Unable to delete account.');
        }
      }

      loadedUidRef.current = null;
      setFirebaseUser(null);
      setUserProfile(null);
    } catch (err) {
      throw new Error(friendlyAuthError(err));
    }
  };

  const getIdToken = async (): Promise<string | null> => {
    if (!firebaseUser) return null;
    return firebaseUser.getIdToken();
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userProfile,
        authReady,
        isConfigured: isFirebaseConfigured,
        missingConfigKeys: missingFirebaseConfigKeys,
        serverAdminConfigured,
        authError,
        clearAuthError,
        retrySessionSync,
        registerWithEmail,
        loginWithEmail,
        signInWithGoogle,
        sendPasswordReset,
        logout,
        updateOwnProfile,
        deleteOwnAccount,
        checkUsernameAvailable,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
