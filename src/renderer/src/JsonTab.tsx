import { useRef, useState } from 'react'
import type { JSX } from 'react'
import { download } from './exportData'
import { JsonEditor } from './JsonEditor'

/** A free-standing JSON editor tab (no connection): paste, open a file, edit as text or tree, save. */
export function JsonTab(): JSX.Element {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('data.json')
  const file = useRef<HTMLInputElement>(null)

  const open = async (f: File): Promise<void> => {
    setText(await f.text())
    setFileName(f.name)
  }

  return (
    <div className="json-tab">
      <div className="subtoolbar">
        <button onClick={() => file.current?.click()}>Open file…</button>
        <button disabled={!text.trim()} onClick={() => download(new Blob([text], { type: 'application/json' }), fileName)}>
          Save as {fileName}
        </button>
        <button onClick={async () => setText(await navigator.clipboard.readText().catch(() => text))} title="Replace the content with the clipboard">
          Paste
        </button>
        <button disabled={!text} onClick={() => setText('')}>
          Clear
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,.geojson,.jsonl,.txt,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void open(f)
            e.target.value = ''
          }}
        />
      </div>
      <JsonEditor text={text} onChange={setText} />
    </div>
  )
}
