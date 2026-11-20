import type { Metadata, Viewport } from 'next';
import { DM_Sans } from 'next/font/google';
import { I18nProvider } from '@/lib/i18n/client';
import { getI18n } from '@/lib/i18n/server';
import './globals.css';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return {
    metadataBase: new URL(process.env.APP_URL || 'https://bangicarrental.my'),
    title: { default: d.home.metaTitle, template: '%s · Bangi Car Rental' },
    description: d.home.metaDescription,
    alternates: { canonical: '/' },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#faf9f4' };

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const { locale, d } = await getI18n();
  return (
    <html lang={locale} className={`${dmSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <I18nProvider locale={locale} d={d}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
