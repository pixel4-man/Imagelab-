import { useMemo, useState } from 'react';
import { ArrowUpRight, Clock, Copy, Flame, Heart, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { PageTransition } from '../components/PageTransition';
import { PromptCard } from '../components/PromptCard';
import { SafeImage } from '../components/SafeImage';
import { SeoHead, resolveCanonicalOrigin } from '../components/SeoHead';
import { useApp } from '../context/AppContext';
import { TrendingTab } from '../types/prompt';

const TABS: { id: TrendingTab; label: string; description: string; icon: typeof Flame }[] = [
  {
    id: 'today',
    label: 'Trending Today',
    description: 'High-velocity creations gaining likes and saves over the past 24 hours.',
    icon: Flame,
  },
  {
    id: 'week',
    label: 'Popular This Week',
    description: 'Standout creations resonating across the ImageLab community this week.',
    icon: TrendingUp,
  },
  {
    id: 'copied',
    label: 'Most Copied',
    description: 'Popular visual studies whose full prompts creators adapt most often.',
    icon: Copy,
  },
  {
    id: 'liked',
    label: 'Most Liked',
    description: 'Community favorites celebrated for visual craft and composition.',
    icon: Heart,
  },
  {
    id: 'recent',
    label: 'Recently Published',
    description: 'Freshly published creations and visual experiments from contributors.',
    icon: Clock,
  },
];

export function TrendingPage() {
  const { prompts, getCreator } = useApp();
  const [activeTab, setActiveTab] = useState<TrendingTab>('today');

  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  const rankedPrompts = useMemo(() => {
    if (activeTab === 'copied') {
      return [...prompts].sort((a, b) => b.copies - a.copies);
    }
    if (activeTab === 'liked') {
      return [...prompts].sort((a, b) => b.likes - a.likes);
    }
    if (activeTab === 'recent') {
      return [...prompts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const filtered = prompts.filter((p) => p.trendingCollections.includes(activeTab));
    return filtered.length > 0 ? filtered : prompts;
  }, [prompts, activeTab]);

  const topSpot = rankedPrompts[0];
  const restList = rankedPrompts.slice(1);

  const canonicalOrigin = resolveCanonicalOrigin();

  return (
    <PageTransition>
      <SeoHead
        title="Trending AI Artwork & Popular Prompts — ImageLab"
        description="Discover trending AI artworks, top creator studies, and the most popular creations across ImageLab."
        canonicalPath="/trending"
        imageUrl={topSpot?.imageUrl}
        structuredData={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Trending AI Artwork — ImageLab',
          url: `${canonicalOrigin}/trending`,
          description:
            'Discover trending AI artworks, top creator studies, and the most popular creations across ImageLab.',
        }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="mb-5">
          <BackButton fallbackTo="/" label="Back" />
        </div>

        {/* Header */}
        <div className="max-w-3xl mb-8">
          <p className="text-xs font-semibold text-[#E76F51] mb-2">
            Community Charts
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#264653] mb-3">
            Trending AI Artwork & Prompts
          </h1>
          <p className="text-base text-[#264653]/75 leading-relaxed">
            Track what creators are admiring, saving, and publishing across the ImageLab archive.
          </p>
        </div>

        {/* Trending Filter Tabs */}
        <div
          role="tablist"
          aria-label="Trending collections"
          className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-3 mb-8 border-b border-[#264653]/10"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap shrink-0 min-h-[42px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51] ${
                  isActive
                    ? 'bg-[#E76F51] text-white shadow-sm'
                    : 'bg-[#FAF7F2] text-[#264653]/80 border border-[#264653]/10 hover:text-[#264653]'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <p className="text-sm text-[#264653]/75 mb-6">{activeMeta.description}</p>

        {/* #1 Top Spotlight Card (No prompt text snippet or copy button) */}
        {topSpot && (
          <section
            data-ad-slot="trending_spotlight"
            data-ad-label="Trending Spotlight"
            className="mb-10 rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 overflow-hidden shadow-sm grid grid-cols-1 lg:grid-cols-12 items-stretch"
          >
            <Link
              to={`/prompt/${topSpot.id}`}
              className="lg:col-span-7 relative aspect-[16/10] lg:aspect-auto min-h-[280px] bg-[#E8DEC8] overflow-hidden group"
            >
              <SafeImage
                src={topSpot.imageUrl}
                alt={topSpot.title}
                fallbackTitle={topSpot.title}
                className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
              />
              <div className="absolute top-4 left-4 px-3 py-1.5 rounded-xl bg-[#264653] text-[#FAF7F2] text-xs font-sans font-semibold tabular-nums">
                #01 Featured in {activeMeta.label}
              </div>
            </Link>

            <div className="lg:col-span-5 p-6 sm:p-8 flex flex-col justify-between gap-6">
              <div>
                <Link
                  to={`/creator/${getCreator(topSpot.creatorUsername).username}`}
                  className="inline-block text-xs font-semibold text-[#2A9D8F] hover:text-[#218175] mb-2"
                >
                  @{getCreator(topSpot.creatorUsername).username}
                </Link>

                <Link to={`/prompt/${topSpot.id}`}>
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#264653] hover:text-[#E76F51] transition-colors mb-3">
                    {topSpot.title}
                  </h2>
                </Link>

                <p className="text-sm text-[#264653]/70 leading-relaxed">
                  Published {topSpot.createdAt}. Open the creation details page to view full artwork and copy its complete prompt.
                </p>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[#264653]/10 text-xs">
                  <div>
                    <p className="font-bold text-base text-[#264653] tabular-nums">
                      {topSpot.likes.toLocaleString()}
                    </p>
                    <p className="text-[#264653]/60">Likes</p>
                  </div>
                  <div>
                    <p className="font-bold text-base text-[#264653] tabular-nums">
                      {topSpot.copies.toLocaleString()}
                    </p>
                    <p className="text-[#264653]/60">Copies</p>
                  </div>
                  <div>
                    <p className="font-bold text-base text-[#264653] tabular-nums">
                      {topSpot.views.toLocaleString()}
                    </p>
                    <p className="text-[#264653]/60">Views</p>
                  </div>
                </div>

                <Link
                  to={`/prompt/${topSpot.id}`}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#264653] hover:bg-[#E76F51] text-white text-sm font-semibold transition-colors min-h-[46px]"
                >
                  <span>View Details</span>
                  <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Ranked Grid */}
        <section
          data-ad-slot="trending_grid"
          data-ad-label="Trending Ranked Grid"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {restList.map((prompt, idx) => (
            <PromptCard key={prompt.id} prompt={prompt} rank={idx + 2} />
          ))}
        </section>
      </div>
    </PageTransition>
  );
}
