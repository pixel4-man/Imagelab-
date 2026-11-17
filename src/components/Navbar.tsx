import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bookmark,
  ChevronDown,
  Compass,
  Flame,
  Home,
  Info,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  PlusCircle,
  Shield,
  ShieldCheck,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

export function ImageLabLogo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          x="1.5"
          y="1.5"
          width="25"
          height="25"
          rx="7"
          fill={inverted ? '#FAF7F2' : '#264653'}
        />
        <circle cx="14" cy="14" r="5.5" stroke="#E76F51" strokeWidth="2.4" />
        <circle cx="19.5" cy="8.5" r="1.5" fill="#2A9D8F" />
      </svg>
      <span
        className={`font-display text-lg font-extrabold tracking-tight ${
          inverted ? 'text-[#FAF7F2]' : 'text-[#264653]'
        }`}
      >
        ImageLab
      </span>
    </span>
  );
}

const MOBILE_NAV_ITEMS = [
  { to: '/', label: 'Homepage', icon: Home, end: true },
  { to: '/explore', label: 'Explore Prompts', icon: Compass },
  { to: '/trending', label: 'Trending', icon: Flame },
  { to: '/publish', label: 'Share Your Creations', icon: PlusCircle },
  { to: '/saved', label: 'Saved Prompts', icon: Bookmark, showSavedCount: true },
  { to: '/profile', label: 'User Profile', icon: User },
  { to: '/about', label: 'About ImageLab', icon: Info },
  { to: '/contact', label: 'Contact', icon: Mail },
] as const;

