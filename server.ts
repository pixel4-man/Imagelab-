import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { type App as AdminApp, cert, getApps, initializeApp as initializeAdminApp, type ServiceAccount } from 'firebase-admin/app';
import { type Auth as AdminAuth, type DecodedIdToken, getAuth as getAdminAuth } from 'firebase-admin/auth';
import { FieldValue, type Firestore as AdminFirestore, getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getStorage, type Storage as AdminStorage } from 'firebase-admin/storage';
import {
  type AccountStatus,
  DEFAULT_SUPER_ADMIN_EMAIL,
  isEligibleForSuperAdminBootstrap,
  type UserRole,
  validateAccountStatusChange,
  validateRoleTransition,
} from './src/server/rbac.ts';
import {
  type VisualPlacementRecord,
  normalizePageRoute,
  validateAdPayload,
  validatePlacementPayload,
} from './src/types/ads.ts';
import { SEEDED_PROMPT_SECRETS } from './src/server/seededPromptSecrets.ts';
import { READY_MADE_PROMPTS } from './src/server/seededPromptsData.ts';
import { buildAllowedOrigins, isOriginAllowed } from './src/server/cors.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AppletConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
}

function loadAppletConfig(): AppletConfig {
  try {
    const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AppletConfig;
    }
  } catch {
    // Fallback to env vars
  }
  return {};
}

const EXPECTED_FIREBASE_PROJECT_ID = 'imagelab-c612a';

interface ParsedServiceAccount extends ServiceAccount {
  project_id?: string;
}

function parseServiceAccount(): { account: ParsedServiceAccount | null; parseError: string | null } {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return { account: null, parseError: null };
  try {
    const jsonString = raw.startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf-8');
    const parsed = JSON.parse(jsonString) as ParsedServiceAccount;
    return { account: parsed, parseError: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON format:', msg);
    return { account: null, parseError: 'Invalid FIREBASE_SERVICE_ACCOUNT_JSON format.' };
  }
}

function loadGoogleApplicationCredentialsProjectId(): string | null {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credPath) return null;
  try {
    if (fs.existsSync(credPath)) {
      const parsed = JSON.parse(fs.readFileSync(credPath, 'utf-8')) as { project_id?: string };
      return parsed.project_id || null;
    }
  } catch {
    return null;
  }
  return null;
}

const appletConfig = loadAppletConfig();
const PROJECT_ID =
  appletConfig.projectId ||
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  EXPECTED_FIREBASE_PROJECT_ID;
const FIRESTORE_DATABASE_ID =
  appletConfig.firestoreDatabaseId ||
  process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
  (process.env.FIREBASE_FIRESTORE_DATABASE_ID &&
  process.env.FIREBASE_FIRESTORE_DATABASE_ID !== 'default'
    ? process.env.FIREBASE_FIRESTORE_DATABASE_ID
    : '') ||
  '(default)';
const SUPER_ADMIN_EMAIL =
  process.env.SUPER_ADMIN_EMAIL?.trim() || DEFAULT_SUPER_ADMIN_EMAIL;

const STORAGE_BUCKET =
  appletConfig.storageBucket ||
  process.env.FIREBASE_STORAGE_BUCKET ||
  process.env.VITE_FIREBASE_STORAGE_BUCKET ||
  'imagelab-c612a.firebasestorage.app';

const { account: serviceAccount, parseError: serviceAccountParseError } = parseServiceAccount();
let adminApp: AdminApp | null = null;
let adminAuth: AdminAuth | null = null;
let adminDb: AdminFirestore | null = null;
let adminStorage: AdminStorage | null = null;
let hasAdminCredentials = false;
let adminConfigError: string | null = serviceAccountParseError;

if (PROJECT_ID !== EXPECTED_FIREBASE_PROJECT_ID) {
  adminConfigError = `Configured Firebase project ID "${PROJECT_ID}" does not match required project "${EXPECTED_FIREBASE_PROJECT_ID}".`;
  console.error(adminConfigError);
} else if (serviceAccount) {
  const saProjectId = serviceAccount.project_id || serviceAccount.projectId || '';
  if (saProjectId !== EXPECTED_FIREBASE_PROJECT_ID) {
    adminConfigError = `FIREBASE_SERVICE_ACCOUNT_JSON belongs to project "${saProjectId || 'unknown'}" instead of "${EXPECTED_FIREBASE_PROJECT_ID}". Refusing to initialize Admin SDK.`;
    console.error(adminConfigError);
  } else {
    try {
      adminApp =
        getApps().length > 0
          ? getApps()[0]
          : initializeAdminApp({
              credential: cert(serviceAccount),
              projectId: PROJECT_ID,
              storageBucket: STORAGE_BUCKET,
            });
      hasAdminCredentials = true;
    } catch (err) {
      adminConfigError = err instanceof Error ? err.message : 'Firebase Admin initialization error.';
      console.error('Firebase Admin initialization error:', adminConfigError);
    }
  }
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const gacProjectId = loadGoogleApplicationCredentialsProjectId();
  if (gacProjectId && gacProjectId !== EXPECTED_FIREBASE_PROJECT_ID) {
    adminConfigError = `GOOGLE_APPLICATION_CREDENTIALS belongs to project "${gacProjectId}" instead of "${EXPECTED_FIREBASE_PROJECT_ID}". Refusing to initialize Admin SDK.`;
    console.error(adminConfigError);
  } else if (gacProjectId === EXPECTED_FIREBASE_PROJECT_ID) {
    try {
      adminApp =
        getApps().length > 0
          ? getApps()[0]
          : initializeAdminApp({
              projectId: PROJECT_ID,
              storageBucket: STORAGE_BUCKET,
            });
      hasAdminCredentials = true;
    } catch (err) {
      adminConfigError = err instanceof Error ? err.message : 'Firebase Admin initialization error.';
      console.error('Firebase Admin initialization error:', adminConfigError);
    }
  }
} else {
  // No service account JSON configured: initialize project-scoped app for ID token verification only
  try {
    adminApp =
      getApps().length > 0
        ? getApps()[0]
        : initializeAdminApp({
            projectId: PROJECT_ID,
            storageBucket: STORAGE_BUCKET,
          });
  } catch (err) {
    adminConfigError = err instanceof Error ? err.message : 'Firebase Admin initialization error.';
  }
}

if (adminApp) {
  adminAuth = getAdminAuth(adminApp);
  if (hasAdminCredentials) {
    adminDb =
      FIRESTORE_DATABASE_ID &&
      FIRESTORE_DATABASE_ID !== '(default)' &&
      FIRESTORE_DATABASE_ID !== 'default'
        ? getAdminFirestore(adminApp, FIRESTORE_DATABASE_ID)
        : getAdminFirestore(adminApp);
    try {
      adminStorage = getStorage(adminApp);
    } catch {
      adminStorage = null;
    }
  }
}

async function bootstrapInitialSuperAdmin(): Promise<void> {
  if (!adminAuth || !adminDb || !hasAdminCredentials) return;
  try {
    const userRecord = await adminAuth.getUserByEmail(SUPER_ADMIN_EMAIL);
    if (!userRecord.emailVerified) {
      return;
    }
    const userRef = adminDb.collection('users').doc(userRecord.uid);
    const snap = await userRef.get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.role !== 'super_admin' || data.accountStatus !== 'active') {
        await userRef.update({
          role: 'super_admin',
          accountStatus: 'active',
        });
      }
    } else {
      const fallbackUsername =
        (userRecord.email?.split('@')[0] || 'superadmin')
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '')
          .slice(0, 24) || 'superadmin';
      const usernameRef = adminDb.collection('usernames').doc(fallbackUsername);
      const usernameSnap = await usernameRef.get();
      if (!usernameSnap.exists) {
        await usernameRef.set({
          uid: userRecord.uid,
          username: fallbackUsername,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await userRef.set({
        uid: userRecord.uid,
        fullName: userRecord.displayName || 'ImageLab Super Admin',
        username: fallbackUsername,
        email: userRecord.email || SUPER_ADMIN_EMAIL,
        photoURL: userRecord.photoURL || '',
        bio: 'ImageLab Platform Super Administrator',
        role: 'super_admin',
        accountStatus: 'active',
        createdAt: FieldValue.serverTimestamp(),
        lastLoginAt: FieldValue.serverTimestamp(),
      });
    }
    await adminAuth.setCustomUserClaims(userRecord.uid, { role: 'super_admin' });
  } catch {
    // Super Admin account has not registered yet or Admin SDK credentials unavailable
  }
}

