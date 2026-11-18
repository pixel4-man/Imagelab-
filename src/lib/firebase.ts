import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  setPersistence,
} from 'firebase/auth';
import {
  doc,
  Firestore,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';
import appletConfig from '../../firebase-applet-config.json';

interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  firestoreDatabaseId?: string;
}

export const EXPECTED_FIREBASE_PROJECT_ID = 'imagelab-c612a';

const sanitizedEnvAuthDomain =
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN.includes(EXPECTED_FIREBASE_PROJECT_ID)
    ? import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
    : '';

const sanitizedEnvProjectId =
  import.meta.env.VITE_FIREBASE_PROJECT_ID === EXPECTED_FIREBASE_PROJECT_ID
    ? import.meta.env.VITE_FIREBASE_PROJECT_ID
    : '';

const resolvedConfig: FirebaseClientConfig = {
  apiKey: appletConfig.apiKey || '',
  authDomain: appletConfig.authDomain || sanitizedEnvAuthDomain || '',
  projectId: appletConfig.projectId || sanitizedEnvProjectId || '',
  storageBucket:
    appletConfig.storageBucket ||
    (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.includes(EXPECTED_FIREBASE_PROJECT_ID)
      ? import.meta.env.VITE_FIREBASE_STORAGE_BUCKET
      : '') ||
    '',
  messagingSenderId:
    appletConfig.messagingSenderId || import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: appletConfig.appId || import.meta.env.VITE_FIREBASE_APP_ID || '',
  firestoreDatabaseId:
    appletConfig.firestoreDatabaseId ||
    (import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID &&
    import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID !== '(default)' &&
    import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID !== 'default'
      ? import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID
      : '') ||
    '',
};

export const missingFirebaseConfigKeys: string[] = (
  ['apiKey', 'authDomain', 'projectId', 'appId'] as const
).filter((key) => !resolvedConfig[key]);

export const isFirebaseConfigured =
  missingFirebaseConfigKeys.length === 0 &&
  resolvedConfig.projectId === EXPECTED_FIREBASE_PROJECT_ID;
export const activeFirebaseProjectId = resolvedConfig.projectId;
export const activeFirestoreDatabaseId = resolvedConfig.firestoreDatabaseId || '(default)';
export const activeStorageBucket = resolvedConfig.storageBucket;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let googleProvider: GoogleAuthProvider | null = null;
let persistencePromise: Promise<void> | null = null;

export function ensureAuthPersistence(): Promise<void> {
  if (!auth) return Promise.resolve();
  if (!persistencePromise) {
    const authInstance = auth;
    const readyPromise =
      typeof authInstance.authStateReady === 'function'
        ? authInstance.authStateReady().catch(() => {})
        : Promise.resolve();

    persistencePromise = readyPromise
      .then(() => {
        if (typeof window !== 'undefined') {
          return setPersistence(authInstance, browserLocalPersistence);
        }
        return undefined;
      })
      .catch(() => {
        // Keep configured fallback persistence if browser storage blocks localStorage
      });
  }
  return persistencePromise;
}

async function testConnection(firestoreDb: Firestore, authInstance: Auth | null) {
  if (authInstance && typeof authInstance.authStateReady === 'function') {
    await authInstance.authStateReady().catch(() => {});
  }
  try {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
      } catch (retryError) {
        if (
          retryError instanceof Error &&
          retryError.message.includes('the client is offline')
        ) {
          console.error('Please check your Firebase configuration.');
        }
      }
    }
  }
}

if (isFirebaseConfigured) {
  app = getApps().length > 0 ? getApps()[0] : initializeApp(resolvedConfig);

  try {
    auth = initializeAuth(app, {
      persistence: [
        browserLocalPersistence,
        indexedDBLocalPersistence,
        browserSessionPersistence,
      ],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    auth = getAuth(app);
  }

  const targetDatabaseId =
    resolvedConfig.firestoreDatabaseId && resolvedConfig.firestoreDatabaseId !== '(default)'
      ? resolvedConfig.firestoreDatabaseId
      : undefined;

  try {
    db = targetDatabaseId
      ? initializeFirestore(app, { experimentalForceLongPolling: true }, targetDatabaseId)
      : initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch {
    db = targetDatabaseId ? getFirestore(app, targetDatabaseId) : getFirestore(app);
  }

  if (resolvedConfig.storageBucket) {
    storage = getStorage(app);
  }

  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({
    prompt: 'select_account',
  });

  // Validate initial Firestore connectivity after Auth readiness settles
  testConnection(db, auth);
}

export { app, auth, db, storage, googleProvider };
