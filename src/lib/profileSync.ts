export interface PendingRegistrationInfo {
  fullName: string;
  username: string;
}

export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

export function buildSafeProfileFields(params: {
  email?: string | null;
  providerEmail?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  customFullName?: string;
}): {
  fullName: string;
  email: string;
  photoURL: string;
} {
  const safeEmail = (params.email || params.providerEmail || '').trim().slice(0, 150);
  const emailLocal = safeEmail.split('@')[0]?.trim() || '';
  const candidateName =
    params.customFullName?.trim() ||
    params.displayName?.trim() ||
    emailLocal ||
    'ImageLab Creator';

  const fullName = (
    candidateName.length >= 2 ? candidateName : 'ImageLab Creator'
  ).slice(0, 100);

  const photoURL = (params.photoURL || '').trim().slice(0, 1000);

  return {
    fullName,
    email: safeEmail,
    photoURL,
  };
}

export class ProfileEnsureCoordinator<T> {
  private inFlight = new Map<string, Promise<T>>();
  private pendingRegistrations = new Map<string, PendingRegistrationInfo>();

  setPendingRegistration(email: string, info: PendingRegistrationInfo): void {
    const key = email.trim().toLowerCase();
    if (!key) return;
    this.pendingRegistrations.set(key, info);
  }

  getPendingRegistration(email?: string | null): PendingRegistrationInfo | undefined {
    const key = (email || '').trim().toLowerCase();
    if (!key) return undefined;
    return this.pendingRegistrations.get(key);
  }

  clearPendingRegistration(email?: string | null): void {
    const key = (email || '').trim().toLowerCase();
    if (!key) return;
    this.pendingRegistrations.delete(key);
  }

  run(uid: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(uid);
    if (existing) {
      return existing;
    }

    const promise = factory().finally(() => {
      if (this.inFlight.get(uid) === promise) {
        this.inFlight.delete(uid);
      }
    });

    this.inFlight.set(uid, promise);
    return promise;
  }
}
