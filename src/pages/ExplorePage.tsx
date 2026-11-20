import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Compass, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { EmptyState } from '../components/FeedbackStates';
import { PageTransition } from '../components/PageTransition';
import { PromptCard } from '../components/PromptCard';
import { SeoHead, resolveCanonicalOrigin } from '../components/SeoHead';
import { useApp } from '../context/AppContext';

type SortOption = 'popular' | 'copied' | 'recent' | 'title';

export function ExplorePage() {
  const { prompts } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [sortBy, setSortBy] = useState<SortOption>('popular');

  useEffect(() => {
    setQuery(searchParams.get('q') || '');
  }, [searchParams]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    const next = new URLSearchParams(searchParams);
    if (value.trim()) {
      next.set('q', value);
    } else {
      next.delete('q');
    }
    setSearchParams(next, { replace: true });
  };

  const resetAllFilters = () => {
    setQuery('');
    setSortBy('popular');
    setSearchParams({}, { replace: true });
  };

  const filteredPrompts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = prompts.filter((item) => {
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.creatorUsername.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'popular') return b.likes - a.likes;
      if (sortBy === 'copied') return b.copies - a.copies;
      if (sortBy === 'recent') return b.createdAt.localeCompare(a.createdAt);
      return a.title.localeCompare(b.title);
    });
  }, [prompts, query, sortBy]);

  const canonicalOrigin = resolveCanonicalOrigin();

  return (
    <PageTransition>
      <SeoHead
        title="Explore AI Prompts & Artwork — ImageLab"
        description="Browse curated AI images and discover creative visual prompt studies by artists across ImageLab."
        canonicalPath="/explore"
        structuredData={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Explore AI Artwork & Prompts — ImageLab',
          url: `${canonicalOrigin}/explore`,
          description:
            'Browse curated AI images and discover creative visual prompt studies by artists across ImageLab.',
        }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="mb-5">
          <BackButton fallbackTo="/" label="Back" />
        </div>

        {/* Page Header */}
        <section
          data-ad-slot="explore_header"
          data-ad-label="Explore Header"
          className="max-w-3xl mb-8"
        >
          <p className="text-xs font-semibold text-[#2A9D8F] mb-2">
            Explore Gallery
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#264653] mb-3">
            Explore AI Images & Prompts
          </h1>
          <p className="text-base text-[#264653]/75 leading-relaxed">
            Browse curated AI artworks and search by image title or creator handle.
          </p>
        </section>

        {/* Search & Sort Controls */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 mb-8">
          <div className="relative flex-1 max-w-xl">
            <Search
              className="w-4 h-4 text-[#264653]/50 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search by image title or @creator..."
              aria-label="Filter artworks by title or creator username"
              className="w-full h-11 pl-10 pr-10 rounded-xl bg-[#FAF7F2] border border-[#264653]/15 text-sm text-[#264653] placeholder:text-[#264653]/45 focus:outline-none focus:border-[#2A9D8F] focus:ring-2 focus:ring-[#2A9D8F]/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => handleQueryChange('')}
                aria-label="Clear search query"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#264653]/55 hover:text-[#264653]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto">
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#FAF7F2] border border-[#264653]/15">
              <ArrowDownUp className="w-4 h-4 text-[#2A9D8F]" aria-hidden="true" />
              <label htmlFor="explore-sort" className="text-xs font-medium text-[#264653]/70">
                Sort
              </label>
              <select
                id="explore-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="bg-transparent text-sm font-semibold text-[#264653] focus:outline-none cursor-pointer"
              >
                <option value="popular">Most Liked</option>
                <option value="copied">Most Copied</option>
                <option value="recent">Recently Published</option>
                <option value="title">Title (A–Z)</option>
              </select>
            </div>

            <span className="text-xs font-sans font-medium tabular-nums text-[#264653]/65 whitespace-nowrap">
              {filteredPrompts.length} {filteredPrompts.length === 1 ? 'result' : 'results'}
            </span>
          </div>
        </div>

        {/* Gallery Grid */}
        {filteredPrompts.length === 0 ? (
          <EmptyState
            icon={<Compass className="w-6 h-6" />}
            title="No matching artworks found"
            description="No AI artworks matched your search for image title or creator username."
            actionLabel="Reset Search"
            onAction={resetAllFilters}
          />
        ) : (
          <div className="flex flex-col lg:flex-row lg:items-start [&:has(aside[data-ad-has-visible='true'])]:gap-6">
            <div className="flex-1 min-w-0 space-y-6 sm:space-y-8">
              <section
                data-ad-slot="explore_gallery"
                data-ad-label="Explore Gallery Grid"
                className="grid grid-cols-2 gap-3.5 sm:gap-5 lg:gap-6"
              >
                {filteredPrompts.slice(0, 6).map((prompt) => (
                  <PromptCard key={prompt.id} prompt={prompt} />
                ))}
              </section>

              {filteredPrompts.length > 6 && (
                <section
                  data-ad-slot="explore_gallery_bottom"
                  data-ad-label="Explore Extended Gallery"
                  className="grid grid-cols-2 gap-3.5 sm:gap-5 lg:gap-6"
                >
                  {filteredPrompts.slice(6).map((prompt) => (
                    <PromptCard key={prompt.id} prompt={prompt} />
                  ))}
                </section>
              )}
            </div>
            <aside
              data-ad-slot="desktop_sidebar_banner"
              data-ad-label="Desktop Sidebar Banner (160×600)"
              className="hidden lg:block shrink-0 w-0 overflow-hidden [&[data-ad-has-visible='true']]:w-[196px] [&[data-ad-has-visible='true']]:overflow-visible lg:sticky lg:top-24"
            />
          </div>
        )}
      </div>
    </PageTransition>
  );
}
