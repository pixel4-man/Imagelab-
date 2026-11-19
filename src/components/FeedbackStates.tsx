import React from 'react';
import { Link } from 'react-router-dom';

export function SkeletonCard() {
  return (
    <div
      className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/10 overflow-hidden animate-pulse"
      aria-hidden="true"
    >
      <div className="w-full aspect-[9/16] bg-[#E8DEC8]/70" />
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/12 px-6 py-16 text-center max-w-xl mx-auto">
      <div className="w-12 h-12 rounded-xl bg-[#F4EDE4] border border-[#264653]/10 flex items-center justify-center mx-auto mb-4 text-[#264653]">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-[#264653] mb-2">{title}</h3>
      <p className="text-sm text-[#264653]/70 leading-relaxed max-w-md mx-auto mb-6">
        {description}
      </p>
      {actionLabel && actionTo && (
        <Link
          to={actionTo}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-sm font-semibold bg-[#E76F51] text-white hover:bg-[#D05A3C] transition-colors"
        >
          {actionLabel}
        </Link>
      )}
      {actionLabel && onAction && !actionTo && (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-sm font-semibold bg-[#E76F51] text-white hover:bg-[#D05A3C] transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
