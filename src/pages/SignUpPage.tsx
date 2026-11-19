import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { PageTransition } from '../components/PageTransition';
import { SafeImage } from '../components/SafeImage';
import { SeoHead } from '../components/SeoHead';
import { useAuth } from '../context/AuthContext';
import { getDashboardPathForRole } from '../server/rbac';

interface SignupErrors {
  fullName?: string;
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

const POST_AUTH_REDIRECT_KEY = 'imagelab_post_auth_redirect';

function sanitizeRedirectPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (trimmed === '/login' || trimmed === '/signup') return null;
  return trimmed;
}

export function SignUpPage() {
  const {
    firebaseUser,
    userProfile,
    authReady,
    isConfigured,
    registerWithEmail,
    signInWithGoogle,
    checkUsernameAvailable,
    authError,
    clearAuthError,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryRedirect = sanitizeRedirectPath(
    new URLSearchParams(location.search).get('redirect')
  );
  const storedRedirect = (() => {
    try {
      return sanitizeRedirectPath(sessionStorage.getItem(POST_AUTH_REDIRECT_KEY));
    } catch {
      return null;
    }
  })();
  const redirectTarget = queryRedirect || storedRedirect;
  const redirectTargetRef = useRef<string | null>(redirectTarget);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<SignupErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    return () => {
      clearAuthError();
    };
  }, []);

  useEffect(() => {
    if (redirectTarget) {
      redirectTargetRef.current = redirectTarget;
      try {
        sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, redirectTarget);
      } catch {
        // Ignore storage errors
      }
    }
  }, [redirectTarget]);

  const completeRedirect = (fallbackPath: string) => {
    const destination = redirectTarget || redirectTargetRef.current || fallbackPath;
    try {
      sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
    } catch {
      // Ignore storage errors
    }
    navigate(destination, { replace: true });
  };

  useEffect(() => {
    if (authReady && firebaseUser && userProfile) {
      completeRedirect(getDashboardPathForRole(userProfile.role));
    }
  }, [authReady, firebaseUser, userProfile, redirectTarget, navigate]);

  const handleUsernameBlur = async () => {
    const normalized = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!/^[a-z0-9_]{3,30}$/.test(normalized)) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const available = await checkUsernameAvailable(normalized);
    setUsernameStatus(available ? 'available' : 'taken');
    if (!available) {
      setErrors((p) => ({
        ...p,
        username: 'This username is already taken. Please choose another one.',
      }));
    }
  };

  const validate = (): boolean => {
    const next: SignupErrors = {};
    if (!fullName.trim() || fullName.trim().length < 2) {
      next.fullName = 'Please enter your full name (at least 2 characters).';
    }
    const normalizedUser = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUser)) {
      next.username = 'Use 3–30 lowercase letters, numbers, or underscores.';
    } else if (usernameStatus === 'taken') {
      next.username = 'This username is already taken. Please choose another one.';
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = 'Please enter a valid email address.';
    }
    if (
      !password ||
      password.length < 8 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      next.password =
        'Password must be at least 8 characters with uppercase, lowercase, and a number.';
    }
    if (confirmPassword !== password) {
      next.confirmPassword = 'Passwords do not match.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await registerWithEmail({
        fullName: fullName.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim(),
        password,
      });
      completeRedirect(result.redirectTo);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Unable to complete registration.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignup = async () => {
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
        err instanceof Error ? err.message : 'Google sign-up could not be completed.'
      );
    } finally {
      setGoogleLoading(false);
    }
  };

  const displayedError = submitError || authError;

  return (
    <PageTransition>
      <SeoHead
        title="Sign Up — ImageLab"
        description="Create a free ImageLab contributor account."
        canonicalPath="/signup"
        noindex
      />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-14 lg:pb-16 space-y-6">
        <div>
          <BackButton fallbackTo="/" label="Back" />
        </div>
        <div className="rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden shadow-sm grid grid-cols-1 lg:grid-cols-12 items-stretch">
          {/* Editorial Artwork Panel */}
          <div className="lg:col-span-5 relative hidden lg:flex flex-col justify-end p-8 bg-[#264653] text-[#FAF7F2] min-h-[600px]">
            <SafeImage
              src="/src/assets/images/art_fantasy_citadel_1794836300156.jpg"
              alt="Cloud Spire Observatory fantasy artwork"
              className="absolute inset-0 w-full h-full object-cover opacity-55"
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-[#264653] via-[#264653]/55 to-transparent"
              aria-hidden="true"
            />
            <div className="relative space-y-3">
              <p className="text-xs font-semibold text-[#E76F51]">
                Join ImageLab
              </p>
              <h2 className="text-2xl font-bold leading-snug">
                Publish your AI creations and share your prompt craft.
              </h2>
              <p className="text-xs text-[#F4EDE4]/80 leading-relaxed">
                Build a visual portfolio, bookmark inspiring styles, and connect with artists exploring generative photography, 3D, and illustration.
              </p>
            </div>
          </div>

          {/* Signup Form Panel */}
          <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-center">
            <div className="max-w-md w-full mx-auto space-y-5">
              <div>
                <p className="text-xs font-semibold text-[#E76F51] mb-1.5">
                  Create Account
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#264653]">
                  Sign Up for ImageLab
                </h1>
                <p className="text-sm text-[#264653]/70 mt-1.5">
                  Start curating prompts and sharing your visual studies.
                </p>
                {redirectTarget?.startsWith('/prompt/') && (
                  <p className="mt-2.5 rounded-xl bg-[#2A9D8F]/10 border border-[#2A9D8F]/25 px-3.5 py-2 text-xs font-medium text-[#264653]">
                    Create an account or sign in to return to the artwork and copy its full prompt.
                  </p>
                )}
              </div>

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

              <button
                type="button"
                onClick={handleGoogleSignup}
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
                  or create with email
                </span>
                <div className="flex-grow border-t border-[#264653]/12" />
              </div>

              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label
                      htmlFor="signup-name"
                      className="block text-xs font-bold text-[#264653] mb-1.5"
                    >
                      Full Name
                    </label>
                    <input
                      id="signup-name"
                      type="text"
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        if (errors.fullName) setErrors((p) => ({ ...p, fullName: undefined }));
                      }}
                      placeholder="Elena Vance"
                      className={`w-full h-11 px-3.5 rounded-xl bg-[#F4EDE4]/55 border text-sm text-[#264653] placeholder:text-[#264653]/40 focus:outline-none focus:ring-2 ${
                        errors.fullName
                          ? 'border-[#E76F51] focus:ring-[#E76F51]/25'
                          : 'border-[#264653]/15 focus:border-[#2A9D8F] focus:ring-[#2A9D8F]/20'
                      }`}
                    />
                    {errors.fullName && (
                      <p className="mt-1 text-xs font-medium text-[#D05A3C]">
                        {errors.fullName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="signup-username"
                      className="block text-xs font-bold text-[#264653] mb-1.5"
                    >
                      Username
                    </label>
                    <div className="relative">
                      <User
                        className="w-4 h-4 text-[#264653]/45 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        id="signup-username"
                        type="text"
                        value={username}
                        onBlur={handleUsernameBlur}
                        onChange={(e) => {
                          setUsername(e.target.value.toLowerCase());
                          setUsernameStatus('idle');
                          if (errors.username) setErrors((p) => ({ ...p, username: undefined }));
                        }}
                        placeholder="elenavance"
                        className={`w-full h-11 pl-9 pr-3.5 rounded-xl bg-[#F4EDE4]/55 border text-sm font-mono text-[#264653] placeholder:text-[#264653]/40 focus:outline-none focus:ring-2 ${
                          errors.username
                            ? 'border-[#E76F51] focus:ring-[#E76F51]/25'
                            : 'border-[#264653]/15 focus:border-[#2A9D8F] focus:ring-[#2A9D8F]/20'
                        }`}
                      />
                    </div>
                    {usernameStatus === 'available' && !errors.username && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#2A9D8F]">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Username available</span>
                      </p>
                    )}
                    {errors.username && (
                      <p className="mt-1 text-xs font-medium text-[#D05A3C]">
                        {errors.username}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="signup-email"
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
                      id="signup-email"
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
                    <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#D05A3C]">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{errors.email}</span>
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="signup-password"
                    className="block text-xs font-bold text-[#264653] mb-1.5"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      className="w-4 h-4 text-[#264653]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                      }}
                      placeholder="8+ chars, upper, lower & number"
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
                    <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#D05A3C]">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{errors.password}</span>
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="signup-confirm"
                    className="block text-xs font-bold text-[#264653] mb-1.5"
                  >
                    Confirm Password
                  </label>
                  <input
                    id="signup-confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (errors.confirmPassword)
                        setErrors((p) => ({ ...p, confirmPassword: undefined }));
                    }}
                    placeholder="Re-enter your password"
                    className={`w-full h-11 px-4 rounded-xl bg-[#F4EDE4]/55 border text-sm text-[#264653] placeholder:text-[#264653]/40 focus:outline-none focus:ring-2 ${
                      errors.confirmPassword
                        ? 'border-[#E76F51] focus:ring-[#E76F51]/25'
                        : 'border-[#264653]/15 focus:border-[#2A9D8F] focus:ring-[#2A9D8F]/20'
                    }`}
                  />
                  {errors.confirmPassword && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#D05A3C]">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{errors.confirmPassword}</span>
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!isConfigured || submitting || googleLoading}
                  className="w-full h-12 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-sm font-semibold shadow-sm transition-colors"
                >
                  {submitting ? 'Creating Account...' : 'Create Account'}
                </button>
              </form>

              <p className="text-center text-xs text-[#264653]/65 leading-relaxed">
                By creating an account, you agree to our{' '}
                <Link to="/terms" className="underline hover:text-[#264653]">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link to="/privacy" className="underline hover:text-[#264653]">
                  Privacy Policy
                </Link>
                .
              </p>

              <p className="text-center text-sm text-[#264653]/75">
                Already have an account?{' '}
                <Link
                  to={
                    redirectTarget
                      ? `/login?redirect=${encodeURIComponent(redirectTarget)}`
                      : '/login'
                  }
                  className="font-semibold text-[#2A9D8F] hover:text-[#218175] hover:underline"
                >
                  Login here
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
