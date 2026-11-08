import { useEffect, useState } from 'react'
import { api, reportError } from './client'
import { Icon } from './Icons'
import type { JupiterChatList } from './types'

const when = (iso: string) => {
  const date = new Date(iso), today = new Date()
  return date.toDateString() === today.toDateString() ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

// The Activity tab: Jupiter's own conversations. Open one, start a new one, or rename or delete
// one from its menu. Agent chats are not listed here and are never stopped from here.
export default function JupiterChats({ list, onOpen }: { list: JupiterChatList; onOpen: () => void }) {
  const [menu, setMenu] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A click anywhere else closes an open menu.
  useEffect(() => {
    if (!menu) return
    const away = (event: PointerEvent) => { if (!(event.target as Element).closest('.jupiter-chat-menu, .jupiter-chat-more')) setMenu(null) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [menu])
  const act = async (path: string, data: object, open = false) => {
    if (busy) return
    setBusy(true)
    try { await api(`/jupiter/chats/${path}`, data); if (open) onOpen() } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  const rename = async () => {
    if (!renaming) return
    const { id, title } = renaming
    setRenaming(null)
    if (title.trim() && title.trim() !== list.chats.find(chat => chat.id === id)?.title) await act('rename', { id, title })
  }
  return <div className="jupiter-chats">
    <button type="button" className="jupiter-chat-new" disabled={busy} onClick={() => void act('new', {}, true)}><Icon name="plus" size={14} />New chat</button>
    <ul aria-label="Jupiter conversations">{list.chats.map(chat => {
      const active = chat.id === list.active
      return <li key={chat.id} className={`jupiter-chat${active ? ' active' : ''}`}>
        {renaming?.id === chat.id
          ? <input autoFocus aria-label="Conversation name" value={renaming.title} maxLength={80} onChange={event => setRenaming({ id: chat.id, title: event.target.value })}
            onKeyDown={event => { if (event.key === 'Enter') void rename(); if (event.key === 'Escape') setRenaming(null) }} onBlur={() => void rename()} />
          : <button type="button" className="jupiter-chat-open" aria-current={active ? 'true' : undefined} onClick={() => void act('select', { id: chat.id }, true)}>
            <i aria-hidden="true" /><span>{chat.title}</span><time>{when(chat.updated)}</time>
          </button>}
        <button type="button" className="desk-icon jupiter-chat-more" aria-label={`More for ${chat.title}`} aria-expanded={menu === chat.id} onClick={() => setMenu(menu === chat.id ? null : chat.id)}><Icon name="more" size={15} /></button>
        {menu === chat.id && <div className="jupiter-chat-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(null); setRenaming({ id: chat.id, title: chat.title }) }}><Icon name="edit" size={14} />Rename</button>
          <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); setDeleting(chat.id) }}><Icon name="trash" size={14} />Delete</button>
        </div>}
        {deleting === chat.id && <div className="jupiter-chat-confirm" role="alertdialog" aria-label={`Delete ${chat.title}`}>
          <p>Delete this conversation and its messages?</p>
          <div><button type="button" className="danger" onClick={() => { setDeleting(null); void act('delete', { id: chat.id }) }}>Delete</button><button type="button" onClick={() => setDeleting(null)}>Cancel</button></div>
        </div>}
      </li>
    })}</ul>
  </div>
}
