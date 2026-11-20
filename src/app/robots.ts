import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL || 'https://bangicarrental.my').replace(/\/$/, '');
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/bookings', '/book', '/sign-in', '/api/'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
