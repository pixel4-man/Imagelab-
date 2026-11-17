import { useMemo } from 'react';
import { Bookmark } from 'lucide-react';
import { BackButton } from '../components/BackButton';
import { EmptyState } from '../components/FeedbackStates';
import { PageTransition } from '../components/PageTransition';
import { PromptCard } from '../components/PromptCard';
import { useApp } from '../context/AppContext';

export function SavedPromptsPage() {
  const { prompts, savedIds } = useApp();

  const savedPrompts = useMemo(
    () => prompts.filter((p) => savedIds.includes(p.id)),
    [prompts, savedIds]
  );

  return (
    <PageTransition>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="mb-5">
          <BackButton fallbackTo="/" label="Back" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <p className="text-xs font-semibold text-[#2A9D8F] mb-2">
              Personal Collection
            </p>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#264653] mb-2">
              Saved Prompts
            </h1>
            <p className="text-base text-[#264653]/75">
              Keep your favorite AI images and prompt formulas organized for your next creation.
            </p>
          </div>

          <span className="text-sm font-sans font-medium tabular-nums text-[#264653]/65 shrink-0">
            {savedPrompts.length} {savedPrompts.length === 1 ? 'saved item' : 'saved items'}
          </span>
        </div>

        {savedPrompts.length === 0 ? (
          <EmptyState
            icon={<Bookmark className="w-6 h-6" />}
            title="Your saved collection is empty"
            description="Bookmark any AI artwork while browsing Explore or Trending to keep its prompt handy here."
            actionLabel="Explore Prompts"
            actionTo="/explore"
          />
        ) : (
          <section
            data-ad-slot="saved_prompts_grid"
            data-ad-label="Saved Prompts Grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {savedPrompts.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} />
            ))}
          </section>
        )}
      </div>
    </PageTransition>
  );
}
