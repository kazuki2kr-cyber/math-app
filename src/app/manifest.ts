import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Formix',
    short_name: 'Formix',
    description: 'Forming the Essence of Knowledge.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f8faeb',
    theme_color: '#123f3a',
    orientation: 'any',
    icons: [
      {
        src: '/images/pwa-icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/images/pwa-icon-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
