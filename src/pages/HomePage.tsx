import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Layers, Plus, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageTransition } from '../components/PageTransition';
import { PromptCard } from '../components/PromptCard';
import { SafeImage } from '../components/SafeImage';
import { SeoHead, resolveCanonicalOrigin } from '../components/SeoHead';
import { useApp } from '../context/AppContext';

export function HomePage() {
  const { prompts, getCreator } = useApp();
  const [heroIndex, setHeroIndex] = useState(0);

  const heroArtworks = prompts.slice(0, 5);
  const activeHero = heroArtworks[heroIndex] || prompts[0];
  const activeCreator = getCreator(activeHero.creatorUsername);

  useEffect(() => {
    if (heroArtworks.length === 0) return;
    const interval = window.setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % heroArtworks.length);
    }, 6500);
    return () => window.clearInterval(interval);
  }, [heroArtworks.length]);

  const trendingToday = prompts
    .filter((p) => p.trendingCollections.includes('today'))
    .slice(0, 3);

  const curatedRecent = prompts.slice(0, 6);

  const canonicalOrigin = resolveCanonicalOrigin();

  return (
    <PageTransition>
      <SeoHead
        title="ImageLab — Discover the Art Behind Every AI Image"
        description="Explore curated AI artworks, inspect creation details, and discover prompts shared by visual creators on ImageLab."
        canonicalPath="/"
        imageUrl={activeHero?.imageUrl}
        structuredData={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'ImageLab Curated AI Artwork Gallery',
          url: `${canonicalOrigin}/`,
          description:
            'Explore curated AI artworks, inspect creation details, and discover prompts shared by visual creators on ImageLab.',
        }}
      />
      {/* Hero Section with Animated AI Artwork Backdrop & Spotlight */}
      <section
        data-ad-slot="homepage_hero"
        data-ad-label="Homepage Hero Section"
        className="relative overflow-hidden border-b border-[#264653]/10 bg-[#F4EDE4]"
      >
        {/* Animated AI Artwork Background Layer */}
        <div className="absolute inset-0 pointer-events-none select-none overflow-hidden" aria-hidden="true">
          <AnimatePresence mode="sync">
            <motion.div
              key={activeHero.id}
              initial={{ opacity: 0, scale: 1.06 }}
              animate={{ opacity: 0.24, scale: 1.0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0"
            >
              <SafeImage
                src={activeHero.imageUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            </motion.div>
          </AnimatePresence>
          <div className="absolute inset-0 bg-gradient-to-r from-[#F4EDE4] via-[#F4EDE4]/92 to-[#F4EDE4]/65" />
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#F4EDE4] to-transparent" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-14 lg:pt-16 lg:pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            {/* Left Editorial Column */}
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-semibold tracking-wide text-[#2A9D8F] mb-4">
                Curated AI Artwork & Prompt Archive
              </p>

              <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-extrabold tracking-tight text-[#264653] leading-[1.08] text-balance mb-6">
                Discover the Art Behind Every AI Image.
              </h1>

              <p className="text-base sm:text-lg text-[#264653]/80 leading-relaxed max-w-xl mb-8">
                Explore extraordinary AI creations. Open any artwork to inspect its creation and copy the complete generation prompt.
              </p>

              <div className="flex flex-wrap items-center gap-3.5">
                <Link
                  to="/explore"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white font-semibold text-sm shadow-sm transition-all min-h-[48px] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F4EDE4]"
                >
                  <span>Explore Prompts</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>

                <Link
                  to="/publish"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[#2A9D8F] hover:bg-[#218175] text-white font-semibold text-sm shadow-sm transition-all min-h-[48px] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A9D8F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F4EDE4]"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Share Your Creation</span>
                </Link>
              </div>
            </div>

            {/* Right Interactive Artwork Spotlight Card (Zero public prompt preview or copy button) */}
            <div className="lg:col-span-6 flex flex-col">
              <div className="relative flex-1 rounded-2xl overflow-hidden bg-[#FAF7F2] border border-[#264653]/12 shadow-[0_20px_50px_-15px_rgba(38,70,83,0.22)] flex flex-col">
                <Link
                  to={`/prompt/${activeHero.id}`}
                  className="relative block aspect-[16/10] lg:aspect-auto lg:flex-1 min-h-[280px] overflow-hidden bg-[#E8DEC8]"
                >
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeHero.id}
                      initial={{ opacity: 0.4, scale: 1.03 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0.4 }}
                      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                      className="w-full h-full"
                    >
                      <SafeImage
                        src={activeHero.imageUrl}
                        alt={activeHero.title}
                        fallbackTitle={activeHero.title}
                        className="w-full h-full object-cover"
                      />
                    </motion.div>
                  </AnimatePresence>
                  <div
                    className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#264653]/85 via-[#264653]/35 to-transparent"
                    aria-hidden="true"
                  />
                  <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between gap-4 text-[#FAF7F2]">
                    <div className="min-w-0">
                      <p className="text-xs text-[#FAF7F2]/85 mb-0.5 truncate">
                        @{activeCreator.username}
                      </p>
                      <h2 className="text-lg font-bold tracking-tight truncate">
                        {activeHero.title}
                      </h2>
                    </div>
                    <span className="text-xs font-sans font-semibold tabular-nums text-[#FAF7F2]/90 shrink-0">
                      {String(heroIndex + 1).padStart(2, '0')} / {String(heroArtworks.length).padStart(2, '0')}
                    </span>
                  </div>
                </Link>

                {/* Clean Thumbnail Selector & View Details Bar */}
                <div className="p-4 sm:p-5 bg-[#FAF7F2] border-t border-[#264653]/10">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                      {heroArtworks.map((item, idx) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setHeroIndex(idx)}
                          aria-label={`Preview ${item.title}`}
                          className={`relative w-12 h-9 rounded-lg overflow-hidden border-2 transition-all shrink-0 ${
                            idx === heroIndex
                              ? 'border-[#E76F51] scale-105'
                              : 'border-transparent opacity-65 hover:opacity-100'
                          }`}
                        >
                          <SafeImage
                            src={item.imageUrl}
                            alt={item.title}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>

                    <Link
                      to={`/prompt/${activeHero.id}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#264653] hover:bg-[#E76F51] text-[#FAF7F2] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>View Details</span>
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Full-width Highlights Bar below Hero Split */}
          <div className="mt-12 pt-8 border-t border-[#264653]/10 grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-2xl font-extrabold font-display text-[#264653] tabular-nums">
                {prompts.length}+
              </p>
              <p className="text-xs text-[#264653]/70 mt-0.5">
                Curated prompt artworks
              </p>
            </div>
            <div>
              <p className="text-2xl font-extrabold font-display text-[#264653] tabular-nums">
                Open
              </p>
              <p className="text-xs text-[#264653]/70 mt-0.5">
                Community & official archive
              </p>
            </div>
            <div>
              <p className="text-2xl font-extrabold font-display text-[#264653] tabular-nums">
                100%
              </p>
              <p className="text-xs text-[#264653]/70 mt-0.5">
                Verified creations with creator credits
              </p>
            </div>
            <div>
              <p className="text-2xl font-extrabold font-display text-[#264653] tabular-nums">
                1-Click
              </p>
              <p className="text-xs text-[#264653]/70 mt-0.5">
                Member prompt copy & collection saving
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trending Today Preview */}
      <section
        data-ad-slot="homepage_trending"
        data-ad-label="Homepage Trending Section"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 lg:pt-20"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <p className="text-xs font-semibold text-[#E76F51] mb-1.5">
              Trending Today
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#264653]">
              Most Studied Creations Right Now
            </h2>
          </div>
          <Link
            to="/trending"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2A9D8F] hover:text-[#218175] transition-colors whitespace-nowrap shrink-0"
          >
            <span>Explore Trending Charts</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {trendingToday.map((prompt, index) => (
            <PromptCard key={prompt.id} prompt={prompt} rank={index + 1} />
          ))}
        </div>
      </section>

      {/* Curated Prompt Gallery */}
      <section
        data-ad-slot="homepage_gallery"
        data-ad-label="Homepage Curated Gallery"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 lg:pt-20"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <p className="text-xs font-semibold text-[#264653]/60 mb-1.5">
              Community Archive
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#264653]">
              Freshly Curated Visual Studies
            </h2>
          </div>
          <Link
            to="/explore"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E76F51] hover:text-[#D05A3C] transition-colors whitespace-nowrap shrink-0"
          >
            <span>Open Full Gallery</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {curatedRecent.map((prompt) => (
            <PromptCard key={prompt.id} prompt={prompt} />
          ))}
        </div>
      </section>

      {/* Editorial Publishing Callout */}
      <section
        data-ad-slot="homepage_callout"
        data-ad-label="Homepage Editorial Callout"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 lg:pt-20 pb-8"
      >
        <div className="rounded-3xl bg-[#264653] text-[#FAF7F2] p-8 sm:p-12 lg:p-14 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center overflow-hidden">
          <div className="lg:col-span-7 space-y-4">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#2A9D8F]">
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
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors"
              >
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                <span>Publish a Prompt</span>
              </Link>
              <Link
                to="/about"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#FAF7F2]/10 hover:bg-[#FAF7F2]/18 text-[#FAF7F2] text-sm font-semibold transition-colors"
              >
                <span>About ImageLab</span>
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5 grid grid-cols-2 gap-3.5">
            <div className="aspect-[4/3] rounded-2xl overflow-hidden border border-white/10">
              <SafeImage
                src="/src/assets/images/art_3d_sculptural_1794836301810.jpg"
                alt="3D sculptural art preview"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="aspect-[4/3] rounded-2xl overflow-hidden border border-white/10 translate-y-3">
              <SafeImage
                src="/src/assets/images/art_digital_dreamscape_1794836302512.jpg"
                alt="Digital desert pavilion preview"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
