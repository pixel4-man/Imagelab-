import { auth } from './firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function friendlyAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-disabled':
      return 'This account has been suspended. Please contact support for assistance.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password. Please check your credentials and try again.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try logging in instead.';
    case 'auth/weak-password':
      return 'Please choose a stronger password with at least 8 characters, including letters and numbers.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled before completion. You can try again anytime.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Redirecting you to complete sign-in.';
    case 'auth/network-request-failed':
      return 'Unable to connect right now. Please check your internet connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few moments before trying again.';
    case 'auth/requires-recent-login':
      return 'For your security, please sign in again before completing this action.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled yet in your authentication settings.';
    case 'permission-denied':
      return 'Unable to complete sign-in right now. Please try again.';
    default:
      if (error instanceof Error && error.message) {
        const msg = error.message.trim();
        if (
          msg.startsWith('{') &&
          (msg.includes('"operationType"') || msg.includes('"authInfo"'))
        ) {
          return 'Unable to complete sign-in right now. Please try again.';
        }
        if (!msg.includes('Firebase') && !msg.includes('Missing or insufficient permissions')) {
          return msg;
        }
      }
      return 'Unable to complete authentication right now. Please try again.';
  }
}
