import { ArrowUpRight, Bookmark, Check, Copy, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PromptItem } from '../types/prompt';
import { SafeImage } from './SafeImage';

interface PromptCardProps {
  prompt: PromptItem;
  rank?: number;
}

export function PromptCard({ prompt, rank }: PromptCardProps) {
  const { likedIds, savedIds, copiedId, toggleLike, toggleSave, copyPrompt, getCreator } = useApp();

  const isLiked = likedIds.includes(prompt.id);
  const isSaved = savedIds.includes(prompt.id);
  const isCopied = copiedId === prompt.id;
  const creator = getCreator(prompt.creatorUsername);

  const aspectClass =
    prompt.aspectRatio === '3:4'
      ? 'aspect-[4/5]'
      : prompt.aspectRatio === '1:1'
        ? 'aspect-square'
        : 'aspect-[4/3]';

  return (
    <article className="group flex flex-col rounded-2xl bg-[#FAF7F2] border border-[#264653]/10 overflow-hidden shadow-[0_4px_20px_-6px_rgba(38,70,83,0.08)] hover:shadow-[0_14px_34px_-10px_rgba(38,70,83,0.16)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5">
      <Link
        to={`/prompt/${prompt.id}`}
        className={`relative block overflow-hidden bg-[#E8DEC8]/45 ${aspectClass}`}
        aria-label={`View prompt details for ${prompt.title}`}
      >
        <SafeImage
          src={prompt.imageUrl}
          alt={prompt.title}
          fallbackTitle={prompt.title}
          className="w-full h-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.035]"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#264653]/55 via-[#264653]/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          aria-hidden="true"
        />
        {typeof rank === 'number' && (
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-[#264653]/88 backdrop-blur-xs text-[#FAF7F2] text-xs font-sans font-semibold tabular-nums">
            #{String(rank).padStart(2, '0')}
          </div>
        )}
      </Link>

      <div className="flex flex-col flex-1 p-5">
        <Link
          to={`/prompt/${prompt.id}`}
          className="group/title inline-block mb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51] rounded"
        >
          <h3 className="text-lg font-bold tracking-tight text-[#264653] group-hover/title:text-[#E76F51] transition-colors line-clamp-1">
            {prompt.title}
          </h3>
        </Link>

        <div className="mb-4">
          <Link
            to={`/creator/${creator.username}`}
            className="text-xs font-medium text-[#2A9D8F] hover:text-[#218175] transition-colors truncate inline-block max-w-full"
          >
            @{creator.username}
          </Link>
        </div>

        {/* Action Row: Like, Save, Copy Prompt, View Details (No category or description) */}
        <div className="mt-auto pt-3.5 border-t border-[#264653]/10 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toggleLike(prompt.id)}
              aria-pressed={isLiked}
              aria-label={isLiked ? `Unlike ${prompt.title}` : `Like ${prompt.title}`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors min-h-[38px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51] ${
                isLiked
                  ? 'bg-[#E76F51]/12 text-[#E76F51]'
                  : 'text-[#264653]/75 hover:bg-[#264653]/6 hover:text-[#264653]'
              }`}
            >
              <Heart
                className={`w-3.5 h-3.5 ${isLiked ? 'fill-[#E76F51] text-[#E76F51]' : ''}`}
                aria-hidden="true"
              />
              <span>{prompt.likes.toLocaleString()}</span>
            </button>

            <button
              type="button"
              onClick={() => toggleSave(prompt.id)}
              aria-pressed={isSaved}
              aria-label={isSaved ? `Remove ${prompt.title} from saved` : `Save ${prompt.title}`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A9D8F] ${
                isSaved
                  ? 'bg-[#2A9D8F]/14 text-[#218175]'
                  : 'text-[#264653]/75 hover:bg-[#264653]/6 hover:text-[#264653]'
              }`}
            >
              <Bookmark
                className={`w-3.5 h-3.5 ${isSaved ? 'fill-[#2A9D8F] text-[#2A9D8F]' : ''}`}
                aria-hidden="true"
              />
              <span>{isSaved ? 'Saved' : 'Save'}</span>
            </button>

            <button
              type="button"
              onClick={() => copyPrompt(prompt.id)}
              aria-label={`Copy prompt for ${prompt.title}`}
              className={`inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51] ${
                isCopied
                  ? 'bg-[#2A9D8F] text-white'
                  : 'text-[#264653]/80 hover:bg-[#E76F51]/12 hover:text-[#E76F51]'
              }`}
            >
              {isCopied ? (
                <>
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Copy Prompt</span>
                </>
              )}
            </button>
          </div>

          <Link
            to={`/prompt/${prompt.id}`}
            aria-label={`View details for ${prompt.title}`}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-[#264653] text-[#FAF7F2] hover:bg-[#E76F51] transition-colors min-h-[38px] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51]"
          >
            <span>View Details</span>
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
