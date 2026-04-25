export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type AchievementCategory = 'combat' | 'tournament' | 'social' | 'progression' | 'special';

export interface AchievementFull {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: number;
  total: number;
  unlocked: boolean;
  unlockedAt?: string;
  rarity: AchievementRarity;
  category: AchievementCategory;
  points: number;
  requirements: string[];
  hint?: string;
}

export const MOCK_ACHIEVEMENTS: AchievementFull[] = [
  {
    id: 'a1',
    title: 'First Blood',
    description: 'Win your first match',
    icon: '⚔️',
    progress: 1,
    total: 1,
    unlocked: true,
    unlockedAt: '2026-01-15T10:00:00Z',
    rarity: 'common',
    category: 'combat',
    points: 10,
    requirements: ['Win 1 match'],
  },
  {
    id: 'a2',
    title: 'On a Roll',
    description: 'Win 5 matches in a row',
    icon: '🔥',
    progress: 3,
    total: 5,
    unlocked: false,
    rarity: 'rare',
    category: 'combat',
    points: 50,
    requirements: ['Win 5 consecutive matches without a loss'],
    hint: 'Keep your win streak alive!',
  },
  {
    id: 'a3',
    title: 'Tournament Victor',
    description: 'Win a tournament',
    icon: '🏆',
    progress: 0,
    total: 1,
    unlocked: false,
    rarity: 'epic',
    category: 'tournament',
    points: 100,
    requirements: ['Enter a tournament', 'Win all bracket matches', 'Claim the championship'],
    hint: 'Enter any tournament to start.',
  },
  {
    id: 'a4',
    title: 'Veteran',
    description: 'Play 50 matches',
    icon: '🎖️',
    progress: 32,
    total: 50,
    unlocked: false,
    rarity: 'common',
    category: 'progression',
    points: 25,
    requirements: ['Play 50 total matches'],
  },
  {
    id: 'a5',
    title: 'Sharpshooter',
    description: 'Reach 1500 ELO',
    icon: '🎯',
    progress: 1250,
    total: 1500,
    unlocked: false,
    rarity: 'rare',
    category: 'progression',
    points: 75,
    requirements: ['Reach an ELO rating of 1500'],
    hint: 'Win matches against higher-rated opponents for bigger ELO gains.',
  },
  {
    id: 'a6',
    title: 'Social Butterfly',
    description: 'Add 10 friends',
    icon: '🦋',
    progress: 6,
    total: 10,
    unlocked: false,
    rarity: 'common',
    category: 'social',
    points: 20,
    requirements: ['Add 10 friends to your friends list'],
  },
  {
    id: 'a7',
    title: 'Legend',
    description: 'Reach 2000 ELO',
    icon: '👑',
    progress: 1250,
    total: 2000,
    unlocked: false,
    rarity: 'legendary',
    category: 'progression',
    points: 250,
    requirements: ['Reach an ELO rating of 2000', 'Maintain it for 7 days'],
    hint: 'Only the best reach this tier.',
  },
  {
    id: 'a8',
    title: 'Centurion',
    description: 'Play 100 matches',
    icon: '💯',
    progress: 32,
    total: 100,
    unlocked: false,
    rarity: 'rare',
    category: 'progression',
    points: 60,
    requirements: ['Play 100 total matches'],
  },
  {
    id: 'a9',
    title: 'Dominator',
    description: 'Win 10 matches in a row',
    icon: '💥',
    progress: 3,
    total: 10,
    unlocked: false,
    rarity: 'epic',
    category: 'combat',
    points: 150,
    requirements: ['Win 10 consecutive matches without a loss'],
  },
  {
    id: 'a10',
    title: 'Early Adopter',
    description: 'Join during the beta period',
    icon: '🌟',
    progress: 1,
    total: 1,
    unlocked: true,
    unlockedAt: '2026-01-01T00:00:00Z',
    rarity: 'legendary',
    category: 'special',
    points: 200,
    requirements: ['Register an account during the beta period'],
  },
  {
    id: 'a11',
    title: 'Team Player',
    description: 'Participate in 5 tournaments',
    icon: '🤝',
    progress: 2,
    total: 5,
    unlocked: false,
    rarity: 'rare',
    category: 'tournament',
    points: 80,
    requirements: ['Join and participate in 5 tournaments'],
  },
  {
    id: 'a12',
    title: 'Comeback Kid',
    description: 'Win a match after being down 0-2',
    icon: '🔄',
    progress: 0,
    total: 1,
    unlocked: false,
    rarity: 'epic',
    category: 'combat',
    points: 120,
    requirements: ['Be down 0-2 in a match', 'Win the match'],
    hint: 'Never give up!',
  },
];

export const RARITY_CONFIG: Record<AchievementRarity, { label: string; color: string; bg: string; border: string }> = {
  common: {
    label: 'Common',
    color: 'text-gray-500 dark:text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800',
    border: 'border-gray-300 dark:border-gray-600',
  },
  rare: {
    label: 'Rare',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950',
    border: 'border-blue-300 dark:border-blue-700',
  },
  epic: {
    label: 'Epic',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-950',
    border: 'border-purple-300 dark:border-purple-700',
  },
  legendary: {
    label: 'Legendary',
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-50 dark:bg-yellow-950',
    border: 'border-yellow-300 dark:border-yellow-700',
  },
};

export const CATEGORY_CONFIG: Record<AchievementCategory, { label: string; icon: string }> = {
  combat: { label: 'Combat', icon: '⚔️' },
  tournament: { label: 'Tournament', icon: '🏆' },
  social: { label: 'Social', icon: '👥' },
  progression: { label: 'Progression', icon: '📈' },
  special: { label: 'Special', icon: '✨' },
};
