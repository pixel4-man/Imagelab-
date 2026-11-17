export type UserRole = 'super_admin' | 'admin' | 'contributor';
export type AccountStatus = 'active' | 'suspended';

export const DEFAULT_SUPER_ADMIN_EMAIL = 'adilwss67@gmail.com';

export function isEligibleForSuperAdminBootstrap(
  email: string | null | undefined,
  emailVerified: boolean | undefined,
  configuredSuperAdminEmail: string = DEFAULT_SUPER_ADMIN_EMAIL
): boolean {
  if (!email || emailVerified !== true) return false;
  return email.trim().toLowerCase() === configuredSuperAdminEmail.trim().toLowerCase();
}

export function canAccessDashboard(
  role: UserRole | null | undefined,
  required: 'contributor' | 'admin' | 'super_admin'
): boolean {
  if (!role) return false;
  if (required === 'contributor') {
    return role === 'contributor' || role === 'admin' || role === 'super_admin';
  }
  if (required === 'admin') {
    return role === 'admin' || role === 'super_admin';
  }
  return role === 'super_admin';
}

export function getDashboardPathForRole(role: UserRole | null | undefined): string {
  if (role === 'super_admin') return '/super-admin';
  if (role === 'admin') return '/admin';
  return '/dashboard';
}

export function validateRoleTransition(params: {
  actorRole: UserRole;
  actorUid: string;
  targetUid: string;
  targetCurrentRole: UserRole;
  nextRole: UserRole;
}): { allowed: boolean; reason?: string } {
  const { actorRole, actorUid, targetUid, targetCurrentRole, nextRole } = params;

  if (actorRole !== 'super_admin') {
    return {
      allowed: false,
      reason: 'Only a Super Admin can modify user roles.',
    };
  }

  if (actorUid === targetUid) {
    return {
      allowed: false,
      reason: 'You cannot change your own role.',
    };
  }

  if (targetCurrentRole === 'super_admin') {
    return {
      allowed: false,
      reason: 'Super Admin accounts cannot be altered from role management.',
    };
  }

  if (nextRole !== 'admin' && nextRole !== 'contributor') {
    return {
      allowed: false,
      reason: 'Roles can only be assigned as admin or contributor.',
    };
  }

  return { allowed: true };
}

export function validateAccountStatusChange(params: {
  actorRole: UserRole;
  actorUid: string;
  targetUid: string;
  targetCurrentRole: UserRole;
}): { allowed: boolean; reason?: string } {
  const { actorRole, actorUid, targetUid, targetCurrentRole } = params;

  if (actorRole !== 'admin' && actorRole !== 'super_admin') {
    return {
      allowed: false,
      reason: 'Administrative privileges required.',
    };
  }

  if (actorUid === targetUid) {
    return {
      allowed: false,
      reason: 'You cannot suspend your own account.',
    };
  }

  if (targetCurrentRole === 'super_admin') {
    return {
      allowed: false,
      reason: 'Super Admin accounts cannot be suspended or modified.',
    };
  }

  if (actorRole === 'admin' && targetCurrentRole === 'admin') {
    return {
      allowed: false,
      reason: 'Admins cannot suspend other Admin accounts.',
    };
  }

  return { allowed: true };
}
