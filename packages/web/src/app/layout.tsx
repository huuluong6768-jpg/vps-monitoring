import type { Metadata } from 'next';
import './globals.css';
import { ThemeScript } from '@/components/ThemeScript';
import { ToasterHost } from '@/components/ToasterHost';

export const metadata: Metadata = {
  title: 'VPS Monitor — Modern Server Monitoring',
  description:
    'Open-source, self-hosted monitoring & management for your VPS fleet. Install with one command.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link rel="preconnect" href="https://rsms.me/" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
      </head>
      <body className="min-h-full">
        {children}
        <ToasterHost />
      </body>
    </html>
  );
}
