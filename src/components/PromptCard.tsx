import { Link } from 'react-router-dom';
import { PromptItem } from '../types/prompt';
import { SafeImage } from './SafeImage';

interface PromptCardProps {
  prompt: PromptItem;
}

export function PromptCard({ prompt }: PromptCardProps) {
  return (
    <article className="group rounded-2xl bg-[#FAF7F2] border border-[#264653]/10 overflow-hidden shadow-[0_4px_20px_-6px_rgba(38,70,83,0.08)] hover:shadow-[0_14px_34px_-10px_rgba(38,70,83,0.16)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5">
      <Link
        to={`/prompt/${prompt.id}`}
        className="relative block w-full aspect-[9/16] overflow-hidden bg-[#E8DEC8]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51] focus-visible:ring-inset"
        aria-label={`Open prompt details for ${prompt.title}`}
      >
        <SafeImage
          src={prompt.imageUrl}
          alt={prompt.title}
          fallbackTitle={prompt.title}
          className="w-full h-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.035]"
        />
      </Link>
    </article>
  );
}
