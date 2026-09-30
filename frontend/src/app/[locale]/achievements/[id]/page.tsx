import { notFound } from 'next/navigation';
import Link from 'next/link';
import { MOCK_ACHIEVEMENTS } from '@/data/achievements';
import { AchievementDetails } from '@/components/achievements/AchievementDetails';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const achievement = MOCK_ACHIEVEMENTS.find((a) => a.id === id);

  if (!achievement) {
    return { title: 'Achievement' };
  }

  const title = `${achievement.title} | Achievements`;
  const description = achievement.description;
  // Dynamic OG image (#1097): player name, icon, and rarity, rendered at
  // the edge and CDN-cached — see app/api/og/achievement/[id].
  const ogImageUrl = `/api/og/achievement/${achievement.id}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: achievement.title }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function AchievementDetailPage({ params }: Props) {
  const { id } = await params;
  const achievement = MOCK_ACHIEVEMENTS.find((a) => a.id === id);
  if (!achievement) notFound();

  return (
    <div className="space-y-6 max-w-2xl">
      <Link
        href="/achievements"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        ← Back to Achievements
      </Link>
      <AchievementDetails achievement={achievement} />
    </div>
  );
}
