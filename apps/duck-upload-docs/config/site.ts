import { absoluteUrl } from '@gentleduck/docs/lib'

export const siteConfig = {
  author: {
    name: 'Ahmed Ayob',
    url: 'https://x.com/wild_ducka',
    email: 'ahmedayobbusiness@gmail.com',
  },
  description:
    '@gentleduck/upload is a modular, strategy-based file upload engine with React bindings. Resumable uploads, pluggable strategies, and type-safe from backend to UI.',
  links: {
    community: 'community@gentleduck.org',
    discord: process.env.NEXT_PUBLIC_DISCORD_URL ?? 'https://discord.gg/r93Qvam8',
    email: 'support@gentleduck.org',
    github: 'https://github.com/gentleeduck/duck-upload',
    security: 'security@gentleduck.org',
    sponsor: process.env.NEXT_PUBLIC_SPONSOR_URL ?? 'https://opencollective.com/gentelduck',
    twitter: 'https://x.com/wild_ducka',
  },
  name: 'duck-upload',
  ogImage: absoluteUrl('/og/root.png'),
  title: 'a modular, strategy-based file upload engine',
  url: absoluteUrl('/'),
}

export type SiteConfig = typeof siteConfig

export const META_THEME_COLORS = {
  dark: '#09090b',
  light: '#ffffff',
}
