import { ArrowUpFromLine, Cog, Layers, Puzzle, Server, Zap } from 'lucide-react'
export const features = [
  {
    bgColor: 'rgba(59, 130, 246, 0.1)',
    description:
      'Split large files into chunks and upload them in parallel with automatic retry. Resume interrupted uploads without starting over.',
    icon: <ArrowUpFromLine aria-hidden="true" className="h-7 w-7" />,
    textColor: 'rgb(59, 130, 246)',
    title: 'Resumable Uploads',
  },
  {
    bgColor: 'rgba(234, 179, 8, 0.1)',
    description:
      'Every upload config, hook, and state transition is fully typed. Catch misconfigurations at compile time, not in production.',
    icon: <Zap aria-hidden="true" className="h-7 w-7" />,
    textColor: 'rgb(234, 179, 8)',
    title: 'Type-Safe From Backend to UI',
  },
  {
    bgColor: 'rgba(168, 85, 247, 0.1)',
    description:
      'Swap between S3 multipart, presigned POST, or custom strategies without changing your application code.',
    icon: <Puzzle aria-hidden="true" className="h-7 w-7" />,
    textColor: 'rgb(168, 85, 247)',
    title: 'Pluggable Strategies',
  },
  {
    bgColor: 'rgba(34, 197, 94, 0.1)',
    description:
      'useUploader hook and UploadProvider give you reactive upload state, progress tracking, and file management out of the box.',
    icon: <Layers aria-hidden="true" className="h-7 w-7" />,
    textColor: 'rgb(34, 197, 94)',
    title: 'React Bindings',
  },
  {
    bgColor: 'rgba(249, 115, 22, 0.1)',
    description:
      'Works with S3, MinIO, Cloudflare R2, and any S3-compatible storage. Presigned URLs keep credentials off the client.',
    icon: <Server aria-hidden="true" className="h-7 w-7" />,
    textColor: 'rgb(249, 115, 22)',
    title: 'S3 & MinIO Ready',
  },
  {
    bgColor: 'rgba(14, 165, 233, 0.1)',
    description:
      'Built on a state machine with clear lifecycle events. Persist upload state across page reloads and app restarts.',
    icon: <Cog aria-hidden="true" className="h-7 w-7" />,
    textColor: 'rgb(14, 165, 233)',
    title: 'State Machine & Persistence',
  },
]
