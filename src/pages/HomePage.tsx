import { ArrowRight, Layers, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { HeroShelf3D } from '../components/HeroShelf3D';
import { LandingCursor } from '../components/LandingCursor';
import { PageTransition } from '../components/PageTransition';
import { PromptCard } from '../components/PromptCard';
import { SafeImage } from '../components/SafeImage';
import { SeoHead, resolveCanonicalOrigin } from '../components/SeoHead';
import { useApp } from '../context/AppContext';

export function HomePage() {
  const { prompts } = useApp();
  const leadPrompt = prompts[0];

  const trendingToday = (() => {
    const todayMatches = prompts.filter((p) => p.trendingCollections.includes('today'));
    if (todayMatches.length >= 4) return todayMatches.slice(0, 4);
    const seen = new Set(todayMatches.map((p) => p.id));
    return [...todayMatches, ...prompts.filter((p) => !seen.has(p.id))].slice(0, 4);
  })();

  const curatedRecent = prompts.slice(0, 6);
  const calloutPair = prompts.slice(0, 2);
  const canonicalOrigin = resolveCanonicalOrigin();

  return (
    <PageTransition>
      <SeoHead
        title="ImageLab — Discover the Art Behind Every AI Image"
        description="Explore curated AI artworks, inspect creation details, and discover prompts shared by visual creators on ImageLab."
        canonicalPath="/"
        imageUrl={leadPrompt?.imageUrl}
        structuredData={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'ImageLab Curated AI Artwork Gallery',
          url: `${canonicalOrigin}/`,
          description:
            'Explore curated AI artworks, inspect creation details, and discover prompts shared by visual creators on ImageLab.',
        }}
      />

      {/* Desktop fine-pointer custom cursor scoped strictly to the landing page */}
      <LandingCursor active />

      {/* Hero Section: ImageLab Interactive 3D AI Artwork Shelf */}
      <div
        data-ad-slot="homepage_hero"
        data-ad-label="Homepage Hero Section"
      >
        <HeroShelf3D />
      </div>

      {/* Desktop Homepage Banner (728×90) positioned cleanly below the 3D shelf */}
      <div
        data-ad-slot="desktop_homepage_banner"
        data-ad-label="Desktop Homepage Banner (728×90)"
        className="hidden lg:block max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 [&[data-ad-has-visible='true']]:pt-8 empty:hidden"
      />

      {/* Trending Today Preview (2-Column 9:16 Pure Artwork Grid) */}
      {trendingToday.length > 0 && (
        <section
          data-ad-slot="homepage_trending"
          data-ad-label="Homepage Trending Section"
          className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 lg:pt-20"
        >
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#E76F51] mb-1.5">
                Trending Today
              </p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#264653]">
                Most Studied Creations Right Now
              </h2>
            </div>
            <Link
              to="/trending"
              data-cursor="control"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2A9D8F] hover:text-[#218175] transition-colors whitespace-nowrap shrink-0"
            >
              <span>Explore Trending Charts</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3.5 sm:gap-5 lg:gap-6">
            {trendingToday.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} />
            ))}
          </div>
        </section>
      )}

      <div
        data-ad-slot="homepage_gallery_banner"
        data-ad-label="Homepage Content / Gallery Banner (300×250)"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 [&[data-ad-has-visible='true']]:pt-10 empty:hidden"
      />

      {/* Curated Community Archive (2-Column 9:16 Grid + Optional Desktop Sidebar Ad) */}
      {curatedRecent.length > 0 && (
        <section
          data-ad-slot="homepage_gallery"
          data-ad-label="Homepage Curated Gallery"
          className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 lg:pt-20"
        >
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#264653]/60 mb-1.5">
                Community Archive
              </p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#264653]">
                Freshly Curated Visual Studies
              </h2>
            </div>
            <Link
              to="/explore"
              data-cursor="control"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E76F51] hover:text-[#D05A3C] transition-colors whitespace-nowrap shrink-0"
            >
              <span>Open Full Gallery</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-start [&:has(aside[data-ad-has-visible='true'])]:gap-6">
            <div className="flex-1 min-w-0 grid grid-cols-2 gap-3.5 sm:gap-5 lg:gap-6">
              {curatedRecent.map((prompt) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </div>
            <aside
              data-ad-slot="desktop_sidebar_banner"
              data-ad-label="Desktop Sidebar Banner (160×600)"
              className="hidden lg:block shrink-0 w-0 overflow-hidden [&[data-ad-has-visible='true']]:w-[196px] [&[data-ad-has-visible='true']]:overflow-visible lg:sticky lg:top-24"
            />
          </div>
        </section>
      )}

      {/* Editorial Publishing Callout */}
      <section
        data-ad-slot="homepage_callout"
        data-ad-label="Homepage Editorial Callout"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 lg:pt-20 pb-10"
      >
        <div className="rounded-3xl bg-[#264653] text-[#FAF7F2] p-8 sm:p-12 lg:p-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center overflow-hidden">
          <div className="lg:col-span-7 space-y-4">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#2A9D8F]">
              <Layers className="w-4 h-4" aria-hidden="true" />
              <span>Open Prompt Craft</span>
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-balance">
              Every great visual experiment begins with a well-crafted prompt.
            </h2>
            <p className="text-sm sm:text-base text-[#F4EDE4]/78 leading-relaxed max-w-xl">
              Upload your latest AI artwork, attach your prompt privately for signed-in members, and inspire creators across the ImageLab community.
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <Link
                to="/publish"
                data-cursor="control"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                <span>Publish a Prompt</span>
              </Link>
              <Link
                to="/about"
                data-cursor="control"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#FAF7F2]/10 hover:bg-[#FAF7F2]/18 text-[#FAF7F2] text-sm font-semibold transition-colors whitespace-nowrap"
              >
                <span>About ImageLab</span>
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5 grid grid-cols-2 gap-3.5">
            {calloutPair.length > 0 ? (
              calloutPair.map((item, idx) => (
                <Link
                  key={item.id}
                  to={`/prompt/${item.id}`}
                  data-cursor="shelf-card"
                  className={`aspect-[9/16] rounded-2xl overflow-hidden border border-white/10 block ${
                    idx === 1 ? 'translate-y-3' : ''
                  }`}
                >
                  <SafeImage
                    src={item.imageUrl}
                    alt={item.title}
                    fallbackTitle={item.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                </Link>
              ))
            ) : (
              <>
                <div className="aspect-[9/16] rounded-2xl border border-white/10 bg-[#355C6B]/40" />
                <div className="aspect-[9/16] rounded-2xl border border-white/10 bg-[#355C6B]/25 translate-y-3" />
              </>
            )}
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
