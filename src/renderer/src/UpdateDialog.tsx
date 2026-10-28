import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { installHint, RELEASES_PAGE, type UpdateResult } from '@shared/updates'

/** One check, used by the dialog and by the automatic check on start-up. */
export async function runUpdateCheck(auto: boolean): Promise<UpdateResult> {
  const r = await window.api.checkForUpdates(auto)
  return r.ok ? r.data : { ok: false, error: r.error }
}

const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`
const when = (iso: string | null): string => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '')

interface Props {
  /** An answer already at hand (from the automatic check); the dialog asks again when there is none. */
  initial: UpdateResult | null
  onResult: (r: UpdateResult) => void
  onClose: () => void
}

export function UpdateDialog({ initial, onResult, onClose }: Props): JSX.Element {
  const [result, setResult] = useState<UpdateResult | null>(initial)
  const [checking, setChecking] = useState(false)

  const check = async (): Promise<void> => {
    setChecking(true)
    const r = await runUpdateCheck(false)
    setResult(r)
    onResult(r)
    setChecking(false)
  }
  useEffect(() => {
    if (!initial) void check()
    // Once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const open = (url: string): void => void window.open(url)

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog update-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Check for updates</h3>
        <div className="muted">Installed: version {__APP_VERSION__}</div>

        {checking && <div className="msg">Checking GitHub…</div>}

        {!checking && result && !result.ok && (
          <>
            <div className="msg error">{result.error}</div>
            <div className="muted small-note">You can also look at the releases page yourself.</div>
          </>
        )}

        {!checking && result?.ok && !result.newer && (
          <div className="msg ok update-ok">
            You have the latest version ({result.current}).
            {result.latest.version !== result.current && <span className="muted"> The newest published release is {result.latest.version}.</span>}
          </div>
        )}

        {!checking && result?.ok && result.newer && (
          <>
            <div className="update-new">
              <strong>Version {result.latest.version} is available</strong>
              <span className="muted"> {when(result.latest.publishedAt)}</span>
            </div>
            {result.latest.notes && <pre className="update-notes">{result.latest.notes.length > 3000 ? `${result.latest.notes.slice(0, 3000)}…` : result.latest.notes}</pre>}
            {result.recommended ? (
              <>
                <div className="muted small-note">
                  {result.recommended.name}
                  {result.recommended.size ? ` (${mb(result.recommended.size)})` : ''}
                </div>
                {installHint(result.recommended.name) && <div className="muted small-note">{installHint(result.recommended.name)}</div>}
              </>
            ) : (
              <div className="muted small-note">This release has no file for your system; see the release page.</div>
            )}
          </>
        )}

        <div className="row end">
          <button disabled={checking} onClick={() => void check()}>
            Check again
          </button>
          <button onClick={() => open(result?.ok ? result.latest.url : RELEASES_PAGE)}>Release page</button>
          {result?.ok && result.newer && result.recommended && (
            <button className="primary" onClick={() => open(result.recommended!.url)}>
              Download
            </button>
          )}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