export function Navbar() {
  const { savedIds } = useApp();
  const { firebaseUser, userProfile, authReady, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const isPrivilegedAdmin =
    Boolean(authReady && firebaseUser && userProfile) &&
    (userProfile?.role === 'admin' || userProfile?.role === 'super_admin');
  const isSuperAdmin =
    Boolean(authReady && firebaseUser && userProfile) &&
    userProfile?.role === 'super_admin';

  useEffect(() => {
    setDrawerOpen(false);
    setAccountMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!drawerOpen && !accountMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        setAccountMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, accountMenuOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(e.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [accountMenuOpen]);

  const handleLogout = async () => {
    await logout();
    setDrawerOpen(false);
    setAccountMenuOpen(false);
    navigate('/');
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51] rounded ${
      isActive
        ? 'text-[#E76F51] after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:bg-[#E76F51] after:rounded-full'
        : 'text-[#264653]/85 hover:text-[#264653]'
    }`;

  return (
    <>
      <header className="sticky top-0 z-40 w-full bg-[#F4EDE4]/94 backdrop-blur-md border-b border-[#264653]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 lg:gap-6">
          {/* Left: ImageLab Logo */}
          <Link
            to="/"
            aria-label="ImageLab Homepage"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51] rounded-lg shrink-0"
          >
            <ImageLabLogo />
          </Link>

          {/* Center: Clean Horizontal One-Line Public Navigation (Desktop) */}
          <nav
            aria-label="Primary Navigation"
            className="hidden lg:flex items-center gap-6 xl:gap-8"
          >
            <NavLink to="/" end className={navLinkClass}>
              Homepage
            </NavLink>
            <NavLink to="/explore" className={navLinkClass}>
              Explore Prompts
            </NavLink>
            <NavLink to="/trending" className={navLinkClass}>
              Trending
            </NavLink>
            <NavLink
              to="/publish"
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51] ${
                  isActive
                    ? 'bg-[#D05A3C] text-white shadow-sm'
                    : 'bg-[#E76F51] hover:bg-[#D05A3C] text-white shadow-2xs'
                }`
              }
            >
              <PlusCircle className="w-4 h-4" aria-hidden="true" />
              <span>Share Your Creations</span>
            </NavLink>
          </nav>

          {/* Right: Saved + Auth Controls (Desktop — zero search bar, zero Dashboard button, zero public admin options) */}
          <div className="hidden lg:flex items-center gap-2.5 shrink-0">
            <Link
              to="/saved"
              aria-label={`Saved Prompts (${savedIds.length})`}
              title="Saved Prompts"
              className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl text-[#264653]/80 hover:text-[#264653] hover:bg-[#FAF7F2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A9D8F]"
            >
              <Bookmark className="w-4 h-4" aria-hidden="true" />
              {savedIds.length > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#2A9D8F] text-white text-[10px] font-mono font-semibold flex items-center justify-center tabular-nums">
                  {savedIds.length}
                </span>
              )}
            </Link>

            {!authReady ? (
              <div
                className="w-28 h-10 rounded-xl bg-[#FAF7F2]/80 animate-pulse"
                aria-hidden="true"
              />
            ) : firebaseUser && userProfile ? (
              <div className="relative flex items-center gap-2" ref={accountMenuRef}>
                {isPrivilegedAdmin ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setAccountMenuOpen((prev) => !prev)}
                      aria-expanded={accountMenuOpen}
                      aria-haspopup="menu"
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FAF7F2] border border-[#264653]/14 hover:border-[#2A9D8F] text-xs font-bold text-[#264653] transition-colors min-h-[40px]"
                    >
                      <span className="w-6 h-6 rounded-lg bg-[#264653] text-[#FAF7F2] flex items-center justify-center text-[11px] font-bold">
                        {userProfile.fullName.charAt(0).toUpperCase()}
                      </span>
                      <span className="max-w-[110px] truncate">{userProfile.fullName}</span>
                      <ChevronDown className="w-3.5 h-3.5 text-[#264653]/60" aria-hidden="true" />
                    </button>

                    {accountMenuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 top-12 w-64 rounded-2xl bg-[#FAF7F2] border border-[#264653]/14 shadow-xl py-2 z-50"
                      >
                        <div className="px-4 py-2 border-b border-[#264653]/10">
                          <p className="text-xs font-bold text-[#264653] truncate">
                            {userProfile.fullName}
                          </p>
                          <p className="text-[11px] font-mono text-[#264653]/60 truncate">
                            @{userProfile.username}
                          </p>
                        </div>

                        <div className="py-1">
                          <Link
                            to="/profile"
                            role="menuitem"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#264653] hover:bg-[#F4EDE4]"
                          >
                            <User className="w-4 h-4 text-[#264653]/70" aria-hidden="true" />
                            <span>User Profile</span>
                          </Link>
                          <Link
                            to="/saved"
                            role="menuitem"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-[#264653] hover:bg-[#F4EDE4]"
                          >
                            <Bookmark className="w-4 h-4 text-[#264653]/70" aria-hidden="true" />
                            <span>Saved Prompts ({savedIds.length})</span>
                          </Link>
                        </div>

                        {/* Role-Gated ADMINISTRATION Section */}
                        <div className="mt-1 pt-2 border-t border-[#264653]/12">
                          <p className="px-4 pb-1.5 text-[10px] font-bold tracking-wider uppercase text-[#E76F51]">
                            ADMINISTRATION
                          </p>
                          <Link
                            to="/admin"
                            role="menuitem"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-[#264653] hover:bg-[#F4EDE4]"
                          >
                            <Shield className="w-4 h-4 text-[#2A9D8F]" aria-hidden="true" />
                            <span>Admin Dashboard</span>
                          </Link>
                          <Link
                            to="/admin/ads"
                            role="menuitem"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-[#264653] hover:bg-[#F4EDE4]"
                          >
                            <Megaphone className="w-4 h-4 text-[#E76F51]" aria-hidden="true" />
                            <span>Ads Manager</span>
                          </Link>
                          <Link
                            to="/admin?tab=official"
                            role="menuitem"
                            className="flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-[#264653] hover:bg-[#F4EDE4]"
                          >
                            <Sparkles className="w-4 h-4 text-[#264653]/80" aria-hidden="true" />
                            <span>Official Publishing</span>
                          </Link>
                          {isSuperAdmin && (
                            <Link
                              to="/super-admin"
                              role="menuitem"
                              className="flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-[#264653] hover:bg-[#F4EDE4]"
                            >
                              <ShieldCheck className="w-4 h-4 text-[#E76F51]" aria-hidden="true" />
                              <span>Super Admin Console</span>
                            </Link>
                          )}
                        </div>

                        <div className="mt-1 pt-1 border-t border-[#264653]/10">
                          <button
                            type="button"
                            onClick={handleLogout}
                            role="menuitem"
                            className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-[#D05A3C] hover:bg-[#E76F51]/8"
                          >
                            <LogOut className="w-4 h-4" aria-hidden="true" />
                            <span>Sign Out</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <Link
                      to="/profile"
                      aria-label="User Profile"
                      title={`Signed in as @${userProfile.username}`}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FAF7F2] border border-[#264653]/12 text-xs font-bold text-[#264653] hover:border-[#2A9D8F] transition-colors min-h-[40px]"
                    >
                      <span className="w-6 h-6 rounded-lg bg-[#264653] text-[#FAF7F2] flex items-center justify-center text-[11px] font-bold">
                        {userProfile.fullName.charAt(0).toUpperCase()}
                      </span>
                      <span className="max-w-[110px] truncate">Profile</span>
                    </Link>

                    <button
                      type="button"
                      onClick={handleLogout}
                      aria-label="Sign out"
                      title="Sign out"
                      className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-[#264653]/75 hover:text-[#E76F51] hover:bg-[#FAF7F2] transition-colors"
                    >
                      <LogOut className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                <Link
                  to="/login"
                  className="px-3 py-2 text-sm font-medium text-[#264653]/85 hover:text-[#264653] transition-colors whitespace-nowrap shrink-0"
                >
                  Login
                </Link>

                <Link
                  to="/signup"
                  className="px-3.5 py-2 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>

          {/* Mobile Controls */}
          <div className="flex lg:hidden items-center gap-2 shrink-0">
            <Link
              to="/publish"
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-xs font-semibold whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Share Your Creations</span>
            </Link>

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              aria-controls="mobile-navigation-drawer"
              aria-label="Open navigation menu"
              className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[#FAF7F2] border border-[#264653]/12 text-[#264653] hover:bg-[#E8DEC8]/50 transition-colors"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* Right-Side Slide-In Mobile Navigation Drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 bg-[#264653]/45 backdrop-blur-xs"
              aria-hidden="true"
            />

            {/* Slide-In Panel from Right */}
            <motion.aside
              id="mobile-navigation-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation Drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-[340px] bg-[#FAF7F2] border-l border-[#264653]/12 shadow-2xl flex flex-col overflow-y-auto"
            >
              {/* Drawer Header with Close Button */}
              <div className="sticky top-0 z-10 bg-[#FAF7F2]/95 backdrop-blur-xs px-5 py-4 border-b border-[#264653]/10 flex items-center justify-between gap-3">
                <Link
                  to="/"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="ImageLab Homepage"
                >
                  <ImageLabLogo />
                </Link>

                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close navigation menu"
                  className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[#F4EDE4] text-[#264653] hover:bg-[#E8DEC8] transition-colors"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              {/* Single-Column Vertical Navigation List */}
              <div className="p-4 flex-1 flex flex-col justify-between gap-6">
                <div className="space-y-6">
                  <nav aria-label="Mobile Navigation" className="flex flex-col gap-1.5">
                    {MOBILE_NAV_ITEMS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={'end' in item ? item.end : false}
                          onClick={() => setDrawerOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm font-semibold min-h-[46px] transition-colors ${
                              isActive
                                ? 'bg-[#264653] text-[#FAF7F2]'
                                : 'text-[#264653] hover:bg-[#F4EDE4]'
                            }`
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span className="flex items-center gap-3 min-w-0">
                                <Icon
                                  className={`w-4 h-4 shrink-0 ${
                                    isActive ? 'text-[#E76F51]' : 'text-[#2A9D8F]'
                                  }`}
                                  aria-hidden="true"
                                />
                                <span className="truncate">{item.label}</span>
                              </span>
                              {'showSavedCount' in item &&
                                item.showSavedCount &&
                                savedIds.length > 0 && (
                                  <span
                                    className={`px-2 py-0.5 rounded-md text-[11px] font-mono tabular-nums ${
                                      isActive
                                        ? 'bg-[#FAF7F2]/18 text-[#FAF7F2]'
                                        : 'bg-[#2A9D8F]/14 text-[#218175]'
                                    }`}
                                  >
                                    {savedIds.length}
                                  </span>
                                )}
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </nav>

                  {/* Strictly Role-Gated ADMINISTRATION Section (Hidden from Visitors & Contributors) */}
                  {isPrivilegedAdmin && (
                    <section
                      aria-label="Administration"
                      className="pt-4 border-t border-[#264653]/12 space-y-1.5"
                    >
                      <h2 className="px-4 pb-1 text-[11px] font-bold tracking-wider uppercase text-[#E76F51]">
                        ADMINISTRATION
                      </h2>

                      <NavLink
                        to="/admin"
                        end
                        onClick={() => setDrawerOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold min-h-[46px] transition-colors ${
                            isActive
                              ? 'bg-[#264653] text-[#FAF7F2]'
                              : 'text-[#264653] hover:bg-[#F4EDE4]'
                          }`
                        }
                      >
                        <Shield className="w-4 h-4 text-[#2A9D8F] shrink-0" aria-hidden="true" />
                        <span>Admin Dashboard</span>
                      </NavLink>

                      <NavLink
                        to="/admin/ads"
                        onClick={() => setDrawerOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold min-h-[46px] transition-colors ${
                            isActive
                              ? 'bg-[#264653] text-[#FAF7F2]'
                              : 'text-[#264653] hover:bg-[#F4EDE4]'
                          }`
                        }
                      >
                        <Megaphone className="w-4 h-4 text-[#E76F51] shrink-0" aria-hidden="true" />
                        <span>Ads Manager</span>
                      </NavLink>

                      <NavLink
                        to="/admin?tab=official"
                        onClick={() => setDrawerOpen(false)}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold min-h-[46px] text-[#264653] hover:bg-[#F4EDE4] transition-colors"
                      >
                        <Sparkles className="w-4 h-4 text-[#264653]/75 shrink-0" aria-hidden="true" />
                        <span>Official Publishing</span>
                      </NavLink>

                      {isSuperAdmin && (
                        <NavLink
                          to="/super-admin"
                          onClick={() => setDrawerOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold min-h-[46px] transition-colors ${
                              isActive
                                ? 'bg-[#264653] text-[#FAF7F2]'
                                : 'text-[#264653] hover:bg-[#F4EDE4]'
                            }`
                          }
                        >
                          <ShieldCheck className="w-4 h-4 text-[#E76F51] shrink-0" aria-hidden="true" />
                          <span>Super Admin Console</span>
                        </NavLink>
                      )}
                    </section>
                  )}
                </div>

                {/* Account Footer Controls */}
                <div className="pt-4 border-t border-[#264653]/12 space-y-2.5">
                  {firebaseUser && userProfile ? (
                    <div className="space-y-3">
                      <div className="px-3 py-2 rounded-xl bg-[#F4EDE4]/70">
                        <p className="text-xs font-bold text-[#264653] truncate">
                          {userProfile.fullName}
                        </p>
                        <p className="text-[11px] font-mono text-[#264653]/65 truncate">
                          @{userProfile.username}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full inline-flex items-center justify-center gap-2 min-h-[46px] px-4 py-2.5 rounded-xl border border-[#264653]/20 text-sm font-semibold text-[#D05A3C] hover:bg-[#E76F51]/8 transition-colors"
                      >
                        <LogOut className="w-4 h-4" aria-hidden="true" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Link
                        to="/login"
                        onClick={() => setDrawerOpen(false)}
                        className="w-full inline-flex items-center justify-center min-h-[46px] px-4 py-2.5 rounded-xl border border-[#264653]/20 text-sm font-semibold text-[#264653] hover:bg-[#F4EDE4] transition-colors"
                      >
                        Login
                      </Link>
                      <Link
                        to="/signup"
                        onClick={() => setDrawerOpen(false)}
                        className="w-full inline-flex items-center justify-center min-h-[46px] px-4 py-2.5 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white text-sm font-semibold transition-colors"
                      >
                        Sign Up
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
