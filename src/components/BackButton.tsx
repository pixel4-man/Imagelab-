import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

interface BackButtonProps {
  fallbackTo?: string;
  label?: string;
  className?: string;
}

export function BackButton({
  fallbackTo = '/',
  label = 'Back',
  className = '',
}: BackButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();

  if (location.pathname === '/') {
    return null;
  }

  const handleBack = () => {
    const historyState = window.history.state as { idx?: number } | null;
    const hasAppHistory =
      historyState && typeof historyState.idx === 'number' && historyState.idx > 0;

    if (hasAppHistory) {
      navigate(-1);
    } else {
      navigate(fallbackTo);
    }
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      aria-label={label}
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#FAF7F2] border border-[#264653]/14 text-xs sm:text-sm font-semibold text-[#264653] hover:border-[#E76F51]/50 hover:text-[#E76F51] transition-colors min-h-[40px] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E76F51] ${className}`}
    >
      <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