async function syncPromptSecretsToPrompts(): Promise<void> {
  if (!adminDb || !hasAdminCredentials) return;
  try {
    const [promptsSnap, secretsSnap, deletedSnap] = await Promise.all([
      adminDb.collection('prompts').get(),
      adminDb.collection('promptSecrets').get(),
      adminDb.collection('deletedPrompts').get(),
    ]);

    const existingPromptIds = new Set(promptsSnap.docs.map((d) => d.id));
    const deletedPromptIds = new Set(deletedSnap.docs.map((d) => d.id));
    const secretMap = new Map<string, string>();
    for (const sDoc of secretsSnap.docs) {
      const txt = sDoc.data()?.promptText;
      if (typeof txt === 'string' && txt.trim()) {
        secretMap.set(sDoc.id, txt.trim());
      }
    }

    // Seed any missing ready-made prompts into Firestore unless permanently deleted by an Admin
    for (const seed of READY_MADE_PROMPTS) {
      if (existingPromptIds.has(seed.id) || deletedPromptIds.has(seed.id)) continue;
      const seedDate = new Date(`${seed.createdAt}T12:00:00.000Z`);
      const batch = adminDb.batch();
      batch.set(adminDb.collection('prompts').doc(seed.id), {
        id: seed.id,
        title: seed.title,
        promptText: seed.promptText || '',
        imageUrl: seed.imageUrl,
        aspectRatio: seed.aspectRatio,
        authorUid: 'imagelab_official',
        authorUsername: seed.creatorUsername,
        authorType: 'official',
        authorLabel: seed.authorLabel || 'Ready-Made Showcase',
        status: 'approved',
        likes: seed.likes,
        copies: seed.copies,
        views: seed.views,
        createdAt: seedDate,
        updatedAt: seedDate,
      });
      if (seed.promptText) {
        batch.set(adminDb.collection('promptSecrets').doc(seed.id), {
          id: seed.id,
          promptText: seed.promptText,
          authorUid: 'imagelab_official',
          createdAt: seedDate,
          updatedAt: seedDate,
        });
      }
      await batch.commit();
      existingPromptIds.add(seed.id);
    }

    for (const docSnap of promptsSnap.docs) {
      const data = docSnap.data() || {};
      const currentPromptText =
        typeof data.promptText === 'string' ? data.promptText.trim() : '';
      const secretText = secretMap.get(docSnap.id) || '';

      if (!currentPromptText && secretText) {
        await docSnap.ref.update({
          promptText: secretText,
        });
      } else if (currentPromptText && !secretText) {
        await adminDb.collection('promptSecrets').doc(docSnap.id).set({
          id: docSnap.id,
          promptText: currentPromptText,
          authorUid:
            typeof data.authorUid === 'string' && data.authorUid
              ? data.authorUid
              : 'legacy',
          createdAt: data.createdAt || FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  } catch (err) {
    console.warn(
      'Prompt sync & ready-made seeding skipped:',
      err instanceof Error ? err.message : err
    );
  }
}

function extractStorageObjectPath(imageUrl: string): string | null {
  if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.startsWith('/')) {
    return null;
  }
  try {
    if (imageUrl.startsWith('gs://')) {
      const prefix = `gs://${STORAGE_BUCKET}/`;
      return imageUrl.startsWith(prefix) ? imageUrl.slice(prefix.length) : null;
    }
    const parsed = new URL(imageUrl);
    if (
      parsed.hostname === 'firebasestorage.googleapis.com' &&
      parsed.pathname.includes(`/b/${STORAGE_BUCKET}/o/`)
    ) {
      const encoded = parsed.pathname.split(`/b/${STORAGE_BUCKET}/o/`)[1];
      return encoded ? decodeURIComponent(encoded) : null;
    }
    if (
      parsed.hostname === 'storage.googleapis.com' &&
      parsed.pathname.startsWith(`/${STORAGE_BUCKET}/`)
    ) {
      return decodeURIComponent(parsed.pathname.slice(`/${STORAGE_BUCKET}/`.length));
    }
  } catch {
    return null;
  }
  return null;
}

async function deleteStorageFileIfOwned(imageUrl: string): Promise<void> {
  if (!adminStorage) return;
  const storagePath = extractStorageObjectPath(imageUrl);
  if (!storagePath) return;
  try {
    await adminStorage.bucket(STORAGE_BUCKET).file(storagePath).delete({ ignoreNotFound: true });
  } catch {
    // Non-fatal: external or already-deleted storage object
  }
}

async function deletePromptCompletely(
  promptId: string,
  deletedByUid: string
): Promise<{ found: boolean }> {
  if (!adminDb) return { found: false };
  const promptRef = adminDb.collection('prompts').doc(promptId);
  const secretRef = adminDb.collection('promptSecrets').doc(promptId);
  const snap = await promptRef.get();
  if (!snap.exists) {
    return { found: false };
  }

  const data = snap.data() || {};
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : '';
  if (imageUrl) {
    await deleteStorageFileIfOwned(imageUrl);
  }

  const [reportsSnap, usersLikedSnap, usersSavedSnap] = await Promise.all([
    adminDb.collection('reports').where('promptId', '==', promptId).get().catch(() => null),
    adminDb.collection('users').where('likedIds', 'array-contains', promptId).get().catch(() => null),
    adminDb.collection('users').where('savedIds', 'array-contains', promptId).get().catch(() => null),
  ]);

  const batch = adminDb.batch();
  batch.set(adminDb.collection('deletedPrompts').doc(promptId), {
    id: promptId,
    deletedByUid,
    originalAuthorUid: typeof data.authorUid === 'string' ? data.authorUid : '',
    originalTitle: typeof data.title === 'string' ? data.title.slice(0, 120) : '',
    deletedAt: FieldValue.serverTimestamp(),
  });
  batch.delete(promptRef);
  batch.delete(secretRef);

  if (reportsSnap) {
    for (const rDoc of reportsSnap.docs) {
      batch.delete(rDoc.ref);
    }
  }
  if (usersLikedSnap) {
    for (const uDoc of usersLikedSnap.docs) {
      batch.update(uDoc.ref, { likedIds: FieldValue.arrayRemove(promptId) });
    }
  }
  if (usersSavedSnap) {
    for (const uDoc of usersSavedSnap.docs) {
      batch.update(uDoc.ref, { savedIds: FieldValue.arrayRemove(promptId) });
    }
  }

  await batch.commit();
  return { found: true };
}

interface AuthenticatedRequest extends Request {
  authUser?: DecodedIdToken;
  actorRole?: UserRole;
  actorStatus?: AccountStatus;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function requireAuthToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!adminAuth) {
    res.status(503).json({ error: 'Authentication verification service unavailable.' });
    return;
  }
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication token required.' });
    return;
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token, hasAdminCredentials);
    req.authUser = decoded;
    next();
  } catch (err) {
    const errCode =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    res.status(401).json({
      error: 'Invalid, revoked, or expired authentication session.',
      code:
        errCode === 'auth/id-token-revoked' || errCode === 'auth/user-disabled'
          ? 'session-revoked'
          : 'invalid-token',
    });
  }
}

async function requireRole(allowedRoles: UserRole[]) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!adminDb || !hasAdminCredentials) {
      res.status(503).json({
        error: 'Server Admin SDK credentials are not configured.',
        missing: ['FIREBASE_SERVICE_ACCOUNT_JSON'],
      });
      return;
    }
    if (req.authUser.email_verified !== true) {
      res.status(403).json({ error: 'Verified email required for administrative access.' });
      return;
    }
    try {
      const userSnap = await adminDb.collection('users').doc(req.authUser.uid).get();
      if (!userSnap.exists) {
        res.status(403).json({ error: 'User profile not found.' });
        return;
      }
      const data = userSnap.data() || {};
      const role = data.role as UserRole;
      const status = (data.accountStatus as AccountStatus) || 'active';
      if (status !== 'active') {
        res.status(403).json({ error: 'This account has been suspended.' });
        return;
      }
      if (!allowedRoles.includes(role)) {
        res.status(403).json({ error: 'Insufficient permissions for this action.' });
        return;
      }
      req.actorRole = role;
      req.actorStatus = status;
      next();
    } catch {
      res.status(500).json({ error: 'Unable to verify user permissions.' });
    }
  };
}

