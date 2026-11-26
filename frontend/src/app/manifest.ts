import type { MetadataRoute } from 'next';

/** Lets the app be installed to a phone or desktop with its own icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pointwise',
    short_name: 'Pointwise',
    description: 'Use the right card every time. Track offers, bonuses, renewals and loyalty assets.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#eef2ff',
    theme_color: '#4f46e5',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/logo/pointwise-mark.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
