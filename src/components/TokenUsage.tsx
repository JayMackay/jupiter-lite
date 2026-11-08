import { useEffect, useState } from 'react'
import { api, isDesktop } from '../desktop/client'
import '../styles/token-usage.css'

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
type Pair = { claude: Usage; codex: Usage }
export type TokenSummary = { updatedAt: string; days: number; today: string; totals: { today: Pair; week: Pair; range: Pair }; byDay: ({ date: string } & Pair)[]; models: { agent: 'claude' | 'codex'; model: string; usage: Usage; replies: number }[]; sources: { claude: number; codex: number } }

const AGENT = { claude: 'Claude Code', codex: 'Codex' } as const
const tokens = (value: number) => value >= 1e9 ? `${(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(Math.round(value))
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short' }).slice(0, 2)

function useTokens(refresh?: unknown) {
  const [data, setData] = useState<TokenSummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!isDesktop) return
    let alive = true
    api<TokenSummary>('/tokens').then(value => { if (alive) { setData(value); setError('') } }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { alive = false }
  }, [refresh])
  return { data, error }
}

function Bars({ days, tall = false }: { days: TokenSummary['byDay']; tall?: boolean }) {
  const max = Math.max(1, ...days.map(day => day.claude.total + day.codex.total))
  return <div className={`jh-tk-bars${tall ? ' is-tall' : ''}`} aria-hidden="true">
    {days.map(day => <span key={day.date} title={`${day.date}: ${tokens(day.claude.total)} Claude Code, ${tokens(day.codex.total)} Codex`}>
      <i className="codex" style={{ height: `${(day.codex.total / max) * 100}%` }} /><i className="claude" style={{ height: `${(day.claude.total / max) * 100}%` }} />
      {tall && <small>{dayLabel(day.date)}</small>}
    </span>)}
  </div>
}

/** The home panel: this week's total, today, and a 7 day chart. */
export function TokenUsageSummary({ refresh }: { refresh?: unknown }) {
  const { data, error } = useTokens(refresh)
  if (!isDesktop) return <p className="jh-empty">Token usage needs the desktop app.</p>
  if (error) return <p className="jh-empty">{error}</p>
  if (!data) return <p className="jh-empty">Reading usage…</p>
  const week = data.totals.week.claude.total + data.totals.week.codex.total
  const today = data.totals.today.claude.total + data.totals.today.codex.total
  return <div className="jh-tk-summary">
    <div className="jh-tk-big"><b>{tokens(week)}</b><span>tokens this week</span></div>
    <div className="jh-tk-split"><span><i className="claude" />Claude Code {tokens(data.totals.week.claude.total)}</span><span><i className="codex" />Codex {tokens(data.totals.week.codex.total)}</span></div>
    <Bars days={data.byDay.slice(-7)} />
    <small className="jh-tk-today">Today {tokens(today)}</small>
  </div>
}

/** The expanded window: two weeks by day, what the tokens were spent on, and by model. */
export default function TokenUsageView() {
  const { data, error } = useTokens()
  if (!isDesktop) return <p className="jh-empty">Token usage needs the desktop app.</p>
  if (error) return <p className="jh-empty">{error}</p>
  if (!data) return <p className="jh-empty">Reading usage…</p>
  const range = { claude: data.totals.range.claude, codex: data.totals.range.codex }
  const all = range.claude.total + range.codex.total
  const parts: [keyof Usage, string, string][] = [['cacheRead', 'Read from cache', 'Context reused between turns; much cheaper than new input'], ['cacheWrite', 'Written to cache', 'Context saved for reuse'], ['input', 'New input', 'Your messages, files and tool results'], ['output', 'Output', 'What the agents wrote, including reasoning']]
  return <div className="jh-tk">
    <div className="jh-tk-tiles">
      {(['today', 'week', 'range'] as const).map(span => <div key={span} className="jh-tk-tile"><b>{tokens(data.totals[span].claude.total + data.totals[span].codex.total)}</b><span>{span === 'today' ? 'Today' : span === 'week' ? 'Last 7 days' : `Last ${data.days} days`}</span>
        <small>Claude Code {tokens(data.totals[span].claude.total)} · Codex {tokens(data.totals[span].codex.total)}</small></div>)}
    </div>
    <section className="jh-tk-card"><h3>By day<small><i className="claude" />Claude Code <i className="codex" />Codex</small></h3><Bars days={data.byDay} tall /></section>
    <div className="jh-tk-two">
      <section className="jh-tk-card"><h3>Where it went</h3>
        {parts.map(([key, label, hint]) => { const value = range.claude[key] + range.codex[key]; return <div key={key} className="jh-tk-row"><span><b>{label}</b><small>{hint}</small></span><span className="jh-tk-meter"><i style={{ width: `${all ? (value / all) * 100 : 0}%` }} /></span><span className="jh-tk-num">{tokens(value)}</span></div> })}
      </section>
      <section className="jh-tk-card"><h3>By model</h3>
        {data.models.map(model => <div key={`${model.agent}${model.model}`} className="jh-tk-row"><span><b>{model.model}</b><small>{AGENT[model.agent]} · {model.replies} replies</small></span><span className="jh-tk-meter"><i className={model.agent} style={{ width: `${all ? (model.usage.total / all) * 100 : 0}%` }} /></span><span className="jh-tk-num">{tokens(model.usage.total)}</span></div>)}
        {!data.models.length && <p className="jh-empty">No usage in the last {data.days} days.</p>}
      </section>
    </div>
    <p className="jh-note">Counted from Claude Code and Codex logs on this PC ({data.sources.claude + data.sources.codex} sessions). Only the usage numbers are read, never the conversation. Chats in other apps aren't included.</p>
  </div>
}
