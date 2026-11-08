// Jupiter's own conversations (the Activity tab): a list in .jupiter/jupiter-chats.json and each
// conversation's messages in .jupiter/jupiter-chats/<id>.json, so one never shows another's
// messages. A message is a finished coordinator or quick action operation tagged with its
// conversation. Agent chats (Claude Code, Codex terminals) are not touched here.
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { readJson, saveJson } from './util.mjs';

export const NEW_TITLE = 'New chat';
const KEEP = 400; // messages kept per conversation
const ID = /^[a-z0-9-]{6,64}$/;

/** A short title from a first message: its opening words, trimmed and capitalised. */
export function titleFrom(text) {
  const plain = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[`*_#>[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  const first = (plain.split(/(?<=[.!?])\s/)[0] || plain).replace(/^(?:hey |hi |ok |okay )?(?:jupiter[,.]?\s*)?(?:(?:can|could|would) you |please )?/i, '').replace(/[.!?,;:]+$/, '');
  const words = first.split(' ').filter(Boolean).slice(0, 7);
  let title = words.join(' ');
  if (title.length > 48) title = `${title.slice(0, 47).replace(/\s+\S*$/, '')}…`;
  return title ? title[0].toUpperCase() + title.slice(1) : NEW_TITLE;
}

export class JupiterChats {
  constructor(stateDir) {
    this.file = path.join(stateDir, 'jupiter-chats.json');
    this.folder = path.join(stateDir, 'jupiter-chats');
    this.list = { active: null, chats: [] };
    this.messages = new Map();
    this.saves = Promise.resolve();
  }
  /** Loads the list. The first time, earlier messages become one "Earlier conversation". */
  async init(earlier = []) {
    const stored = await readJson(this.file, null);
    if (stored?.chats) this.list = { active: stored.active, chats: stored.chats.filter(chat => ID.test(chat.id)) };
    else if (earlier.length) {
      const chat = this.blank('Earlier conversation', true);
      this.list.chats.push(chat);
      this.messages.set(chat.id, earlier.filter(item => item.status !== 'running').map(item => ({ ...item, conversation: chat.id })).slice(-KEEP));
      chat.updated = earlier.at(-1)?.at || chat.created;
      await this.saveMessages(chat.id);
    }
    if (!this.list.chats.length) this.list.chats.push(this.blank());
    if (!this.find(this.list.active)) this.list.active = this.recent()[0].id;
    await this.saveList();
    return this;
  }
  blank(title = NEW_TITLE, named = false) { const now = new Date().toISOString(); return { id: randomUUID(), title, named, created: now, updated: now }; }
  find(id) { return this.list.chats.find(chat => chat.id === id) || null; }
  recent() { return [...this.list.chats].sort((a, b) => b.updated.localeCompare(a.updated)); }
  get active() { return this.list.active; }
  summary() { return { active: this.list.active, chats: this.recent() }; }
  saveList() { this.saves = this.saves.catch(() => {}).then(() => saveJson(this.file, this.list)); return this.saves; }
  async saveMessages(id) {
    await mkdir(this.folder, { recursive: true });
    const items = this.messages.get(id) || [];
    this.saves = this.saves.catch(() => {}).then(() => saveJson(path.join(this.folder, `${id}.json`), items));
    return this.saves;
  }
  async read(id) {
    if (!this.find(id)) throw Object.assign(new Error('That conversation no longer exists.'), { status: 404 });
    if (!this.messages.has(id)) this.messages.set(id, await readJson(path.join(this.folder, `${id}.json`), []));
    return this.messages.get(id);
  }
  /** A new, empty conversation becomes the active one. An unused empty one is reused. */
  async create() {
    let chat = null;
    for (const item of this.list.chats) if (!item.named && item.title === NEW_TITLE && !(await this.read(item.id)).length) { chat = item; break; }
    if (!chat) { chat = this.blank(); this.list.chats.push(chat); this.messages.set(chat.id, []); }
    chat.updated = new Date().toISOString();
    this.list.active = chat.id;
    await this.saveList();
    return chat;
  }
  async select(id) { if (!this.find(id)) throw Object.assign(new Error('That conversation no longer exists.'), { status: 404 }); this.list.active = id; await this.saveList(); }
  async rename(id, title) {
    const chat = this.find(id); if (!chat) throw Object.assign(new Error('That conversation no longer exists.'), { status: 404 });
    const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!clean) throw Object.assign(new Error('Give the conversation a name.'), { status: 400 });
    Object.assign(chat, { title: clean, named: true }); await this.saveList();
    return chat;
  }
  /** Deletes a conversation and its messages. Another one (or a new one) becomes active. */
  async remove(id) {
    if (!this.find(id)) throw Object.assign(new Error('That conversation no longer exists.'), { status: 404 });
    this.list.chats = this.list.chats.filter(chat => chat.id !== id);
    this.messages.delete(id);
    await rm(path.join(this.folder, `${id}.json`), { force: true });
    if (!this.list.chats.length) this.list.chats.push(this.blank());
    if (this.list.active === id) this.list.active = this.recent()[0].id;
    await this.saveList();
  }
  /** A finished operation joins its conversation; the first message names an unnamed one. */
  async record(operation) {
    const chat = this.find(operation?.conversation);
    if (!chat || operation.status === 'running') return null;
    const items = await this.read(chat.id);
    const at = items.findIndex(item => item.id === operation.id);
    if (at >= 0) items[at] = operation; else items.push(operation);
    if (items.length > KEEP) items.splice(0, items.length - KEEP);
    if (!chat.named && chat.title === NEW_TITLE) chat.title = titleFrom(operation.text);
    chat.updated = operation.at || new Date().toISOString();
    await this.saveMessages(chat.id); await this.saveList();
    return chat;
  }
}
