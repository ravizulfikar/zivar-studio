import type { IpcResult } from '@shared/types'

/** Unwrap an IPC result, turning { ok: false } into a thrown Error. */
export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.data
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
