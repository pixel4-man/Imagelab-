import { Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AdsManagerWorkspace } from '../components/AdsManagerWorkspace';
import { BackButton } from '../components/BackButton';
import { PageTransition } from '../components/PageTransition';
import { SeoHead } from '../components/SeoHead';
import { useAuth } from '../context/AuthContext';

export function AdsManagerPage() {
  const { userProfile } = useAuth();

  return (
    <PageTransition>
      <SeoHead
        title="Ads Manager — ImageLab"
        description="Visual advertisement placement management for ImageLab."
        canonicalPath="/admin/ads"
        noindex
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <BackButton fallbackTo="/admin" label="Back" />
          <Link
            to="/admin"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#264653] hover:bg-[#355C6B] text-white text-xs font-semibold transition-colors min-h-[40px]"
          >
            <Shield className="w-4 h-4" aria-hidden="true" />
            <span>Admin Dashboard</span>
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#E76F51] mb-1">
              Administration · Visual Monetization
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight text-[#264653]">
              Ads Manager
            </h1>
            <p className="text-sm text-[#264653]/75 mt-1">
              Select advertisement placements visually on the live website, preview creatives safely in Test Mode, and manage custom ad tags.
            </p>
          </div>
          {userProfile?.role === 'super_admin' && (
            <Link
              to="/super-admin"
              className="text-xs font-semibold text-[#2A9D8F] hover:underline whitespace-nowrap shrink-0"
            >
              Super Admin Console →
            </Link>
          )}
        </div>

        <AdsManagerWorkspace />
      </div>
    </PageTransition>
  );
}
