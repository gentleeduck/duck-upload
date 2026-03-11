import type { DocsConfig } from '@gentleduck/docs/context'

export const docsConfig = {
  chartsNav: [],
  mainNav: [
    {
      href: '/docs',
      title: 'Documentation',
    },
  ],
  sidebarNav: [
    {
      collapsible: false,
      items: [
        {
          href: '/docs',
          title: 'Introduction',
        },
        {
          href: '/docs/installation',
          title: 'Installation',
        },
        {
          href: '/docs/guides',
          title: 'Guides',
        },
      ],
      title: 'Getting Started',
    },
    {
      collapsible: false,
      items: [
        {
          href: '/docs/core',
          title: 'Overview',
        },
        {
          href: '/docs/core/engine',
          title: 'Engine',
        },
        {
          href: '/docs/core/client',
          title: 'Client',
        },
        {
          href: '/docs/core/contracts',
          title: 'Contracts',
        },
        {
          href: '/docs/core/persistence',
          title: 'Persistence',
        },
        {
          href: '/docs/core/utils',
          title: 'Utilities',
        },
      ],
      title: 'Core',
    },
    {
      collapsible: false,
      items: [
        {
          href: '/docs/react',
          title: 'Overview',
        },
        {
          href: '/docs/react/upload-provider',
          title: 'UploadProvider',
        },
        {
          href: '/docs/react/use-uploader',
          title: 'useUploader',
        },
      ],
      title: 'React',
    },
    {
      collapsible: false,
      items: [
        {
          href: '/docs/strategies',
          title: 'Overview',
        },
        {
          href: '/docs/strategies/multipart',
          title: 'Multipart (S3/MinIO)',
        },
        {
          href: '/docs/strategies/post',
          title: 'POST (Presigned)',
        },
        {
          href: '/docs/strategies/registry',
          title: 'Registry',
        },
      ],
      title: 'Strategies',
    },
    {
      collapsible: false,
      items: [
        {
          href: '/docs/course',
          title: 'Overview',
        },
        {
          href: '/docs/course/chapter-1',
          title: 'Your First Upload',
        },
        {
          href: '/docs/course/chapter-2',
          title: 'Strategies & Backends',
        },
        {
          href: '/docs/course/chapter-3',
          title: 'React Integration',
        },
        {
          href: '/docs/course/chapter-4',
          title: 'Multipart Uploads',
        },
        {
          href: '/docs/course/chapter-5',
          title: 'Pause, Resume & Retry',
        },
        {
          href: '/docs/course/chapter-6',
          title: 'Persistence & Offline',
        },
        {
          href: '/docs/course/chapter-7',
          title: 'Validation & Plugins',
        },
        {
          href: '/docs/course/chapter-8',
          title: 'Production Patterns',
        },
      ],
      title: 'Course',
    },
    {
      collapsible: false,
      items: [
        {
          href: '/docs/design',
          title: 'Design Decisions',
        },
        {
          href: '/docs/faqs',
          title: 'FAQs',
        },
      ],
      title: 'Architecture',
    },
  ],
} satisfies DocsConfig

type NavItem = {
  title: string
  href?: string
  label?: string
  items?: NavItem[]
}

function extractTitles(navItems: NavItem[]): string[] {
  const titles: string[] = []

  for (const item of navItems) {
    if (item.title) {
      titles.push(item.title)
    }

    if (item.items && item.items.length > 0) {
      titles.push(...extractTitles(item.items))
    }
  }

  return titles
}

export const allTitles = [
  ...extractTitles(docsConfig.mainNav),
  ...extractTitles(docsConfig.sidebarNav),
  ...extractTitles(docsConfig.chartsNav),
]
