import { getProfileById } from '@/data/user';
import { ProfilePageClient } from './ProfilePageClient';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getProfileById(id);
  if (!data) return { title: 'Profile Not Found' };
  return {
    title: `${data.profile.username}'s Profile`,
    description: data.profile.bio ?? `View ${data.profile.username}'s gaming profile`,
    openGraph: {
      title: `${data.profile.username}'s Profile`,
      description: data.profile.bio ?? '',
      images: data.profile.avatar ? [{ url: data.profile.avatar }] : [],
    },
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getProfileById(id);

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-xl text-muted-foreground">Profile not found</p>
      </div>
    );
  }

  return (
    <ProfilePageClient
      profile={data.profile}
      stats={data.stats}
      achievements={data.achievements}
      friends={data.friends}
      activities={data.activities}
      eloHistory={data.eloHistory}
    />
  );
}
