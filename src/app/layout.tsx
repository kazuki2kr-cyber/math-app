import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
});

import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PwaProvider } from "@/components/PwaProvider";
import { ThemeProvider } from "@/contexts/ThemeContext";

export const metadata: Metadata = {
  title: "Formix | Forming the Essence of Knowledge.",
  description: "Forming the Essence of Knowledge. 芝浦工業大学附属中学高等学校の生徒向け数学演習アプリケーション。",
  icons: {
    icon: '/images/pwa-icon.png',
    apple: '/images/pwa-icon.png',
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Formix',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#123f3a',
};

const themeInitializationScript = `
  (() => {
    try {
      const saved = localStorage.getItem('formix:theme');
      const preference = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'light';
      const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    } catch {}
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body
        className={`${notoSansJP.variable} font-sans antialiased relative`}
      >
        <ThemeProvider>
          <AuthProvider>
            <PwaProvider>
              <ProtectedRoute>
                {children}
              </ProtectedRoute>
            </PwaProvider>
          </AuthProvider>
        </ThemeProvider>
        <div className="fixed bottom-2 right-2 text-xs text-slate-400 opacity-50 pointer-events-none z-50">
          v{process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0"}
        </div>
      </body>
    </html>
  );
}
