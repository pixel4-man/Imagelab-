import { READY_MADE_PROMPTS } from '../server/seededPromptsData';
import { CreatorProfile, PromptItem } from '../types/prompt';

export const CREATORS: Record<string, CreatorProfile> = {
  elenavance: {
    username: 'elenavance',
    displayName: 'Elena Vance',
    role: 'Architectural Light Director',
    bio: 'Exploring brutalist travertine geometry, warm Mediterranean daylight, and quiet spatial studies through structured camera prompting.',
    avatarUrl: '/src/assets/images/avatar_creator_elena_1794836305482.jpg',
    location: 'Lisbon, Portugal',
    followers: 4820,
    following: 312,
  },
  marcuschen: {
    username: 'marcuschen',
    displayName: 'Marcus Chen',
    role: 'Editorial Portraitist',
    bio: 'Focusing on 35mm film emulation, directional north-window lighting, and tactile craft studios.',
    avatarUrl: '/src/assets/images/art_cinematic_portrait_1794836299424.jpg',
    location: 'Kyoto & Vancouver',
    followers: 3490,
    following: 194,
  },
  soratakahashi: {
    username: 'soratakahashi',
    displayName: 'Sora Takahashi',
    role: 'Environment & Concept Artist',
    bio: 'Building nostalgic coastal towns, twilight sky gradients, and painterly worldbuilding studies.',
    avatarUrl: '/src/assets/images/art_anime_tram_1794836300753.jpg',
    location: 'Kamakura, Japan',
    followers: 6150,
    following: 278,
  },
  clarabergman: {
    username: 'clarabergman',
    displayName: 'Clara Bergman',
    role: 'Still Life & Product Stylist',
    bio: 'Minimalist ceramic composition, raw limestone textures, and commercial studio lighting setups.',
    avatarUrl: '/src/assets/images/art_product_ceramic_1794836302164.jpg',
    location: 'Copenhagen, Denmark',
    followers: 2740,
    following: 165,
  },
  mateorivera: {
    username: 'mateorivera',
    displayName: 'Mateo Rivera',
    role: '3D Material & Form Explorer',
    bio: 'Crafting sculptural glass, anodized metal, and mineral pigment studies in clean studio lighting.',
    avatarUrl: '/src/assets/images/art_3d_sculptural_1794836301810.jpg',
    location: 'Mexico City, Mexico',
    followers: 3910,
    following: 229,
  },
};

export const INITIAL_PROMPTS: PromptItem[] = READY_MADE_PROMPTS;
