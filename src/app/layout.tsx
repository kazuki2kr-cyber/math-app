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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${notoSansJP.variable} font-sans antialiased relative`}
      >
        <AuthProvider>
          <PwaProvider>
            <ProtectedRoute>
              {children}
            </ProtectedRoute>
          </PwaProvider>
        </AuthProvider>
        <div className="fixed bottom-2 right-2 text-xs text-slate-400 opacity-50 pointer-events-none z-50">
          v{process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0"}
        </div>
      </body>
    </html>
  );
}
