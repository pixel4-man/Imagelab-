/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MotionConfig } from 'motion/react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Footer } from './components/Footer';
import { Navbar } from './components/Navbar';
import { ScrollToTop } from './components/PageTransition';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Toast } from './components/Toast';
import { VisualAdInjector, isPublicAdRoute } from './components/VisualAdInjector';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { AboutPage } from './pages/AboutPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { ContactPage } from './pages/ContactPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExplorePage } from './pages/ExplorePage';
import { HomePage } from './pages/HomePage';
import { LegalPage } from './pages/LegalPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { PromptDetailsPage } from './pages/PromptDetailsPage';
import { PublishPage } from './pages/PublishPage';
import { SavedPromptsPage } from './pages/SavedPromptsPage';
import { SignUpPage } from './pages/SignUpPage';
import { SuperAdminDashboardPage } from './pages/SuperAdminDashboardPage';
import { TrendingPage } from './pages/TrendingPage';

function AppShell() {
  const location = useLocation();
  const showPublicAds = isPublicAdRoute(location.pathname);

  return (
    <div className="min-h-screen flex flex-col bg-[#F4EDE4] text-[#264653]">
      <Navbar />
      {showPublicAds && (
        <>
          <div
            data-ad-slot="desktop_header_banner"
            data-ad-label="Desktop Header Banner (468×60)"
            className="hidden lg:flex justify-center w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 [&[data-ad-has-visible='true']]:py-2 empty:hidden"
          />
          <div
            data-ad-slot="mobile_header_banner"
            data-ad-label="Mobile Header Banner (320×50)"
            className="flex lg:hidden justify-center w-full max-w-full overflow-hidden px-1.5 [&[data-ad-has-visible='true']]:py-2 empty:hidden"
          />
        </>
      )}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/trending" element={<TrendingPage />} />
          <Route path="/categories" element={<Navigate to="/explore" replace />} />
          <Route path="/prompt/:id" element={<PromptDetailsPage />} />
          <Route path="/publish" element={<PublishPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route
            path="/profile"
            element={
              <ProtectedRoute requiredRole="contributor">
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route path="/creator/:username" element={<ProfilePage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requiredRole="contributor">
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/super-admin"
            element={
              <ProtectedRoute requiredRole="super_admin">
                <SuperAdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/saved" element={<SavedPromptsPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/privacy" element={<LegalPage type="privacy" />} />
          <Route path="/terms" element={<LegalPage type="terms" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
      <VisualAdInjector />
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <AppProvider>
          <BrowserRouter>
            <ScrollToTop />
            <AppShell />
          </BrowserRouter>
        </AppProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
