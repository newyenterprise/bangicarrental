import { SiteFooter, TestModeBanner } from '@/components/SiteChrome';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TestModeBanner />
      {children}
      <SiteFooter />
    </>
  );
}
