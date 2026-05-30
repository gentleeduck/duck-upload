/**
 * Presigned-POST strategy: a single `multipart/form-data` POST with
 * server-provided fields. Non-resumable; suitable for small/medium files.
 *
 * Security: the presigned URL returned by the backend flows straight to
 * the transport. A compromised backend or MITM can return a `file://`,
 * `javascript:`, or private-network URL. Configure {@link allowedHosts}
 * (preferred) or leave {@link allowPrivateHosts} at its default `false`
 * to block loopback/private addresses.
 */

import type { CursorMap, IntentMap, UploadResultBase, UploadStrategy } from '../../core/contracts'
import { validateUploadUrl } from '../../core/utils/url-safety'

export type PostStrategyConfig = {
  /**
   * Case-insensitive allow-list of host names (with optional port). When
   * set, the presigned POST URL must match a listed host or it is rejected.
   */
  allowedHosts?: string[]
  /**
   * When `true`, allow private-network IP literals in the POST URL.
   * Defaults to `false`.
   */
  allowPrivateHosts?: boolean
}

export namespace PostStrategy {
  export type IConfig = PostStrategyConfig
}

let warnedMissingAllowedHosts = false

/** Reset internal warn-once latches. Test-only. @internal */
export function __resetPostWarningsForTests(): void {
  warnedMissingAllowedHosts = false
}

export type PostIntent = {
  strategy: 'post'
  fileId: string
  /** Presigned POST URL (form action). */
  url: string
  /** Form fields to include before the file. */
  fields: Record<string, string>
  /** Optional expiry of the presigned URL. */
  expiresAt?: string
}

export type PostCursor = {
  /** Bytes uploaded - progress display only; not used for resume. */
  uploadedBytes: number
}

export function PostStrategy<
  M extends IntentMap & { post: PostIntent },
  C extends CursorMap<M> & { post?: PostCursor },
  P extends string = string,
  R extends UploadResultBase = UploadResultBase,
>(config: PostStrategyConfig = {}): UploadStrategy<M, C, P, R, 'post'> {
  return {
    id: 'post',
    resumable: false,

    async start(ctx) {
      const intent = ctx.intent

      if (!intent.url) {
        throw new Error('post.start: intent missing url')
      }
      if (!config.allowedHosts && !warnedMissingAllowedHosts) {
        warnedMissingAllowedHosts = true
        console.warn(
          '[duck-upload] PostStrategy: no `allowedHosts` configured. Presigned POST URLs will be host-unrestricted. ' +
            'Set PostStrategy.IConfig.allowedHosts to lock the upload host.',
        )
      }
      validateUploadUrl(intent.url, 'post.intent', config)

      await ctx.transport.postForm({
        url: intent.url,
        file: ctx.file,
        fields: intent.fields,
        filename: ctx.file.name,
        signal: ctx.signal,
        onProgress(uploadedBytes, totalBytes) {
          ctx.reportProgress({ uploadedBytes, totalBytes })
        },
      })
    },
  }
}
