import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface SafeImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
}

export function SafeImage({
  src,
  alt,
  className = '',
  fallbackTitle,
}: SafeImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  if (hasError || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#E8DEC8] via-[#F4EDE4] to-[#E76F51]/15 text-[#264653]/70 p-6 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <ImageOff className="w-7 h-7 mb-2 text-[#264653]/45" aria-hidden="true" />
        <span className="text-xs font-medium tracking-tight text-[#264653]/80 max-w-[18ch] line-clamp-2">
          {fallbackTitle || alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onLoad={() => setIsLoaded(true)}
      onError={() => setHasError(true)}
      className={`transition-opacity duration-300 ${
        isLoaded ? 'opacity-100' : 'opacity-85'
      } ${className}`}
    />
  );
}
