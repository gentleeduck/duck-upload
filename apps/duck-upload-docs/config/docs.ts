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
          title: 'Quick Start',
        },
        {
          href: '/docs/faqs',
          title: 'FAQs',
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
          title: 'Engine & State Machine',
        },
        {
          href: '/docs/core/client',
          title: 'Client & Config',
        },
        {
          href: '/docs/core/contracts',
          title: 'Contracts & Interfaces',
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
      title: 'Core Concepts',
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
          href: '/docs/strategies/post',
          title: 'POST (Presigned)',
        },
        {
          href: '/docs/strategies/multipart',
          title: 'Multipart (S3/MinIO)',
        },
        {
          href: '/docs/strategies/registry',
          title: 'Strategy Registry',
        },
      ],
      title: 'Strategies',
    },
    {
      collapsible: false,
      items: [
        {
          href: '/docs/design',
          title: 'Design Decisions',
        },
        {
          href: '/docs/skills',
          title: 'Agent Skills',
        },
      ],
      title: 'Advanced',
    },
    {
      collapsible: false,
      items: [
        {
          href: '/docs/course',
          title: 'Course Overview',
        },
        {
          href: '/docs/course/chapter-1',
          title: '1. Your First Upload',
        },
        {
          href: '/docs/course/chapter-2',
          title: '2. Strategies & Backends',
        },
        {
          href: '/docs/course/chapter-3',
          title: '3. React Integration',
        },
        {
          href: '/docs/course/chapter-4',
          title: '4. Multipart Uploads',
        },
        {
          href: '/docs/course/chapter-5',
          title: '5. Pause, Resume & Retry',
        },
        {
          href: '/docs/course/chapter-6',
          title: '6. Persistence & Offline',
        },
        {
          href: '/docs/course/chapter-7',
          title: '7. Validation & Plugins',
        },
        {
          href: '/docs/course/chapter-8',
          title: '8. Production Patterns',
        },
      ],
      title: 'Course',
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
