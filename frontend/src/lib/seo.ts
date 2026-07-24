import { Metadata } from 'next';

// Base site configuration
export const siteConfig = {
  name: 'ArenaX',
  description: 'Competitive Gaming Platform - Play, compete, and win in the ultimate gaming arena',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'https://arenax.gg',
  ogImage: '/og-image.png',
  links: {
    twitter: 'https://twitter.com/arenax',
    github: 'https://github.com/arenax-gaming',
    discord: 'https://discord.gg/arenax',
  },
};

// Default metadata
export const defaultMetadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    'gaming',
    'competitive gaming',
    'esports',
    'tournaments',
    'blockchain gaming',
    'play to earn',
    'crypto gaming',
    'NFT gaming',
    'Stellar blockchain',
  ],
  authors: [{ name: 'ArenaX Team' }],
  creator: 'ArenaX',
  publisher: 'ArenaX',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
    creator: '@arenax',
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
    yandex: process.env.YANDEX_VERIFICATION,
  },
};

// Generate page-specific metadata
export function generatePageMetadata(params: {
  title: string;
  description: string;
  path?: string;
  image?: string;
  noIndex?: boolean;
}): Metadata {
  const { title, description, path = '', image, noIndex = false } = params;
  const url = `${siteConfig.url}${path}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      url,
      title,
      description,
      images: image
        ? [
            {
              url: image,
              width: 1200,
              height: 630,
              alt: title,
            },
          ]
        : [
            {
              url: siteConfig.ogImage,
              width: 1200,
              height: 630,
              alt: siteConfig.name,
            },
          ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : [siteConfig.ogImage],
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
        }
      : undefined,
  };
}

// Generate structured data (JSON-LD)
export function generateStructuredData(type: string, data: any) {
  const baseData = {
    '@context': 'https://schema.org',
    '@type': type,
    ...data,
  };

  return JSON.stringify(baseData);
}

// Organization structured data
export function organizationStructuredData() {
  return generateStructuredData('Organization', {
    name: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    logo: `${siteConfig.url}/logo.png`,
    sameAs: Object.values(siteConfig.links),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: 'support@arenax.gg',
    },
  });
}

// WebSite structured data
export function websiteStructuredData() {
  return generateStructuredData('WebSite', {
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${siteConfig.url}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  });
}

// Breadcrumb structured data
export function breadcrumbStructuredData(items: Array<{ name: string; url: string }>) {
  return generateStructuredData('BreadcrumbList', {
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  });
}

// Article structured data
export function articleStructuredData(data: {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  datePublished: string;
  dateModified?: string;
  author?: string;
}) {
  return generateStructuredData('Article', {
    headline: data.title,
    description: data.description,
    image: data.imageUrl || `${siteConfig.url}${siteConfig.ogImage}`,
    url: data.url,
    datePublished: data.datePublished,
    dateModified: data.dateModified || data.datePublished,
    author: {
      '@type': 'Person',
      name: data.author || 'ArenaX Team',
    },
    publisher: {
      '@type': 'Organization',
      name: siteConfig.name,
      logo: {
        '@type': 'ImageObject',
        url: `${siteConfig.url}/logo.png`,
      },
    },
  });
}

// Game structured data
export function gameStructuredData(data: {
  name: string;
  description: string;
  url: string;
  image?: string;
  genre?: string;
  playMode?: string;
  platform?: string;
}) {
  return generateStructuredData('Game', {
    name: data.name,
    description: data.description,
    url: data.url,
    image: data.image || `${siteConfig.url}${siteConfig.ogImage}`,
    genre: data.genre || 'Action',
    playMode: data.playMode || 'MultiPlayer',
    platform: data.platform || 'Web',
    applicationCategory: 'Game',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  });
}

// Tournament structured data
export function tournamentStructuredData(data: {
  name: string;
  description: string;
  url: string;
  startDate: string;
  endDate?: string;
  location?: string;
}) {
  return generateStructuredData('SportsEvent', {
    name: data.name,
    description: data.description,
    url: data.url,
    startDate: data.startDate,
    endDate: data.endDate || data.startDate,
    location: data.location
      ? {
          '@type': 'VirtualLocation',
          url: data.location,
        }
      : {
          '@type': 'VirtualLocation',
          url: siteConfig.url,
        },
  });
}
