import React from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccessDashboard, getDashboardPathForRole } from '../server/rbac';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'contributor' | 'admin' | 'super_admin';
}

export function ProtectedRoute({
  children,
  requiredRole = 'contributor',
}: ProtectedRouteProps) {
  const { firebaseUser, userProfile, authReady, authError, retrySessionSync, logout } = useAuth();
  const location = useLocation();

  if (!authReady || (firebaseUser && !userProfile && !authError)) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/10 p-10 animate-pulse space-y-4">
          <div className="h-4 w-36 bg-[#E8DEC8] rounded" />
          <div className="h-8 w-72 bg-[#E8DEC8] rounded" />
          <div className="h-24 w-full bg-[#E8DEC8]/70 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <Navigate
        to="/login"
        state={{ from: `${location.pathname}${location.search}` }}
        replace
      />
    );
  }

  if (!userProfile) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="rounded-3xl bg-[#FAF7F2] border border-[#E76F51]/30 p-8 sm:p-10 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-[#E76F51]/12 text-[#E76F51] flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-[#264653]">Unable to Restore Profile</h1>
          <p className="text-sm text-[#264653]/75 leading-relaxed">
            {authError || 'Your session is active, but your profile could not be loaded right now.'}
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => retrySessionSync()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-sm font-semibold transition-colors"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="px-5 py-2.5 rounded-xl bg-[#F4EDE4] hover:bg-[#E8DEC8] text-[#264653] text-sm font-semibold transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!canAccessDashboard(userProfile.role, requiredRole)) {
    const fallbackPath = getDashboardPathForRole(userProfile.role);
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="rounded-3xl bg-[#FAF7F2] border border-[#E76F51]/30 p-8 sm:p-10 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-[#E76F51]/12 text-[#E76F51] flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-[#264653]">Access Restricted</h1>
          <p className="text-sm text-[#264653]/75 leading-relaxed">
            Your current role does not have permission to open this dashboard section.
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Link
              to={fallbackPath}
              className="px-5 py-2.5 rounded-xl bg-[#264653] hover:bg-[#355C6B] text-white text-sm font-semibold transition-colors"
            >
              Go to Your Dashboard
            </Link>
            <Link
              to="/explore"
              className="px-5 py-2.5 rounded-xl bg-[#F4EDE4] hover:bg-[#E8DEC8] text-[#264653] text-sm font-semibold transition-colors"
            >
              Explore Prompts
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
