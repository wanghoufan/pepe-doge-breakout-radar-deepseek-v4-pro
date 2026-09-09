import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { AlertCenterHost } from '@/components/market/AlertCenter';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'PEPE·DOGE·ETHFI 突破雷达',
    template: '%s · 突破雷达',
  },
  description:
    '基于历史市场事件的 PEPE / DOGE / ETHFI 突破观测雷达：以量化证据描述「此刻更像哪一段历史行情」，不构成任何投资建议。',
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased min-h-screen bg-background text-foreground">
        {isDev && <Inspector />}
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6" id="radar-live">{children}</main>
        <SiteFooter />
        <AlertCenterHost />
      </body>
    </html>
  );
}