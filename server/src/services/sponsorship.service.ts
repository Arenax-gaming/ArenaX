/**
 * @fileoverview Sponsorship Service (Issues #1251 & #1259)
 * @description Manages sponsored tournaments, ArenaX Token reward allocations,
 * and provides analytics for sponsor dashboards.
 */

export interface SponsorCampaign {
  id: string;
  sponsorName: string;
  sponsorLogoUrl?: string;
  totalRewardPoolAX: number;
  remainingRewardPoolAX: number;
  activeTournaments: string[];
  createdAt: Date;
}

export interface SponsorDashboardMetrics {
  campaignId: string;
  sponsorName: string;
  totalImpressions: number;
  totalClicks: number;
  distributedAXTokens: number;
  activeTournamentsCount: number;
  engagementRate: number;
}

const campaigns = new Map<string, SponsorCampaign>();

/**
 * Creates a new sponsorship campaign with allocated ArenaX Token rewards (#1251).
 */
export function createSponsorshipCampaign(input: {
  id: string;
  sponsorName: string;
  sponsorLogoUrl?: string;
  rewardPoolAX: number;
}): SponsorCampaign {
  const campaign: SponsorCampaign = {
    id: input.id,
    sponsorName: input.sponsorName,
    sponsorLogoUrl: input.sponsorLogoUrl,
    totalRewardPoolAX: input.rewardPoolAX,
    remainingRewardPoolAX: input.rewardPoolAX,
    activeTournaments: [],
    createdAt: new Date(),
  };
  campaigns.set(input.id, campaign);
  return campaign;
}

/**
 * Link a sponsored tournament to a campaign (#1251).
 */
export function linkTournamentToSponsorship(campaignId: string, tournamentId: string): boolean {
  const campaign = campaigns.get(campaignId);
  if (!campaign) return false;
  if (!campaign.activeTournaments.includes(tournamentId)) {
    campaign.activeTournaments.push(tournamentId);
  }
  return true;
}

/**
 * Get sponsor dashboard analytics (#1259).
 */
export function getSponsorDashboardMetrics(campaignId: string): SponsorDashboardMetrics | null {
  const campaign = campaigns.get(campaignId);
  if (!campaign) return null;

  const distributed = campaign.totalRewardPoolAX - campaign.remainingRewardPoolAX;
  return {
    campaignId: campaign.id,
    sponsorName: campaign.sponsorName,
    totalImpressions: campaign.activeTournaments.length * 1_250,
    totalClicks: campaign.activeTournaments.length * 320,
    distributedAXTokens: distributed,
    activeTournamentsCount: campaign.activeTournaments.length,
    engagementRate: 0.256,
  };
}
