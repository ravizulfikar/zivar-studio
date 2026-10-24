import type { JSX, ReactNode } from 'react'
import { ExportMenu } from './ExportMenu'
import type { ExportFormat } from './exportData'
import { IconDesign, IconDiagram, IconImport, IconJson, IconList, IconMoon, IconPanel, IconPlug, IconPlus, IconQuery, IconRefresh, IconSun, IconTable } from './Icons'
import type { Theme } from './theme'

export interface ToolbarActions {
  onNewConnection: () => void
  onNewQuery: () => void
  onObjects: () => void
  onNewTable: () => void
  onImport: () => void
  canImport: boolean
  canNewTable: boolean
  onDiagram: () => void
  canDiagram: boolean
  onOpenTable: () => void
  onDesign: () => void
  onRefresh: () => void
  onJson: () => void
  onExport: (format: ExportFormat) => void
  onToggleDetails: () => void
  onToggleTheme: () => void
  theme: Theme
  hasConnection: boolean
  hasObject: boolean
  canExport: boolean
  detailsOpen: boolean
}

function Btn(props: { icon: ReactNode; label: string; tone: string; onClick: () => void; disabled?: boolean; active?: boolean }): JSX.Element {
  return (
    <button className={`tool ${props.tone} ${props.active ? 'active' : ''}`} onClick={props.onClick} disabled={props.disabled}>
      <span className="tool-icon">{props.icon}</span>
      <span>{props.label}</span>
    </button>
  )
}

export function Toolbar(a: ToolbarActions): JSX.Element {
  return (
    <div className="toolbar-main">
      <Btn tone="teal" icon={<IconPlug size={22} />} label="Connection" onClick={a.onNewConnection} />
      <Btn tone="violet" icon={<IconQuery size={22} />} label="New Query" onClick={a.onNewQuery} disabled={!a.hasConnection} />
      <div className="vsep" />
      <Btn tone="blue" icon={<IconList size={22} />} label="Objects" onClick={a.onObjects} disabled={!a.hasConnection} />
      <Btn tone="violet" icon={<IconDiagram size={22} />} label="Diagram" onClick={a.onDiagram} disabled={!a.canDiagram} />
      <Btn tone="teal" icon={<IconPlus size={22} />} label="New Table" onClick={a.onNewTable} disabled={!a.canNewTable} />
      <Btn tone="blue" icon={<IconTable size={22} />} label="Open Table" onClick={a.onOpenTable} disabled={!a.hasObject} />
      <Btn tone="blue" icon={<IconDesign size={22} />} label="Design" onClick={a.onDesign} disabled={!a.hasObject} />
      <div className="vsep" />
      <Btn tone="orange" icon={<IconRefresh size={22} />} label="Refresh" onClick={a.onRefresh} />
      <Btn tone="green" icon={<IconImport size={22} />} label="Import" onClick={a.onImport} disabled={!a.canImport} />
      <ExportMenu variant="tool" disabled={!a.canExport} onExport={a.onExport} />
      <Btn tone="orange" icon={<IconJson size={22} />} label="JSON" onClick={a.onJson} />
      <div className="grow" />
      <Btn tone="gray" icon={a.theme === 'dark' ? <IconSun size={22} /> : <IconMoon size={22} />} label={a.theme === 'dark' ? 'Light' : 'Dark'} onClick={a.onToggleTheme} />
      <Btn tone="gray" icon={<IconPanel size={22} />} label="Details" onClick={a.onToggleDetails} active={a.detailsOpen} />
    </div>
  )
}
