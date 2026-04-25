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
  return { title: achievement ? `${achievement.title} | Achievements` : 'Achievement' };
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
