import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  X,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { PageTransition } from '../components/PageTransition';
import { SafeImage } from '../components/SafeImage';
import { useAuth } from '../context/AuthContext';
import { getDashboardPathForRole } from '../server/rbac';

const POST_AUTH_REDIRECT_KEY = 'imagelab_post_auth_redirect';

function sanitizeRedirectPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (trimmed === '/login' || trimmed === '/signup') return null;
  return trimmed;
}

export function LoginPage() {
  const {
    firebaseUser,
    userProfile,
    authReady,
    isConfigured,
    missingConfigKeys,
    loginWithEmail,
    signInWithGoogle,
    sendPasswordReset,
    authError,
    clearAuthError,
  } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();
  const queryRedirect = sanitizeRedirectPath(
    new URLSearchParams(location.search).get('redirect')
  );
  const stateFrom = sanitizeRedirectPath(
    (location.state as { from?: string } | null)?.from
  );
  const storedRedirect = (() => {
    try {
      return sanitizeRedirectPath(sessionStorage.getItem(POST_AUTH_REDIRECT_KEY));
    } catch {
      return null;
    }
  })();
  const redirectTarget = queryRedirect || stateFrom || storedRedirect;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    return () => {
      clearAuthError();
    };
  }, []);

  useEffect(() => {
    if (redirectTarget) {
      try {
        sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, redirectTarget);
      } catch {
        // Ignore storage errors
      }
    }
  }, [redirectTarget]);

  const completeRedirect = (fallbackPath: string) => {
    try {
      sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
    } catch {
      // Ignore storage errors
    }
    navigate(redirectTarget || fallbackPath, { replace: true });
  };

  useEffect(() => {
    if (authReady && firebaseUser && userProfile) {
      completeRedirect(getDashboardPathForRole(userProfile.role));
    }
  }, [authReady, firebaseUser, userProfile, redirectTarget, navigate]);

  const validateLogin = () => {
    const next: { email?: string; password?: string } = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = 'Please enter a valid email address.';
    }
    if (!password || password.length < 6) {
      next.password = 'Password must be at least 6 characters.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validateLogin()) return;

    setSubmitting(true);
    try {
      const result = await loginWithEmail(email, password);
      completeRedirect(result.redirectTo);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Unable to sign in right now.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setSubmitError(null);
    if (redirectTarget) {
      try {
        sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, redirectTarget);
      } catch {
        // Ignore storage errors
      }
    }
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result) {
        completeRedirect(result.redirectTo);
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Google sign-in could not be completed.'
      );
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);
    setResetSuccess(null);

    if (!resetEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.trim())) {
      setResetError('Please enter a valid email address.');
      return;
    }

    setResetLoading(true);
    try {
      await sendPasswordReset(resetEmail);
      setResetSuccess(
        'If an account exists for this email, a password reset link has been sent to your inbox.'
      );
    } catch (err) {
      setResetError(
        err instanceof Error ? err.message : 'Unable to send password reset email.'
      );
    } finally {
      setResetLoading(false);
    }
  };

  const displayedError = submitError || authError;

  return (
    <PageTransition>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-14 lg:pb-16 space-y-6">
        <div>
          <BackButton fallbackTo="/" label="Back" />
        </div>
        <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden shadow-sm grid grid-cols-1 lg:grid-cols-12 items-stretch">
          {/* Editorial Artwork Panel */}
          <div className="lg:col-span-5 relative hidden lg:flex flex-col justify-end p-8 bg-[#264653] text-[#FAF7F2] min-h-[540px]">
            <SafeImage
              src="/src/assets/images/art_cinematic_portrait_1794836299424.jpg"
              alt="Artisan ceramicist portrait"
              className="absolute inset-0 w-full h-full object-cover opacity-55"
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-[#264653] via-[#264653]/55 to-transparent"
              aria-hidden="true"
            />
            <div className="relative space-y-3">
              <p className="text-xs font-semibold text-[#2A9D8F]">
                ImageLab Community
              </p>
              <h2 className="text-2xl font-bold leading-snug">
                Return to your saved prompts and published studies.
              </h2>
              <p className="text-xs text-[#F4EDE4]/80 leading-relaxed">
                Curate collections, publish your own AI creations, and manage your creator profile.
              </p>
            </div>
          </div>

          {/* Login Form Panel */}
          <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-center">
            <div className="max-w-md w-full mx-auto space-y-6">
              <div>
                <p className="text-xs font-semibold text-[#2A9D8F] mb-1.5">
                  Welcome Back
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#264653]">
                  Login to ImageLab
                </h1>
                <p className="text-sm text-[#264653]/70 mt-1.5">
                  Sign in with Google or your email address.
                </p>
              </div>

              {!isConfigured && (
                <div
                  role="alert"
                  className="rounded-xl bg-[#E76F51]/10 border border-[#E76F51]/35 p-3.5 text-xs text-[#264653] leading-relaxed"
                >
                  Configuration missing: set{' '}
                  <span className="font-mono">{missingConfigKeys.join(', ')}</span> to enable sign-in.
                </div>
              )}

              {displayedError && (
                <div
                  role="alert"
                  className="rounded-xl bg-[#E76F51]/10 border border-[#E76F51]/35 p-3.5 flex items-start gap-2.5 text-xs font-medium text-[#264653] leading-relaxed"
                >
                  <AlertCircle
                    className="w-4 h-4 text-[#D05A3C] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>{displayedError}</span>
                </div>
              )}

              {/* Continue with Google */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={!isConfigured || googleLoading || submitting}
                className="w-full h-12 px-4 rounded-xl bg-white border border-[#264653]/18 hover:border-[#264653]/40 disabled:opacity-60 text-sm font-semibold text-[#264653] flex items-center justify-center gap-3 transition-colors shadow-2xs"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.91 6.72-4.91Z"
                  />
                </svg>
                <span>
                  {googleLoading ? 'Connecting with Google...' : 'Continue with Google'}
                </span>
              </button>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-[#264653]/12" />
                <span className="shrink-0 mx-3 text-xs text-[#264653]/50 font-medium">
                  or sign in with email
                </span>
                <div className="flex-grow border-t border-[#264653]/12" />
              </div>

              {/* Email Login Form */}
              <form onSubmit={handleEmailSubmit} noValidate className="space-y-4">
                <div>
                  <label
                    htmlFor="login-email"
                    className="block text-xs font-bold text-[#264653] mb-1.5"
                  >
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail
                      className="w-4 h-4 text-[#264653]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                      }}
                      placeholder="you@example.com"
                      className={`w-full h-11 pl-10 pr-4 rounded-xl bg-[#F4EDE4]/55 border text-sm text-[#264653] placeholder:text-[#264653]/40 focus:outline-none focus:ring-2 ${
                        errors.email
                          ? 'border-[#E76F51] focus:ring-[#E76F51]/25'
                          : 'border-[#264653]/15 focus:border-[#2A9D8F] focus:ring-[#2A9D8F]/20'
                      }`}
                    />
                  </div>
                  {errors.email && (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-[#D05A3C]">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{errors.email}</span>
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="login-password"
                      className="text-xs font-bold text-[#264653]"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setResetEmail(email);
                        setResetError(null);
                        setResetSuccess(null);
                        setForgotOpen(true);
                      }}
                      className="text-xs font-semibold text-[#2A9D8F] hover:text-[#218175]"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <div className="relative">
                    <Lock
                      className="w-4 h-4 text-[#264653]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                      }}
                      placeholder="Enter your password"
                      className={`w-full h-11 pl-10 pr-11 rounded-xl bg-[#F4EDE4]/55 border text-sm text-[#264653] placeholder:text-[#264653]/40 focus:outline-none focus:ring-2 ${
                        errors.password
                          ? 'border-[#E76F51] focus:ring-[#E76F51]/25'
                          : 'border-[#264653]/15 focus:border-[#2A9D8F] focus:ring-[#2A9D8F]/20'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#264653]/55 hover:text-[#264653]"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {errors.password && (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-[#D05A3C]">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{errors.password}</span>
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!isConfigured || submitting || googleLoading}
                  className="w-full h-12 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-sm font-semibold shadow-sm transition-colors"
                >
                  {submitting ? 'Signing in...' : 'Login'}
                </button>
              </form>

              <p className="text-center text-sm text-[#264653]/75">
                New to ImageLab?{' '}
                <Link
                  to={
                    redirectTarget
                      ? `/signup?redirect=${encodeURIComponent(redirectTarget)}`
                      : '/signup'
                  }
                  className="font-semibold text-[#2A9D8F] hover:text-[#218175] hover:underline"
                >
                  Create account
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {forgotOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-pw-title"
          className="fixed inset-0 z-50 bg-[#264653]/55 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#FAF7F2] border border-[#264653]/15 shadow-2xl p-6 sm:p-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="forgot-pw-title" className="text-lg font-bold text-[#264653]">
                Reset Password
              </h2>
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                aria-label="Close modal"
                className="p-2 rounded-xl text-[#264653]/70 hover:bg-[#F4EDE4]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-[#264653]/75 leading-relaxed">
              Enter your account email address and we will send you a password reset link.
            </p>

            {resetSuccess && (
              <div className="rounded-xl bg-[#2A9D8F]/10 border border-[#2A9D8F]/30 p-3 flex items-start gap-2 text-xs text-[#264653] leading-relaxed">
                <CheckCircle2 className="w-4 h-4 text-[#2A9D8F] shrink-0 mt-0.5" aria-hidden="true" />
                <span>{resetSuccess}</span>
              </div>
            )}

            <form onSubmit={handleForgotSubmit} noValidate className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => {
                    setResetEmail(e.target.value);
                    setResetError(null);
                  }}
                  placeholder="you@example.com"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/70 border border-[#264653]/15 text-sm text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                />
                {resetError && (
                  <p className="mt-1.5 text-xs font-medium text-[#D05A3C]">{resetError}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setForgotOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[#264653]/75 hover:bg-[#F4EDE4]"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="px-5 py-2.5 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                >
                  {resetLoading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageTransition>
  );
}
