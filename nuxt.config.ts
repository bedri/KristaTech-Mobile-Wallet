import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
  future: {
    compatibilityVersion: 4
  },
  ssr: false,
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss() as any]
  },
  typescript: {
    tsConfig: {
      compilerOptions: {
        allowImportingTsExtensions: true
      }
    }
  },
  app: {
    head: {
      title: 'KRISTA Wallet — Mobile & PWA Non-Custodial Wallet',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'color-scheme', content: 'light dark', tagPriority: -14 },
        { name: 'theme-color', content: '#070b14' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'KRISTA' },
        {
          name: 'description',
          content:
            'Non-custodial KRISTA mobile & PWA wallet powered by Capacitor 6, Electrum SPV verification, Taproot kt1p..., PoL lock protection, and 17-language beginner glossary.'
        }
      ],
      script: [
        {
          src: '/theme-init.js',
          tagPriority: -13
        }
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/icons/apple-touch-icon-180.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' }
      ]
    }
  },
  nitro: {
    routeRules: {
      '/**': {
        headers: {
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()'
        }
      }
    }
  },
  devServer: {
    host: '127.0.0.1',
    port: 27811
  }
});