async function startServer() {
  await bootstrapInitialSuperAdmin();
  await syncPromptSecretsToPrompts();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  const allowedOrigins = buildAllowedOrigins({
    allowedOrigins: process.env.ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS,
    appUrl: process.env.APP_URL,
    siteUrl: process.env.PUBLIC_SITE_URL || process.env.VITE_SITE_URL,
    nodeEnv: process.env.NODE_ENV,
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const originHeader = req.headers.origin;
    const resolution = isOriginAllowed(originHeader, allowedOrigins);

    if (originHeader && resolution.allowed && resolution.allowOriginHeader) {
      res.setHeader('Access-Control-Allow-Origin', resolution.allowOriginHeader);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Cache-Control');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS') {
      if (originHeader && !resolution.allowed) {
        res.status(403).json({ error: 'Origin not allowed by CORS policy.' });
        return;
      }
      res.status(204).end();
      return;
    }

    if (originHeader && !resolution.allowed && req.path.startsWith('/api/')) {
      res.status(403).json({ error: 'Origin not allowed by CORS policy.' });
      return;
    }

    next();
  });

  const buildHealthPayload = () => ({
    ok: true,
    status: 'healthy',
    service: 'imagelab-api',
    environment: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    projectId: PROJECT_ID,
    expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    projectMatch: PROJECT_ID === EXPECTED_FIREBASE_PROJECT_ID,
    firestoreDatabaseId: FIRESTORE_DATABASE_ID,
    storageBucket: STORAGE_BUCKET,
    projectConfigured: Boolean(PROJECT_ID),
    serverAdminConfigured: hasAdminCredentials,
    corsConfigured: allowedOrigins.length > 0,
    adminConfigError,
  });

  // Health check endpoints (safe metadata only, never exposes secrets)
  app.get('/api/health', (_req, res) => {
    res.json(buildHealthPayload());
  });
  app.get('/health', (_req, res) => {
    res.json(buildHealthPayload());
  });

  // Server-side session & Super Admin bootstrap check
  app.post(
    '/api/auth/bootstrap-session',
    requireAuthToken,
    async (req: AuthenticatedRequest, res: Response) => {
      const decoded = req.authUser!;
      if (!adminDb || !adminAuth || !hasAdminCredentials) {
        res.json({
          serverAdminConfigured: false,
          tokenVerified: true,
          uid: decoded.uid,
          bootstrappedSuperAdmin: false,
          claimsUpdated: false,
          missing: ['FIREBASE_SERVICE_ACCOUNT_JSON'],
        });
        return;
      }

      try {
        const userRef = adminDb.collection('users').doc(decoded.uid);
        const userSnap = await userRef.get();
        const eligibleSuperAdmin = isEligibleForSuperAdminBootstrap(
          decoded.email,
          decoded.email_verified,
          SUPER_ADMIN_EMAIL
        );

        let role: UserRole = 'contributor';
        let accountStatus: AccountStatus = 'active';
        let claimsUpdated = false;

        if (userSnap.exists) {
          const data = userSnap.data() || {};
          role = (data.role as UserRole) || 'contributor';
          accountStatus = (data.accountStatus as AccountStatus) || 'active';

          if (eligibleSuperAdmin && role !== 'super_admin') {
            role = 'super_admin';
            accountStatus = 'active';
            await userRef.update({
              role: 'super_admin',
              accountStatus: 'active',
              lastLoginAt: FieldValue.serverTimestamp(),
            });
            await adminAuth.setCustomUserClaims(decoded.uid, { role: 'super_admin' });
            claimsUpdated = true;
          } else {
            await userRef.update({
              lastLoginAt: FieldValue.serverTimestamp(),
            });
            if (decoded.role !== role) {
              await adminAuth.setCustomUserClaims(decoded.uid, { role });
              claimsUpdated = true;
            }
          }
        } else if (eligibleSuperAdmin) {
          role = 'super_admin';
          const baseUsername =
            (decoded.email?.split('@')[0] || 'superadmin')
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, '')
              .slice(0, 24) || 'superadmin';
          const usernameRef = adminDb.collection('usernames').doc(baseUsername);
          const usernameSnap = await usernameRef.get();
          if (!usernameSnap.exists) {
            await usernameRef.set({
              uid: decoded.uid,
              username: baseUsername,
              createdAt: FieldValue.serverTimestamp(),
            });
          }
          const safeDisplayName =
            typeof decoded.name === 'string' && decoded.name.trim().length >= 2
              ? decoded.name.trim().slice(0, 100)
              : 'ImageLab Super Admin';
          await userRef.set({
            uid: decoded.uid,
            fullName: safeDisplayName,
            username: baseUsername,
            email: decoded.email || SUPER_ADMIN_EMAIL,
            photoURL: decoded.picture || '',
            bio: 'ImageLab Platform Super Administrator',
            role: 'super_admin',
            accountStatus: 'active',
            createdAt: FieldValue.serverTimestamp(),
            lastLoginAt: FieldValue.serverTimestamp(),
          });
          await adminAuth.setCustomUserClaims(decoded.uid, { role: 'super_admin' });
          claimsUpdated = true;
        }

        res.json({
          serverAdminConfigured: true,
          tokenVerified: true,
          uid: decoded.uid,
          role,
          accountStatus,
          bootstrappedSuperAdmin: eligibleSuperAdmin,
          claimsUpdated,
        });
      } catch (err) {
        console.error('Bootstrap session error:', err instanceof Error ? err.message : err);
        res.status(500).json({ error: 'Unable to synchronize account session.' });
      }
    }
  );

  // Self-service account deletion (cleans Firestore profile, username reservation, and Firebase Auth)
  app.post(
    '/api/auth/delete-account',
    requireAuthToken,
    async (req: AuthenticatedRequest, res: Response) => {
      const decoded = req.authUser!;
      if (!adminDb || !adminAuth || !hasAdminCredentials) {
        res.status(503).json({
          error: 'Server Admin SDK credentials are required to delete accounts cleanly.',
          missing: ['FIREBASE_SERVICE_ACCOUNT_JSON'],
        });
        return;
      }

      try {
        const userRef = adminDb.collection('users').doc(decoded.uid);
        const snap = await userRef.get();
        if (snap.exists) {
          const data = snap.data() || {};
          if (data.role === 'super_admin') {
            res.status(403).json({
              error: 'The primary Super Admin account cannot be self-deleted.',
            });
            return;
          }
          if (typeof data.username === 'string' && data.username) {
            const usernameRef = adminDb.collection('usernames').doc(data.username);
            const usernameSnap = await usernameRef.get();
            if (usernameSnap.exists && usernameSnap.data()?.uid === decoded.uid) {
              await usernameRef.delete();
            }
          }
          await userRef.delete();
        }
        await adminAuth.deleteUser(decoded.uid);
        res.json({ deleted: true });
      } catch (err) {
        console.error('Account deletion error:', err instanceof Error ? err.message : err);
        res.status(500).json({ error: 'Unable to delete account right now.' });
      }
    }
  );

  // Admin & Super Admin overview
  const adminGuard = await requireRole(['admin', 'super_admin']);
  const superAdminGuard = await requireRole(['super_admin']);

  app.get(
    '/api/admin/users',
    requireAuthToken,
    adminGuard,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const snap = await adminDb!.collection('users').limit(200).get();
        const users = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            uid: docSnap.id,
            fullName: d.fullName || '',
            username: d.username || '',
            email: d.email || '',
            photoURL: d.photoURL || '',
            role: d.role || 'contributor',
            accountStatus: d.accountStatus || 'active',
          };
        });
        res.json({ users });
      } catch {
        res.status(500).json({ error: 'Failed to load user directory.' });
      }
    }
  );

  // Admin: update account status (cannot touch super_admin)
  app.patch(
    '/api/admin/users/:targetUid/status',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const targetUid = String(req.params.targetUid || '');
      const nextStatus = req.body?.accountStatus as AccountStatus;
      if (nextStatus !== 'active' && nextStatus !== 'suspended') {
        res.status(400).json({ error: 'Invalid accountStatus value.' });
        return;
      }

      try {
        const targetRef = adminDb!.collection('users').doc(targetUid);
        const targetSnap = await targetRef.get();
        if (!targetSnap.exists) {
          res.status(404).json({ error: 'Target user not found.' });
          return;
        }
        const targetRole = (targetSnap.data()?.role as UserRole) || 'contributor';
        const decision = validateAccountStatusChange({
          actorRole: req.actorRole!,
          actorUid: req.authUser!.uid,
          targetUid,
          targetCurrentRole: targetRole,
        });
        if (!decision.allowed) {
          res.status(403).json({ error: decision.reason });
          return;
        }

        await targetRef.update({ accountStatus: nextStatus });
        await adminAuth!.updateUser(targetUid, {
          disabled: nextStatus === 'suspended',
        });
        res.json({ uid: targetUid, accountStatus: nextStatus });
      } catch {
        res.status(500).json({ error: 'Unable to update user status.' });
      }
    }
  );

  // Super Admin ONLY: promote/demote Admin <-> Contributor
  app.patch(
    '/api/super-admin/users/:targetUid/role',
    requireAuthToken,
    superAdminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const targetUid = String(req.params.targetUid || '');
      const nextRole = req.body?.role as UserRole;

      try {
        const targetRef = adminDb!.collection('users').doc(targetUid);
        const targetSnap = await targetRef.get();
        if (!targetSnap.exists) {
          res.status(404).json({ error: 'Target user not found.' });
          return;
        }
        const targetCurrentRole = (targetSnap.data()?.role as UserRole) || 'contributor';
        const decision = validateRoleTransition({
          actorRole: req.actorRole!,
          actorUid: req.authUser!.uid,
          targetUid,
          targetCurrentRole,
          nextRole,
        });
        if (!decision.allowed) {
          res.status(403).json({ error: decision.reason });
          return;
        }

        await targetRef.update({ role: nextRole });
        await adminAuth!.setCustomUserClaims(targetUid, { role: nextRole });
        res.json({ uid: targetUid, role: nextRole });
      } catch {
        res.status(500).json({ error: 'Unable to update user role.' });
      }
    }
  );

  // Super Admin ONLY: delete a non-super-admin user
  app.delete(
    '/api/super-admin/users/:targetUid',
    requireAuthToken,
    superAdminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const targetUid = String(req.params.targetUid || '');
      if (targetUid === req.authUser!.uid) {
        res.status(400).json({ error: 'You cannot delete your own Super Admin account.' });
        return;
      }

      try {
        const targetRef = adminDb!.collection('users').doc(targetUid);
        const targetSnap = await targetRef.get();
        if (targetSnap.exists) {
          const data = targetSnap.data() || {};
          if (data.role === 'super_admin') {
            res.status(403).json({ error: 'Super Admin accounts cannot be deleted.' });
            return;
          }
          if (typeof data.username === 'string' && data.username) {
            await adminDb!.collection('usernames').doc(data.username).delete().catch(() => {});
          }
          await targetRef.delete();
        }
        await adminAuth!.deleteUser(targetUid).catch(() => {});
        res.json({ deleted: true, uid: targetUid });
      } catch {
        res.status(500).json({ error: 'Unable to remove user.' });
      }
    }
  );

  const serializeTs = (val: unknown): string => {
    if (
      val &&
      typeof val === 'object' &&
      'toDate' in val &&
      typeof (val as { toDate: () => Date }).toDate === 'function'
    ) {
      return (val as { toDate: () => Date }).toDate().toISOString();
    }
    return typeof val === 'string' ? val : new Date().toISOString();
  };

  const matchesRoutePattern = (pattern: string, targetRoute: string): boolean => {
    const normPattern = normalizePageRoute(pattern);
    const normTarget = normalizePageRoute(targetRoute);
    if (normPattern === '*' || normPattern === normTarget) return true;
    if (normPattern.endsWith('/*')) {
      const base = normPattern.slice(0, -2) || '/';
      return normTarget === base || normTarget.startsWith(`${base}/`);
    }
    return false;
  };

  // Public Active Ads Delivery (returns ONLY active visual placements and enabled ads)
  app.get('/api/ads/active', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!adminDb || !hasAdminCredentials) {
      res.json({ placements: [], ads: [] });
      return;
    }

    const routeFilter =
      typeof req.query.route === 'string' && req.query.route.trim()
        ? normalizePageRoute(req.query.route)
        : '';

    try {
      const [placementsSnap, adsSnap] = await Promise.all([
        adminDb.collection('adPlacements').where('status', '==', 'active').get(),
        adminDb.collection('ads').where('status', '==', 'active').get(),
      ]);

      const placements: VisualPlacementRecord[] = placementsSnap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            name: String(d.name || ''),
            pageRoute: normalizePageRoute(String(d.pageRoute || '/')),
            slotId: String(d.slotId || ''),
            selector: String(d.selector || ''),
            elementInfo: String(d.elementInfo || ''),
            position: (d.position === 'before' || d.position === 'inside' ? d.position : 'after') as VisualPlacementRecord['position'],
            status: (d.status === 'disabled' ? 'disabled' : 'active') as VisualPlacementRecord['status'],
            priority: typeof d.priority === 'number' ? d.priority : 10,
            anchorMissing: Boolean(d.anchorMissing),
            createdByUid: String(d.createdByUid || ''),
            createdAt: serializeTs(d.createdAt),
            updatedAt: serializeTs(d.updatedAt),
          };
        })
        .filter((p) => p.status === 'active' && (!routeFilter || matchesRoutePattern(p.pageRoute, routeFilter)))
        .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : b.updatedAt.localeCompare(a.updatedAt)));

      const activePlacementIds = new Set(placements.map((p) => p.id));

      const ads = adsSnap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            name: String(d.name || ''),
            provider: String(d.provider || ''),
            adType: String(d.adType || 'banner'),
            scriptCode: String(d.scriptCode || ''),
            placementId: String(d.placementId || ''),
            placementName: String(d.placementName || ''),
            width: String(d.width || 'auto'),
            height: String(d.height || 'auto'),
            status: String(d.status || 'disabled'),
            priority: typeof d.priority === 'number' ? d.priority : 10,
            createdAt: serializeTs(d.createdAt),
            updatedAt: serializeTs(d.updatedAt),
          };
        })
        .filter(
          (ad) =>
            ad.status === 'active' &&
            ad.scriptCode.length >= 5 &&
            ad.placementId &&
            activePlacementIds.has(ad.placementId)
        )
        .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : b.updatedAt.localeCompare(a.updatedAt)));

      res.json({ placements, ads });
    } catch {
      res.status(500).json({ error: 'Unable to load active advertisements.' });
    }
  });

  // Admin: List ALL saved visual ad placements
  app.get(
    '/api/admin/placements',
    requireAuthToken,
    adminGuard,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const snap = await adminDb!.collection('adPlacements').get();
        const placements: VisualPlacementRecord[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              name: String(d.name || ''),
              pageRoute: normalizePageRoute(String(d.pageRoute || '/')),
              slotId: String(d.slotId || ''),
              selector: String(d.selector || ''),
              elementInfo: String(d.elementInfo || ''),
              position: (d.position === 'before' || d.position === 'inside' ? d.position : 'after') as VisualPlacementRecord['position'],
              status: (d.status === 'disabled' ? 'disabled' : 'active') as VisualPlacementRecord['status'],
              priority: typeof d.priority === 'number' ? d.priority : 10,
              anchorMissing: Boolean(d.anchorMissing),
              createdByUid: String(d.createdByUid || ''),
              createdAt: serializeTs(d.createdAt),
              updatedAt: serializeTs(d.updatedAt),
            };
          })
          .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : b.updatedAt.localeCompare(a.updatedAt)));

        res.json({ placements });
      } catch {
        res.status(500).json({ error: 'Failed to load visual ad placements.' });
      }
    }
  );

  // Admin: Create visual ad placement selected directly on the website
  app.post(
    '/api/admin/placements',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const check = validatePlacementPayload(req.body || {});
      if (!check.valid || !check.sanitized) {
        res.status(400).json({ error: check.error || 'Invalid placement payload.' });
        return;
      }

      const placementId = `plc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      try {
        const record = {
          id: placementId,
          ...check.sanitized,
          anchorMissing: false,
          createdByUid: req.authUser!.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        await adminDb!.collection('adPlacements').doc(placementId).set(record);
        const saved = await adminDb!.collection('adPlacements').doc(placementId).get();
        const d = saved.data() || {};
        res.status(201).json({
          placement: {
            ...check.sanitized,
            id: placementId,
            anchorMissing: false,
            createdByUid: req.authUser!.uid,
            createdAt: serializeTs(d.createdAt),
            updatedAt: serializeTs(d.updatedAt),
          },
        });
      } catch {
        res.status(500).json({ error: 'Unable to save visual ad placement.' });
      }
    }
  );

  // Admin: Update visual ad placement (rename, toggle status, priority, position, anchorMissing)
  app.patch(
    '/api/admin/placements/:placementId',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const placementId = String(req.params.placementId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(placementId)) {
        res.status(400).json({ error: 'Invalid placement ID.' });
        return;
      }

      try {
        const ref = adminDb!.collection('adPlacements').doc(placementId);
        const snap = await ref.get();
        if (!snap.exists) {
          res.status(404).json({ error: 'Visual placement not found.' });
          return;
        }
        const existingData = snap.data() || {};
        const merged = {
          name: req.body?.name ?? existingData.name,
          pageRoute: req.body?.pageRoute ?? existingData.pageRoute,
          slotId: req.body?.slotId ?? existingData.slotId,
          selector: req.body?.selector ?? existingData.selector,
          elementInfo: req.body?.elementInfo ?? existingData.elementInfo,
          position: req.body?.position ?? existingData.position,
          status: req.body?.status ?? existingData.status,
          priority: req.body?.priority ?? existingData.priority,
        };

        const check = validatePlacementPayload(merged);
        if (!check.valid || !check.sanitized) {
          res.status(400).json({ error: check.error || 'Invalid placement update.' });
          return;
        }

        const nextAnchorMissing =
          typeof req.body?.anchorMissing === 'boolean'
            ? req.body.anchorMissing
            : Boolean(existingData.anchorMissing);

        await ref.update({
          ...check.sanitized,
          anchorMissing: nextAnchorMissing,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Sync placementName onto linked advertisements if renamed
        if (check.sanitized.name !== existingData.name) {
          const linkedAds = await adminDb!
            .collection('ads')
            .where('placementId', '==', placementId)
            .get();
          await Promise.all(
            linkedAds.docs.map((adDoc) =>
              adDoc.ref.update({ placementName: check.sanitized!.name })
            )
          );
        }

        const updatedSnap = await ref.get();
        const ud = updatedSnap.data() || {};
        res.json({
          placement: {
            ...check.sanitized,
            id: placementId,
            anchorMissing: nextAnchorMissing,
            createdByUid: String(existingData.createdByUid || ''),
            createdAt: serializeTs(ud.createdAt),
            updatedAt: serializeTs(ud.updatedAt),
          },
        });
      } catch {
        res.status(500).json({ error: 'Unable to update visual ad placement.' });
      }
    }
  );

  // Admin: Delete visual ad placement
  app.delete(
    '/api/admin/placements/:placementId',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const placementId = String(req.params.placementId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(placementId)) {
        res.status(400).json({ error: 'Invalid placement ID.' });
        return;
      }

      try {
        await adminDb!.collection('adPlacements').doc(placementId).delete();
        res.json({ deleted: true, id: placementId });
      } catch {
        res.status(500).json({ error: 'Unable to delete visual ad placement.' });
      }
    }
  );

  // Admin: List ALL advertisements (active & disabled)
  app.get(
    '/api/admin/ads',
    requireAuthToken,
    adminGuard,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const [adsSnap, placementsSnap] = await Promise.all([
          adminDb!.collection('ads').get(),
          adminDb!.collection('adPlacements').get(),
        ]);

        const placementNameMap = new Map<string, string>();
        for (const pDoc of placementsSnap.docs) {
          const pd = pDoc.data();
          placementNameMap.set(pDoc.id, String(pd.name || pDoc.id));
        }

        const ads = adsSnap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            const placementId = String(d.placementId || '');
            return {
              id: docSnap.id,
              name: String(d.name || ''),
              provider: String(d.provider || ''),
              adType: String(d.adType || 'banner'),
              scriptCode: String(d.scriptCode || ''),
              placementId,
              placementName:
                placementNameMap.get(placementId) ||
                String(d.placementName || d.placement || ''),
              width: String(d.width || 'auto'),
              height: String(d.height || 'auto'),
              status: d.status === 'disabled' ? 'disabled' : 'active',
              priority: typeof d.priority === 'number' ? d.priority : 10,
              createdAt: serializeTs(d.createdAt),
              updatedAt: serializeTs(d.updatedAt),
              updatedByUid: String(d.updatedByUid || ''),
            };
          })
          .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : b.updatedAt.localeCompare(a.updatedAt)));

        res.json({ ads });
      } catch {
        res.status(500).json({ error: 'Failed to load advertisements.' });
      }
    }
  );

  // Admin: Create advertisement bound to a saved visual placement
  app.post(
    '/api/admin/ads',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const check = validateAdPayload(req.body || {});
      if (!check.valid || !check.sanitized) {
        res.status(400).json({ error: check.error || 'Invalid advertisement payload.' });
        return;
      }

      try {
        const placementSnap = await adminDb!
          .collection('adPlacements')
          .doc(check.sanitized.placementId)
          .get();
        if (!placementSnap.exists) {
          res.status(400).json({
            error: 'Selected placement does not exist. Select a placement on the website first.',
          });
          return;
        }
        const placementName = String(placementSnap.data()?.name || check.sanitized.placementId);

        const adId = `ad_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const record = {
          id: adId,
          ...check.sanitized,
          placementName,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedByUid: req.authUser!.uid,
        };
        await adminDb!.collection('ads').doc(adId).set(record);
        const saved = await adminDb!.collection('ads').doc(adId).get();
        const d = saved.data() || {};
        res.status(201).json({
          ad: {
            ...check.sanitized,
            placementName,
            id: adId,
            createdAt: serializeTs(d.createdAt),
            updatedAt: serializeTs(d.updatedAt),
            updatedByUid: req.authUser!.uid,
          },
        });
      } catch {
        res.status(500).json({ error: 'Unable to create advertisement.' });
      }
    }
  );

  // Admin: Update advertisement
  app.patch(
    '/api/admin/ads/:adId',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const adId = String(req.params.adId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(adId)) {
        res.status(400).json({ error: 'Invalid advertisement ID.' });
        return;
      }

      try {
        const ref = adminDb!.collection('ads').doc(adId);
        const snap = await ref.get();
        if (!snap.exists) {
          res.status(404).json({ error: 'Advertisement not found.' });
          return;
        }
        const existingData = snap.data() || {};
        const merged = {
          name: req.body?.name ?? existingData.name,
          provider: req.body?.provider ?? existingData.provider,
          adType: req.body?.adType ?? existingData.adType,
          scriptCode: req.body?.scriptCode ?? existingData.scriptCode,
          placementId: req.body?.placementId ?? existingData.placementId,
          width: req.body?.width ?? existingData.width,
          height: req.body?.height ?? existingData.height,
          status: req.body?.status ?? existingData.status,
          priority: req.body?.priority ?? existingData.priority,
        };

        const check = validateAdPayload(merged);
        if (!check.valid || !check.sanitized) {
          res.status(400).json({ error: check.error || 'Invalid advertisement update.' });
          return;
        }

        const placementSnap = await adminDb!
          .collection('adPlacements')
          .doc(check.sanitized.placementId)
          .get();
        if (!placementSnap.exists) {
          res.status(400).json({ error: 'Target placement does not exist.' });
          return;
        }
        const placementName = String(placementSnap.data()?.name || check.sanitized.placementId);

        await ref.update({
          ...check.sanitized,
          placementName,
          updatedAt: FieldValue.serverTimestamp(),
          updatedByUid: req.authUser!.uid,
        });

        const updatedSnap = await ref.get();
        const ud = updatedSnap.data() || {};
        res.json({
          ad: {
            ...check.sanitized,
            placementName,
            id: adId,
            createdAt: serializeTs(ud.createdAt),
            updatedAt: serializeTs(ud.updatedAt),
            updatedByUid: req.authUser!.uid,
          },
        });
      } catch {
        res.status(500).json({ error: 'Unable to update advertisement.' });
      }
    }
  );

  // Admin: Delete advertisement
  app.delete(
    '/api/admin/ads/:adId',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const adId = String(req.params.adId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(adId)) {
        res.status(400).json({ error: 'Invalid advertisement ID.' });
        return;
      }

      try {
        await adminDb!.collection('ads').doc(adId).delete();
        res.json({ deleted: true, id: adId });
      } catch {
        res.status(500).json({ error: 'Unable to delete advertisement.' });
      }
    }
  );

  const toDateStr = (val: unknown): string => {
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
  };

  const seededCollectionsMap = new Map(
    READY_MADE_PROMPTS.map((item) => [item.id, item.trendingCollections])
  );

  const sanitizePublicPrompt = (
    id: string,
    d: Record<string, unknown>,
    resolvedSecretText?: string
  ) => ({
    id,
    title: String(d.title || 'Untitled Artwork'),
    promptText:
      (typeof d.promptText === 'string' && d.promptText.trim()) ||
      (typeof resolvedSecretText === 'string' && resolvedSecretText.trim()) ||
      SEEDED_PROMPT_SECRETS[id] ||
      '',
    imageUrl: String(
      d.imageUrl || '/src/assets/images/art_digital_dreamscape_1794836302512.jpg'
    ),
    aspectRatio: ['16:9', '4:3', '3:4', '1:1'].includes(String(d.aspectRatio))
      ? String(d.aspectRatio)
      : '4:3',
    creatorUsername: String(d.authorUsername || 'contributor'),
    authorUid: typeof d.authorUid === 'string' ? d.authorUid : undefined,
    authorType: d.authorType === 'official' ? 'official' : 'contributor',
    authorLabel: typeof d.authorLabel === 'string' ? d.authorLabel : undefined,
    status: 'approved',
    likes: typeof d.likes === 'number' ? d.likes : 1,
    copies: typeof d.copies === 'number' ? d.copies : 0,
    views: typeof d.views === 'number' ? d.views : 1,
    createdAt: toDateStr(d.createdAt),
    trendingCollections: seededCollectionsMap.get(id) || ['recent', 'today'],
  });

  // Dynamic XML Sitemap (strictly includes ONLY published/approved prompts; unpublished & deleted excluded)
  app.get('/sitemap.xml', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const origin = `${req.protocol}://${req.get('host') || 'imagelab.app'}`;
    const staticPaths = [
      '/',
      '/explore',
      '/trending',
      '/saved',
      '/about',
      '/contact',
      '/privacy',
      '/terms',
    ];

    let promptEntries: { id: string; lastmod: string }[] = [];
    if (adminDb && hasAdminCredentials) {
      try {
        const snap = await adminDb
          .collection('prompts')
          .where('status', '==', 'approved')
          .get();
        promptEntries = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          lastmod: toDateStr(docSnap.data()?.updatedAt || docSnap.data()?.createdAt),
        }));
      } catch {
        promptEntries = [];
      }
    } else {
      promptEntries = READY_MADE_PROMPTS.map((p) => ({
        id: p.id,
        lastmod: p.createdAt,
      }));
    }

    const xmlEsc = (val: string) =>
      val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const urlsXml = [
      ...staticPaths.map(
        (routePath) =>
          `  <url>\n    <loc>${xmlEsc(`${origin}${routePath}`)}</loc>\n  </url>`
      ),
      ...promptEntries.map(
        (entry) =>
          `  <url>\n    <loc>${xmlEsc(`${origin}/prompt/${encodeURIComponent(entry.id)}`)}</loc>\n    <lastmod>${xmlEsc(entry.lastmod)}</lastmod>\n  </url>`
      ),
    ].join('\n');

    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlsXml}\n</urlset>`
    );
  });

  // Dynamic robots.txt for backend / monolithic origin
  app.get('/robots.txt', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const siteBase = (
      process.env.PUBLIC_SITE_URL ||
      process.env.VITE_SITE_URL ||
      `${req.protocol}://${req.get('host') || 'imagelab.pages.dev'}`
    )
      .trim()
      .replace(/\/+$/, '');
    res.send(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /admin/*',
        'Disallow: /super-admin',
        'Disallow: /dashboard',
        'Disallow: /profile',
        'Disallow: /login',
        'Disallow: /signup',
        '',
        `Sitemap: ${siteBase}/sitemap.xml`,
        '',
      ].join('\n')
    );
  });

  // Public Prompt Gallery (includes ONLY status == 'approved' prompts)
  app.get('/api/prompts/public', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!adminDb || !hasAdminCredentials) {
      res.json({ prompts: [], seeded: false });
      return;
    }
    try {
      const [snap, secretsSnap] = await Promise.all([
        adminDb.collection('prompts').where('status', '==', 'approved').get(),
        adminDb.collection('promptSecrets').get(),
      ]);
      const secretMap = new Map<string, string>();
      for (const sDoc of secretsSnap.docs) {
        const txt = sDoc.data()?.promptText;
        if (typeof txt === 'string' && txt.trim()) {
          secretMap.set(sDoc.id, txt.trim());
        }
      }
      const prompts = snap.docs
        .map((docSnap) =>
          sanitizePublicPrompt(docSnap.id, docSnap.data() || {}, secretMap.get(docSnap.id))
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json({ prompts, seeded: true });
    } catch {
      res.status(500).json({ error: 'Unable to load public artwork gallery.' });
    }
  });

  // Public Single Prompt Details (strictly rejects unpublished or deleted prompts)
  app.get('/api/prompts/public/:promptId', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const promptId = String(req.params.promptId || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(promptId)) {
      res.status(400).json({ error: 'Invalid prompt ID.' });
      return;
    }
    if (!adminDb || !hasAdminCredentials) {
      res.status(404).json({ error: 'Prompt not found.' });
      return;
    }
    try {
      const [snap, secretSnap] = await Promise.all([
        adminDb.collection('prompts').doc(promptId).get(),
        adminDb.collection('promptSecrets').doc(promptId).get(),
      ]);
      if (!snap.exists) {
        res.status(404).json({ error: 'Prompt not found.' });
        return;
      }
      const d = snap.data() || {};
      if (d.status !== 'approved') {
        res.status(404).json({ error: 'Prompt not found.' });
        return;
      }
      const secretText =
        secretSnap.exists && typeof secretSnap.data()?.promptText === 'string'
          ? secretSnap.data()!.promptText
          : undefined;
      res.json({ prompt: sanitizePublicPrompt(promptId, d, secretText) });
    } catch {
      res.status(500).json({ error: 'Unable to load prompt details.' });
    }
  });

  // Authenticated Single Prompt Lookup (owner, Admin, or Super Admin can inspect even if unpublished)
  app.get(
    '/api/prompts/:promptId/manage',
    requireAuthToken,
    async (req: AuthenticatedRequest, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      const promptId = String(req.params.promptId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(promptId)) {
        res.status(400).json({ error: 'Invalid prompt ID.' });
        return;
      }
      if (!adminDb || !hasAdminCredentials) {
        res.status(503).json({ error: 'Server Admin SDK credentials are not configured.' });
        return;
      }
      try {
        const [userSnap, promptSnap, secretSnap] = await Promise.all([
          adminDb.collection('users').doc(req.authUser!.uid).get(),
          adminDb.collection('prompts').doc(promptId).get(),
          adminDb.collection('promptSecrets').doc(promptId).get(),
        ]);
        if (!promptSnap.exists) {
          res.status(404).json({ error: 'Prompt not found.' });
          return;
        }
        const userData = userSnap.exists ? userSnap.data() || {} : {};
        const actorRole = (userData.role as UserRole) || 'contributor';
        const isPrivilegedAdmin =
          (actorRole === 'admin' || actorRole === 'super_admin') &&
          req.authUser!.email_verified === true &&
          userData.accountStatus !== 'suspended';
        const d = promptSnap.data() || {};
        const isOwner = d.authorUid === req.authUser!.uid;
        if (d.status !== 'approved' && !isPrivilegedAdmin && !isOwner) {
          res.status(404).json({ error: 'Prompt not found.' });
          return;
        }
        const secretText =
          secretSnap.exists && typeof secretSnap.data()?.promptText === 'string'
            ? secretSnap.data()!.promptText
            : undefined;
        res.json({
          prompt: {
            ...sanitizePublicPrompt(promptId, d, secretText),
            status: d.status || 'approved',
          },
        });
      } catch {
        res.status(500).json({ error: 'Unable to load prompt details.' });
      }
    }
  );

  // Authenticated Contributor/Owner OR Admin Edit Prompt
  app.patch(
    '/api/prompts/:promptId',
    requireAuthToken,
    async (req: AuthenticatedRequest, res: Response) => {
      const promptId = String(req.params.promptId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(promptId)) {
        res.status(400).json({ error: 'Invalid prompt ID.' });
        return;
      }
      if (!adminDb || !hasAdminCredentials) {
        res.status(503).json({ error: 'Server Admin SDK credentials are not configured.' });
        return;
      }
      try {
        const [userSnap, snap, secretSnap] = await Promise.all([
          adminDb.collection('users').doc(req.authUser!.uid).get(),
          adminDb.collection('prompts').doc(promptId).get(),
          adminDb.collection('promptSecrets').doc(promptId).get(),
        ]);
        if (!snap.exists) {
          res.status(404).json({ error: 'Prompt not found.' });
          return;
        }
        const userData = userSnap.exists ? userSnap.data() || {} : {};
        if (userData.accountStatus === 'suspended') {
          res.status(403).json({ error: 'This account has been suspended.' });
          return;
        }
        const actorRole = (userData.role as UserRole) || 'contributor';
        const isPrivilegedAdmin =
          (actorRole === 'admin' || actorRole === 'super_admin') &&
          req.authUser!.email_verified === true;
        const existing = snap.data() || {};
        const isOwner = existing.authorUid === req.authUser!.uid;

        if (!isPrivilegedAdmin && !isOwner) {
          res.status(403).json({ error: 'You may only edit your own prompts.' });
          return;
        }

        const existingSecret = secretSnap.exists ? secretSnap.data() || {} : {};
        const body = req.body || {};

        const nextTitle =
          typeof body.title === 'string' ? body.title.trim() : String(existing.title || '');
        const fallbackPromptText =
          (typeof existingSecret.promptText === 'string' && existingSecret.promptText) ||
          (typeof existing.promptText === 'string' && existing.promptText) ||
          SEEDED_PROMPT_SECRETS[promptId] ||
          '';
        const nextPromptText =
          typeof body.promptText === 'string'
            ? body.promptText.trim()
            : fallbackPromptText;
        const nextImage =
          typeof body.imageUrl === 'string' && body.imageUrl.trim()
            ? body.imageUrl.trim()
            : String(existing.imageUrl || '');
        const nextAspect = ['16:9', '4:3', '3:4', '1:1'].includes(body.aspectRatio)
          ? body.aspectRatio
          : existing.aspectRatio;
        const allowedStatuses = ['approved', 'unpublished', 'pending', 'rejected', 'draft'];
        const nextStatus =
          isPrivilegedAdmin && allowedStatuses.includes(body.status)
            ? body.status
            : existing.status;

        if (nextTitle.length < 3 || nextTitle.length > 120) {
          res.status(400).json({ error: 'Title must be between 3 and 120 characters.' });
          return;
        }
        if (nextPromptText && (nextPromptText.length < 10 || nextPromptText.length > 4000)) {
          res.status(400).json({ error: 'AI generation prompt must be between 10 and 4000 characters.' });
          return;
        }
        if (!nextImage || nextImage.length > 500000) {
          res.status(400).json({ error: 'A valid artwork image is required.' });
          return;
        }

        const updates: Record<string, unknown> = {
          title: nextTitle,
          imageUrl: nextImage,
          status: nextStatus,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (nextPromptText) {
          updates.promptText = nextPromptText;
        }
        if (nextAspect) {
          updates.aspectRatio = nextAspect;
        }

        const batch = adminDb.batch();
        batch.update(snap.ref, updates);
        if (nextPromptText) {
          batch.set(
            adminDb.collection('promptSecrets').doc(promptId),
            {
              id: promptId,
              promptText: nextPromptText,
              authorUid: String(existing.authorUid || req.authUser!.uid),
              createdAt:
                existingSecret.createdAt || existing.createdAt || FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        await batch.commit();

        res.json({ id: promptId, status: nextStatus, updated: true });
      } catch {
        res.status(500).json({ error: 'Unable to update prompt.' });
      }
    }
  );

  // Authenticated Contributor/Owner OR Admin Permanent Delete Prompt
  app.delete(
    '/api/prompts/:promptId',
    requireAuthToken,
    async (req: AuthenticatedRequest, res: Response) => {
      const promptId = String(req.params.promptId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(promptId)) {
        res.status(400).json({ error: 'Invalid prompt ID.' });
        return;
      }
      if (!adminDb || !hasAdminCredentials) {
        res.status(503).json({ error: 'Server Admin SDK credentials are not configured.' });
        return;
      }
      try {
        const [userSnap, promptSnap] = await Promise.all([
          adminDb.collection('users').doc(req.authUser!.uid).get(),
          adminDb.collection('prompts').doc(promptId).get(),
        ]);
        if (!promptSnap.exists) {
          res.status(404).json({ error: 'Prompt not found.' });
          return;
        }
        const userData = userSnap.exists ? userSnap.data() || {} : {};
        if (userData.accountStatus === 'suspended') {
          res.status(403).json({ error: 'This account has been suspended.' });
          return;
        }
        const actorRole = (userData.role as UserRole) || 'contributor';
        const isPrivilegedAdmin =
          (actorRole === 'admin' || actorRole === 'super_admin') &&
          req.authUser!.email_verified === true;
        const isOwner = promptSnap.data()?.authorUid === req.authUser!.uid;

        if (!isPrivilegedAdmin && !isOwner) {
          res.status(403).json({ error: 'You may only delete your own prompts.' });
          return;
        }

        await deletePromptCompletely(promptId, req.authUser!.uid);
        res.json({ deleted: true, id: promptId });
      } catch {
        res.status(500).json({ error: 'Unable to delete prompt.' });
      }
    }
  );

  // Public Copy Counter Increment
  app.post('/api/prompts/:promptId/copy', async (req: Request, res: Response) => {
    const promptId = String(req.params.promptId || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(promptId)) {
      res.status(400).json({ error: 'Invalid prompt ID.' });
      return;
    }
    if (!adminDb || !hasAdminCredentials) {
      res.json({ ok: true, id: promptId });
      return;
    }
    try {
      const ref = adminDb.collection('prompts').doc(promptId);
      const snap = await ref.get();
      if (snap.exists && snap.data()?.status === 'approved') {
        await ref.update({ copies: FieldValue.increment(1) });
      }
      res.json({ ok: true, id: promptId });
    } catch {
      res.status(500).json({ error: 'Unable to record prompt copy.' });
    }
  });

  // Protected Prompt Secret Retrieval (strictly authenticated users only)
  app.get(
    '/api/prompts/:promptId/secret',
    requireAuthToken,
    async (req: AuthenticatedRequest, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      const promptId = String(req.params.promptId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(promptId)) {
        res.status(400).json({ error: 'Invalid prompt ID.' });
        return;
      }

      if (!adminDb || !hasAdminCredentials) {
        if (SEEDED_PROMPT_SECRETS[promptId]) {
          res.json({ id: promptId, promptText: SEEDED_PROMPT_SECRETS[promptId] });
          return;
        }
        res.status(503).json({
          error: 'Prompt vault requires server Admin SDK credentials.',
          missing: ['FIREBASE_SERVICE_ACCOUNT_JSON'],
        });
        return;
      }

      try {
        const userSnap = await adminDb.collection('users').doc(req.authUser!.uid).get();
        const userData = userSnap.exists ? userSnap.data() || {} : {};
        if (userData.accountStatus === 'suspended') {
          res.status(403).json({ error: 'This account has been suspended.' });
          return;
        }
        const actorRole = (userData.role as UserRole) || 'contributor';
        const isPrivilegedAdmin =
          (actorRole === 'admin' || actorRole === 'super_admin') &&
          req.authUser!.email_verified === true;

        const [promptSnap, secretSnap] = await Promise.all([
          adminDb.collection('prompts').doc(promptId).get(),
          adminDb.collection('promptSecrets').doc(promptId).get(),
        ]);

        if (promptSnap.exists) {
          const promptData = promptSnap.data() || {};
          const canAccess =
            promptData.status === 'approved' ||
            promptData.authorUid === req.authUser!.uid ||
            isPrivilegedAdmin;
          if (!canAccess) {
            res.status(403).json({ error: 'You do not have access to this prompt.' });
            return;
          }

          const resolvedPromptText =
            (secretSnap.exists && typeof secretSnap.data()?.promptText === 'string'
              ? secretSnap.data()!.promptText
              : '') ||
            (typeof promptData.promptText === 'string' ? promptData.promptText : '') ||
            SEEDED_PROMPT_SECRETS[promptId] ||
            '';

          if (!resolvedPromptText) {
            res.status(404).json({ error: 'Prompt text not found.' });
            return;
          }

          adminDb
            .collection('prompts')
            .doc(promptId)
            .update({ copies: FieldValue.increment(1) })
            .catch(() => {});

          res.json({ id: promptId, promptText: resolvedPromptText });
          return;
        }

        if (SEEDED_PROMPT_SECRETS[promptId]) {
          res.json({ id: promptId, promptText: SEEDED_PROMPT_SECRETS[promptId] });
          return;
        }

        res.status(404).json({ error: 'Prompt not found.' });
      } catch {
        res.status(500).json({ error: 'Unable to retrieve prompt right now.' });
      }
    }
  );

  // Admin: List ALL prompts (official, ready-made, contributor/user) with Admin-only creator emails
  app.get(
    '/api/admin/prompts',
    requireAuthToken,
    adminGuard,
    async (_req: AuthenticatedRequest, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const [promptsSnap, secretsSnap, usersSnap] = await Promise.all([
          adminDb!.collection('prompts').get(),
          adminDb!.collection('promptSecrets').get(),
          adminDb!.collection('users').get(),
        ]);

        const secretMap = new Map<string, string>();
        for (const sDoc of secretsSnap.docs) {
          const txt = sDoc.data()?.promptText;
          if (typeof txt === 'string') {
            secretMap.set(sDoc.id, txt);
          }
        }

        const userEmailMap = new Map<string, string>();
        for (const uDoc of usersSnap.docs) {
          const email = uDoc.data()?.email;
          if (typeof email === 'string' && email) {
            userEmailMap.set(uDoc.id, email);
          }
        }

        const prompts = promptsSnap.docs.map((docSnap) => {
          const d = docSnap.data() || {};
          const promptText =
            secretMap.get(docSnap.id) ||
            (typeof d.promptText === 'string' ? d.promptText : '') ||
            SEEDED_PROMPT_SECRETS[docSnap.id] ||
            '';
          const authorUid = String(d.authorUid || '');
          const authorEmail =
            userEmailMap.get(authorUid) ||
            (d.authorType === 'official' ? 'editorial@imagelab.app' : 'Unavailable');

          return {
            id: docSnap.id,
            title: String(d.title || 'Untitled Artwork'),
            promptText,
            imageUrl: String(d.imageUrl || ''),
            aspectRatio: ['16:9', '4:3', '3:4', '1:1'].includes(String(d.aspectRatio))
              ? String(d.aspectRatio)
              : '4:3',
            authorUid,
            authorUsername: String(d.authorUsername || 'contributor'),
            authorEmail,
            authorType: d.authorType === 'official' ? 'official' : 'contributor',
            authorLabel: typeof d.authorLabel === 'string' ? d.authorLabel : undefined,
            status: ['approved', 'unpublished', 'pending', 'rejected', 'draft'].includes(
              String(d.status)
            )
              ? String(d.status)
              : 'approved',
            createdAt: toDateStr(d.createdAt),
            updatedAt: toDateStr(d.updatedAt),
          };
        });

        prompts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        res.json({ prompts });
      } catch {
        res.status(500).json({ error: 'Unable to load admin prompts.' });
      }
    }
  );

  // Admin: Publish Official Website-Owned Prompt (3 simplified fields: imageUrl, title, promptText)
  app.post(
    '/api/admin/prompts',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const body = req.body || {};
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const promptText = typeof body.promptText === 'string' ? body.promptText.trim() : '';
      const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
      const aspectRatio = ['16:9', '4:3', '3:4', '1:1'].includes(body.aspectRatio)
        ? body.aspectRatio
        : '4:3';
      const status = body.status === 'draft' ? 'draft' : 'approved';
      const authorLabel =
        typeof body.authorLabel === 'string' && body.authorLabel.trim()
          ? body.authorLabel.trim().slice(0, 80)
          : 'ImageLab Official';

      if (title.length < 3 || title.length > 120) {
        res.status(400).json({ error: 'Title must be between 3 and 120 characters.' });
        return;
      }
      if (promptText.length < 10 || promptText.length > 4000) {
        res.status(400).json({ error: 'AI generation prompt must be between 10 and 4000 characters.' });
        return;
      }
      if (!imageUrl || imageUrl.length > 500000) {
        res.status(400).json({ error: 'A valid artwork image is required.' });
        return;
      }

      try {
        const userSnap = await adminDb!.collection('users').doc(req.authUser!.uid).get();
        const userData = userSnap.data() || {};
        const authorUsername =
          typeof userData.username === 'string' && userData.username
            ? userData.username
            : 'imagelab_official';

        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .slice(0, 48);
        const promptId = `${slug || 'official'}-${Date.now()}`;

        const publicMetadata = {
          id: promptId,
          title,
          promptText,
          imageUrl,
          aspectRatio,
          authorUid: req.authUser!.uid,
          authorUsername,
          authorType: 'official',
          authorLabel,
          status,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        const secretPayload = {
          id: promptId,
          promptText,
          authorUid: req.authUser!.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        const batch = adminDb!.batch();
        batch.set(adminDb!.collection('prompts').doc(promptId), publicMetadata);
        batch.set(adminDb!.collection('promptSecrets').doc(promptId), secretPayload);
        await batch.commit();

        res.status(201).json({ id: promptId, status });
      } catch {
        res.status(500).json({ error: 'Unable to publish official prompt.' });
      }
    }
  );

  // Admin: Edit or moderate any existing prompt (imageUrl, title, promptText, status; preserves creator & timestamps)
  app.patch(
    '/api/admin/prompts/:promptId',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const promptId = String(req.params.promptId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(promptId)) {
        res.status(400).json({ error: 'Invalid prompt ID.' });
        return;
      }

      try {
        const ref = adminDb!.collection('prompts').doc(promptId);
        const secretRef = adminDb!.collection('promptSecrets').doc(promptId);
        const [snap, secretSnap] = await Promise.all([ref.get(), secretRef.get()]);
        if (!snap.exists) {
          res.status(404).json({ error: 'Prompt not found.' });
          return;
        }
        const existing = snap.data() || {};
        const existingSecret = secretSnap.exists ? secretSnap.data() || {} : {};
        const body = req.body || {};

        const nextTitle =
          typeof body.title === 'string' ? body.title.trim() : String(existing.title || '');
        const fallbackPromptText =
          (typeof existingSecret.promptText === 'string' && existingSecret.promptText) ||
          (typeof existing.promptText === 'string' && existing.promptText) ||
          SEEDED_PROMPT_SECRETS[promptId] ||
          '';
        const nextPromptText =
          typeof body.promptText === 'string'
            ? body.promptText.trim()
            : fallbackPromptText;
        const nextStatus = [
          'approved',
          'unpublished',
          'pending',
          'rejected',
          'draft',
        ].includes(body.status)
          ? body.status
          : existing.status;
        const nextImage =
          typeof body.imageUrl === 'string' && body.imageUrl.trim()
            ? body.imageUrl.trim()
            : String(existing.imageUrl || '');
        const nextAspect = ['16:9', '4:3', '3:4', '1:1'].includes(body.aspectRatio)
          ? body.aspectRatio
          : existing.aspectRatio;

        if (nextTitle.length < 3 || nextTitle.length > 120) {
          res.status(400).json({ error: 'Title must be between 3 and 120 characters.' });
          return;
        }
        if (nextPromptText && (nextPromptText.length < 10 || nextPromptText.length > 4000)) {
          res.status(400).json({ error: 'AI generation prompt must be between 10 and 4000 characters.' });
          return;
        }
        if (!nextImage || nextImage.length > 500000) {
          res.status(400).json({ error: 'A valid artwork image is required.' });
          return;
        }

        const updates: Record<string, unknown> = {
          title: nextTitle,
          imageUrl: nextImage,
          status: nextStatus,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (nextPromptText) {
          updates.promptText = nextPromptText;
        }
        if (nextAspect) {
          updates.aspectRatio = nextAspect;
        }

        const batch = adminDb!.batch();
        batch.update(ref, updates);
        if (nextPromptText) {
          batch.set(
            secretRef,
            {
              id: promptId,
              promptText: nextPromptText,
              authorUid: String(existing.authorUid || req.authUser!.uid),
              createdAt: existingSecret.createdAt || existing.createdAt || FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        await batch.commit();

        if (
          typeof existing.imageUrl === 'string' &&
          existing.imageUrl &&
          existing.imageUrl !== nextImage
        ) {
          await deleteStorageFileIfOwned(existing.imageUrl);
        }

        res.json({ id: promptId, status: nextStatus, updated: true });
      } catch {
        res.status(500).json({ error: 'Unable to update prompt.' });
      }
    }
  );

  // Admin: Permanently delete prompt (removes Firestore record, Storage image, reports, likes/saves, and creates audit record)
  app.delete(
    '/api/admin/prompts/:promptId',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const promptId = String(req.params.promptId || '').trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(promptId)) {
        res.status(400).json({ error: 'Invalid prompt ID.' });
        return;
      }

      try {
        const result = await deletePromptCompletely(promptId, req.authUser!.uid);
        if (!result.found) {
          res.status(404).json({ error: 'Prompt not found.' });
          return;
        }
        res.json({ deleted: true, id: promptId });
      } catch {
        res.status(500).json({ error: 'Unable to permanently delete prompt.' });
      }
    }
  );

  // Admin: Update or delete report
  app.patch(
    '/api/admin/reports/:reportId',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const reportId = String(req.params.reportId || '').trim();
      const status = req.body?.status;
      if (!['open', 'resolved', 'dismissed'].includes(status)) {
        res.status(400).json({ error: 'Invalid report status.' });
        return;
      }
      try {
        await adminDb!.collection('reports').doc(reportId).update({ status });
        res.json({ id: reportId, status });
      } catch {
        res.status(500).json({ error: 'Unable to update report status.' });
      }
    }
  );

  app.delete(
    '/api/admin/reports/:reportId',
    requireAuthToken,
    adminGuard,
    async (req: AuthenticatedRequest, res: Response) => {
      const reportId = String(req.params.reportId || '').trim();
      try {
        await adminDb!.collection('reports').doc(reportId).delete();
        res.json({ deleted: true, id: reportId });
      } catch {
        res.status(500).json({ error: 'Unable to remove report.' });
      }
    }
  );

  // Ensure unmatched /api/* endpoints always return JSON 404
  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Vite dev middleware or production static assets (when dist/ exists locally)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(indexHtmlPath);
      });
    } else {
      app.get('/', (_req, res) => {
        res.json({
          service: 'imagelab-api',
          status: 'healthy',
          health: '/api/health',
        });
      });
      app.use((_req, res) => {
        res.status(404).json({ error: 'Route not found on ImageLab API server.' });
      });
    }
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `ImageLab server listening on http://0.0.0.0:${PORT} (Admin SDK credentials: ${
        hasAdminCredentials ? 'configured' : 'not set'
      })`
    );
  });
}

startServer();
