import type * as React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Contracts } from '../core'
import type { Store } from '../core/engine/store'
import { useUploadStore } from './upload-provider'

/**
 * Test a file against one token from an `accept` string. A token is a MIME type
 * (`image/png`), a MIME wildcard (`image/*`), or a filename extension (`.pdf`).
 * @internal exported for tests.
 */
export function matchesAcceptToken(file: File, token: string): boolean {
  const t = token.trim().toLowerCase()
  if (!t) return false

  if (t.startsWith('.')) {
    return file.name.toLowerCase().endsWith(t)
  }

  const type = (file.type || '').toLowerCase()
  if (t.endsWith('/*')) {
    return type.startsWith(`${t.slice(0, -1)}`) // "image/" prefix
  }
  return type === t
}

/**
 * True when `file` satisfies an `accept` list (comma-separated tokens). An empty
 * or absent list accepts everything.
 * @internal exported for tests.
 */
export function fileMatchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true
  const tokens = accept
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (tokens.length === 0) return true
  return tokens.some((tok) => matchesAcceptToken(file, tok))
}

/**
 * Filter a dropped/selected file list by `accept` and collapse to a single file
 * when `multiple` is false.
 * @internal exported for tests.
 */
export function selectFiles(
  files: File[],
  opts: { accept?: string | undefined; multiple?: boolean | undefined },
): File[] {
  const accepted = files.filter((f) => fileMatchesAccept(f, opts.accept))
  return opts.multiple === false ? accepted.slice(0, 1) : accepted
}

/** Options for {@link useDropzone}. */
export type UseDropzoneOptions<P extends string> = {
  /** Purpose forwarded to the `addFiles` command. */
  purpose: P
  /** Optional caller metadata forwarded to every backend API call. */
  meta?: Record<string, unknown>
  /**
   * Comma-separated `accept` list (`"image/*,.pdf"`). Filters dropped files and
   * populates the input's `accept` attribute. Absent = accept everything.
   */
  accept?: string
  /** Allow multiple files. Defaults to `true`. */
  multiple?: boolean
  /** Disable all interaction (no drop, no click-to-open). Defaults to `false`. */
  disabled?: boolean
  /** Do not open the file dialog when the root is clicked. Defaults to `false`. */
  noClick?: boolean
  /**
   * Override the default dispatch. When provided, accepted files are handed here
   * instead of being dispatched as `addFiles` to the store.
   */
  onFiles?: (files: File[]) => void
  /** Store instance to dispatch to. Falls back to the `<UploadProvider>` store. */
  store?: Store.UploadStore<Contracts.Intent.Map, Contracts.Cursor.Map<Contracts.Intent.Map>, P, Contracts.Result.Base>
}

/** Return value of {@link useDropzone}. */
export type UseDropzoneReturn = {
  /** True while files are being dragged over the root. */
  isDragging: boolean
  /** Programmatically open the native file picker. */
  open: () => void
  /** Ref to attach to the hidden `<input type="file">`. */
  inputRef: React.RefObject<HTMLInputElement | null>
  /** Spread onto the drop-target element. */
  getRootProps: (extra?: React.HTMLAttributes<HTMLElement>) => React.HTMLAttributes<HTMLElement>
  /** Spread onto the hidden `<input type="file">`. */
  getInputProps: (
    extra?: React.InputHTMLAttributes<HTMLInputElement>,
  ) => React.InputHTMLAttributes<HTMLInputElement> & { ref: React.Ref<HTMLInputElement> }
}

/**
 * Headless drag-and-drop / file-picker hook.
 *
 * Wires drop and file-input events to the upload store's `addFiles` command
 * (or a custom `onFiles` handler). Returns prop-getters for the drop target and
 * a hidden file input plus a live `isDragging` flag — styling and markup are
 * entirely yours.
 *
 * @example
 * ```tsx
 * function Drop() {
 *   const { getRootProps, getInputProps, isDragging, open } = useDropzone({
 *     purpose: 'attachment',
 *     accept: 'image/*',
 *   });
 *   return (
 *     <div {...getRootProps()} data-active={isDragging}>
 *       <input {...getInputProps()} />
 *       <button type="button" onClick={open}>Choose files</button>
 *     </div>
 *   );
 * }
 * ```
 * @author wildduck2 <https://github.com/wildduck2>
 */
export function useDropzone<P extends string>(options: UseDropzoneOptions<P>): UseDropzoneReturn {
  const { purpose, meta, accept, multiple = true, disabled = false, noClick = false, onFiles } = options

  // Read the context store unconditionally (hooks rule); prefer an explicit one.
  const contextStore = useUploadStore<
    Contracts.Intent.Map,
    Contracts.Cursor.Map<Contracts.Intent.Map>,
    P,
    Contracts.Result.Base
  >()
  const store = options.store ?? contextStore

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  // Depth counter so nested dragenter/dragleave don't flicker the flag.
  const dragDepth = useRef(0)

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return
      const chosen = selectFiles(Array.from(list), { accept, multiple })
      if (chosen.length === 0) return
      if (onFiles) {
        onFiles(chosen)
      } else {
        store.dispatch({ type: 'addFiles', files: chosen, purpose, meta })
      }
    },
    [accept, multiple, onFiles, store, purpose, meta],
  )

  const open = useCallback(() => {
    if (disabled) return
    inputRef.current?.click()
  }, [disabled])

  const getRootProps = useCallback<UseDropzoneReturn['getRootProps']>(
    (extra = {}) => ({
      ...extra,
      onDragEnter: (e) => {
        extra.onDragEnter?.(e)
        if (disabled) return
        e.preventDefault()
        e.stopPropagation()
        dragDepth.current += 1
        setIsDragging(true)
      },
      onDragOver: (e) => {
        extra.onDragOver?.(e)
        if (disabled) return
        // Required so the browser fires `drop` instead of navigating.
        e.preventDefault()
        e.stopPropagation()
      },
      onDragLeave: (e) => {
        extra.onDragLeave?.(e)
        if (disabled) return
        e.preventDefault()
        e.stopPropagation()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setIsDragging(false)
      },
      onDrop: (e) => {
        extra.onDrop?.(e)
        if (disabled) return
        e.preventDefault()
        e.stopPropagation()
        dragDepth.current = 0
        setIsDragging(false)
        handleFiles(e.dataTransfer?.files ?? null)
      },
      onClick: (e) => {
        extra.onClick?.(e)
        if (disabled || noClick) return
        open()
      },
    }),
    [disabled, noClick, open, handleFiles],
  )

  const getInputProps = useCallback<UseDropzoneReturn['getInputProps']>(
    (extra = {}) => ({
      ...extra,
      ref: inputRef,
      type: 'file',
      multiple,
      disabled,
      ...(accept ? { accept } : {}),
      // Visually hidden; caller styles can extend but not un-hide by accident.
      style: { display: 'none', ...extra.style },
      onChange: (e) => {
        extra.onChange?.(e)
        handleFiles(e.target.files)
        // Reset so selecting the same file again re-fires change.
        e.target.value = ''
      },
    }),
    [multiple, disabled, accept, handleFiles],
  )

  return useMemo(
    () => ({ isDragging, open, inputRef, getRootProps, getInputProps }),
    [isDragging, open, getRootProps, getInputProps],
  )
}
