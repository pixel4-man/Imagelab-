export type TrendingTab =
  | 'today'
  | 'week'
  | 'copied'
  | 'liked'
  | 'recent';

export interface CreatorProfile {
  username: string;
  displayName: string;
  role: string;
  bio: string;
  avatarUrl: string;
  location: string;
  followers: number;
  following: number;
}

export interface PromptItem {
  id: string;
  title: string;
  promptText?: string;
  imageUrl: string;
  aspectRatio: '16:9' | '4:3' | '3:4' | '1:1';
  creatorUsername: string;
  likes: number;
  copies: number;
  views: number;
  createdAt: string;
  trendingCollections: TrendingTab[];
  isSessionPublished?: boolean;
  status?: 'approved' | 'unpublished' | 'pending' | 'rejected' | 'draft';
  authorUid?: string;
  authorEmail?: string;
  authorType?: 'contributor' | 'official';
  authorLabel?: string;
  updatedAt?: string;
  // Historical optional fields retained silently for backwards compatibility with existing records
  shortDescription?: string;
  fullDescription?: string;
  negativePrompt?: string;
  category?: string;
  technicalNotes?: {
    modelStyle?: string;
    lighting?: string;
    lensOrMedium?: string;
    aspect?: string;
  };
}
