/**
 * tracker-pane — LOSOS pane for urn:solid:Tracker (wf:Tracker)
 *
 * Implements the SolidOS tracker-pane shape convention: one JSON-LD file
 * per tracker with an embedded `issue: [...]` array of Vtodo objects
 * (no per-task URLs). This is convention #1 of six surveyed at
 * https://solid-shapes.github.io/docs/shapes/tasks — the same shape
 * mashlib's tracker-pane and pilot use.
 *
 * Renders one tracker as a kanban column with full read/write CRUD:
 * add / toggle / edit / delete / drag-drop tasks. Edits PUT back to
 * the resource via xlogin.authFetch.
 *
 * Drag/drop works across multiple instances of this pane on the same
 * page — the trackerBus is module-level, so a LOSOS app showing several
 * trackers (one per pane) gets between-column moves for free.
 *
 * Drop into any LOSOS app:
 *   <script type="module" data-pane src="https://solid-apps.github.io/pilot/tracker-pane.js"></script>
 *
 * Same Preact code as pilot's TasksView, packaged as a single LOSOS pane.
 *
 * AGPL-3.0 — part of pilot
 */

import { h, render as preactRender } from 'https://esm.sh/preact@10'
import { useState, useEffect, useCallback, useRef } from 'https://esm.sh/preact@10/hooks'
import htm from 'https://esm.sh/htm@3'

const html = htm.bind(h)

// --- pod fetch + write -----------------------------------------------------

const fetcher = () => (window.xlogin && window.xlogin.authFetch) || fetch

async function fetchJsonLd(url) {
  const r = await fetcher()(url, { headers: { Accept: 'application/ld+json' } })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

async function putJsonLd(url, body) {
  const r = await fetcher()(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/ld+json' },
    body: JSON.stringify(body, null, 2),
  })
  if (!r.ok) throw new Error(`PUT failed: ${r.status} ${r.statusText}`)
  return r
}

// --- one-tracker state with optimistic edits + debounced PUT ---------------

function useTracker(url, initialDoc) {
  const [state, setState] = useState({
    loading: !initialDoc && !!url,
    doc: initialDoc || null,
    error: null,
    status: '',
  })
  const saveTimer = useRef(null)

  useEffect(() => {
    if (initialDoc || !url) return
    let cancelled = false
    fetchJsonLd(url.replace(/#.*$/, ''))
      .then(doc => { if (!cancelled) setState(s => ({ ...s, loading: false, doc })) })
      .catch(err => { if (!cancelled) setState(s => ({ ...s, loading: false, error: err.message })) })
    return () => { cancelled = true }
  }, [url, initialDoc])

  const scheduleSave = useCallback((doc) => {
    if (!url) return
    setState(s => ({ ...s, status: 'saving' }))
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      putJsonLd(url.replace(/#.*$/, ''), doc)
        .then(() => setState(s => ({ ...s, status: 'saved' })))
        .catch(err => setState(s => ({ ...s, status: 'error', error: err.message })))
    }, 500)
  }, [url])

  const mutate = useCallback((fn) => {
    setState(s => {
      if (!s.doc) return s
      const next = fn(s.doc)
      scheduleSave(next)
      return { ...s, doc: next, status: 'saving' }
    })
  }, [scheduleSave])

  const issuesOf = (d) => Array.isArray(d.issue) ? d.issue : (d.issue ? [d.issue] : [])
  const setIssues = (d, xs) => ({ ...d, issue: xs })
  const nowIso = () => new Date().toISOString()
  const insertAt = (xs, issue, beforeId) => {
    const filtered = xs.filter(x => x['@id'] !== issue['@id'])
    if (!beforeId) return [...filtered, issue]
    const idx = filtered.findIndex(x => x['@id'] === beforeId)
    if (idx < 0) return [...filtered, issue]
    return [...filtered.slice(0, idx), issue, ...filtered.slice(idx)]
  }

  return {
    ...state,
    addIssue:    (summary)         => mutate(d => setIssues(d, [...issuesOf(d), {
      '@id': `#Iss${Date.now()}`,
      '@type': d.issue?.[0]?.['@type'] || 'Vtodo',
      summary, status: d.initialState || 'NEEDS-ACTION',
      created: nowIso(), modified: nowIso(),
    }])),
    toggleIssue: (id)              => mutate(d => setIssues(d, issuesOf(d).map(it => it['@id'] === id
      ? { ...it, status: it.status === 'COMPLETED' ? 'NEEDS-ACTION' : 'COMPLETED', modified: nowIso() } : it))),
    editIssue:   (id, summary)     => mutate(d => setIssues(d, issuesOf(d).map(it => it['@id'] === id
      ? { ...it, summary, modified: nowIso() } : it))),
    deleteIssue: (id)              => mutate(d => setIssues(d, issuesOf(d).filter(it => it['@id'] !== id))),
    addExisting: (issue, beforeId) => mutate(d => setIssues(d, insertAt(issuesOf(d), { ...issue, modified: nowIso() }, beforeId))),
    moveWithin:  (id, beforeId)    => mutate(d => {
      const xs = issuesOf(d)
      const it = xs.find(x => x['@id'] === id)
      if (!it) return d
      return setIssues(d, insertAt(xs, it, beforeId))
    }),
    getIssue:    (id)              => issuesOf(state.doc || {}).find(x => x['@id'] === id),
  }
}

// Module-level bus so a drop on tracker T can call mutators on tracker S
// without prop-drilling. Cross-pane on the same page works automatically.
const trackerBus = new Map()

// --- presentational components --------------------------------------------

function IssueRow({ issue, trackerUrl, onToggle, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select() } }, [editing])
  const done = issue.status === 'COMPLETED'
  const commit = () => { const v = inputRef.current.value.trim(); if (v && v !== issue.summary) onEdit(v); setEditing(false) }
  const onDragStart = (e) => {
    e.dataTransfer.setData('application/x-tracker-pane-issue', JSON.stringify({ trackerUrl, issueId: issue['@id'] }))
    e.dataTransfer.effectAllowed = 'move'
    setDragging(true)
  }
  return html`
    <div class=${'tp-issue ' + (done ? 'tp-done ' : '') + (dragging ? 'tp-dragging ' : '')}
         draggable=${!editing}
         data-issue-id=${issue['@id']}
         onDragStart=${onDragStart}
         onDragEnd=${() => setDragging(false)}>
      <div class=${'tp-check ' + (done ? 'tp-on' : '')} onClick=${onToggle}>${done ? '\u2713' : ''}</div>
      ${editing
        ? html`<div class="tp-summary tp-editing"><input ref=${inputRef} defaultValue=${issue.summary || ''} onBlur=${commit} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { e.preventDefault(); setEditing(false) } }} /></div>`
        : html`<div class="tp-summary" onClick=${() => setEditing(true)}>${issue.summary || '(untitled)'}</div>`}
      <div class="tp-del" title="Delete" onClick=${onDelete}>\u00d7</div>
    </div>`
}

function TrackerColumn({ url, initialDoc, hideCompleted }) {
  const t = useTracker(url, initialDoc)
  const [draft, setDraft] = useState('')
  const [dropOver, setDropOver] = useState(false)
  const submit = (e) => { e?.preventDefault?.(); const v = draft.trim(); if (!v) return; t.addIssue(v); setDraft('') }

  useEffect(() => {
    if (!url) return
    trackerBus.set(url, {
      addExisting: t.addExisting, deleteIssue: t.deleteIssue,
      moveWithin:  t.moveWithin,  getIssue:    t.getIssue,
    })
    return () => { trackerBus.delete(url) }
  }, [url, t.addExisting, t.deleteIssue, t.moveWithin, t.getIssue])

  const beforeIdFromEvent = (e) => {
    const row = e.target.closest?.('.tp-issue[data-issue-id]')
    return row ? row.getAttribute('data-issue-id') : null
  }
  const onDragOver = (e) => {
    if (!e.dataTransfer.types.includes('application/x-tracker-pane-issue')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropOver(true)
  }
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDropOver(false)
  }
  const onDrop = (e) => {
    e.preventDefault(); setDropOver(false)
    let payload
    try { payload = JSON.parse(e.dataTransfer.getData('application/x-tracker-pane-issue')) } catch { return }
    if (!payload?.issueId) return
    const beforeId = beforeIdFromEvent(e)
    if (payload.trackerUrl === url) {
      t.moveWithin(payload.issueId, beforeId)
    } else {
      const src = trackerBus.get(payload.trackerUrl)
      if (!src) return
      const issue = src.getIssue(payload.issueId)
      if (!issue) return
      t.addExisting(issue, beforeId); src.deleteIssue(payload.issueId)
    }
  }

  if (t.loading) return html`<div class="tp-col"><div class="tp-col-head"><div class="tp-col-title">Loading\u2026</div></div></div>`
  if (t.error && !t.doc) return html`<div class="tp-col"><div class="tp-col-head"><div class="tp-col-title">Error</div></div><div class="tp-err">${t.error}</div></div>`
  const doc = t.doc || {}
  const allIssues = Array.isArray(doc.issue) ? doc.issue : (doc.issue ? [doc.issue] : [])
  const open = allIssues.filter(i => i.status !== 'COMPLETED').length
  const visible = hideCompleted ? allIssues.filter(i => i.status !== 'COMPLETED') : allIssues
  return html`
    <div class=${'tp-col ' + (dropOver ? 'tp-drop-over' : '')}
         onDragOver=${onDragOver} onDragLeave=${onDragLeave} onDrop=${onDrop}>
      <div class="tp-col-head">
        <div class="tp-col-title">${doc.title || (url || '').split('/').pop()}</div>
        <div class="tp-col-count">${open}/${allIssues.length}</div>
        ${t.status && html`<div class=${'tp-col-status tp-' + t.status}>${t.status === 'saving' ? '\u2026 saving' : t.status === 'saved' ? '\u2713 saved' : '\u26a0 ' + (t.error || 'error')}</div>`}
      </div>
      <div class="tp-issues">
        ${visible.map(it => html`<${IssueRow} key=${it['@id']} issue=${it} trackerUrl=${url}
          onToggle=${() => t.toggleIssue(it['@id'])}
          onEdit=${(v) => t.editIssue(it['@id'], v)}
          onDelete=${() => t.deleteIssue(it['@id'])} />`)}
      </div>
      ${url && html`<form class="tp-add-row" onSubmit=${submit}>
        <input type="text" placeholder="+ add task\u2026" value=${draft} onInput=${(e) => setDraft(e.target.value)} />
      </form>`}
    </div>`
}

// --- styles (injected once per page, namespaced under .tp-) ----------------

function injectStyles() {
  if (document.getElementById('tracker-pane-css')) return
  const s = document.createElement('style')
  s.id = 'tracker-pane-css'
  s.textContent = `
.tp-col { background: #fff; border: 1px solid #e8e8ee; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; box-shadow: 0 1px 2px rgba(0,0,0,.03); min-height: 240px; font-family: 'Inter', -apple-system, sans-serif; color: #222; }
.tp-col-head { display: flex; align-items: baseline; gap: 10px; padding: 0 4px 12px; border-bottom: 1px solid #e8e8ee; margin-bottom: 12px; }
.tp-col-title { font: 700 16px/1 'Inter', sans-serif; }
.tp-col-count { font: 600 11px/1 'Inter', sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #888; }
.tp-col-status { margin-left: auto; font: 500 11px/1 'Inter', sans-serif; color: #888; }
.tp-col-status.tp-saving { color: #f59e0b; }
.tp-col-status.tp-saved  { color: #10b981; }
.tp-col-status.tp-error  { color: #ef4444; }
.tp-issues { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.tp-issue { display: flex; align-items: flex-start; gap: 10px; padding: 7px 6px; border-radius: 8px; transition: background .12s; cursor: grab; }
.tp-issue:hover { background: rgba(99,102,241,.04); }
.tp-issue:active { cursor: grabbing; }
.tp-issue.tp-dragging { opacity: 0.4; }
.tp-issue.tp-done .tp-summary { color: #888; text-decoration: line-through; }
.tp-check { width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid #c8c8d0; background: #fff; flex: 0 0 auto; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: transparent; margin-top: 2px; transition: all .12s; }
.tp-check:hover { border-color: #6366f1; }
.tp-check.tp-on { background: #10b981; border-color: #10b981; color: #fff; }
.tp-summary { flex: 1; min-width: 0; word-break: break-word; cursor: text; padding: 1px 4px; margin: -1px -4px; border-radius: 4px; font: 400 14px/1.4 'Inter', sans-serif; }
.tp-summary:hover { background: rgba(0,0,0,.03); }
.tp-summary.tp-editing { background: #fff; padding: 0; margin: 0; }
.tp-summary input { width: 100%; padding: 1px 4px; border: 1px solid #6366f1; border-radius: 4px; font: inherit; outline: none; box-shadow: 0 0 0 2px rgba(99,102,241,.18); }
.tp-del { opacity: 0; transition: opacity .12s, color .12s; cursor: pointer; padding: 0 4px; color: #888; font-size: 16px; line-height: 1; flex: 0 0 auto; }
.tp-issue:hover .tp-del { opacity: 1; }
.tp-del:hover { color: #ef4444; }
.tp-add-row { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e8e8ee; }
.tp-add-row input { width: 100%; padding: 8px 10px; border: 1px solid #e8e8ee; border-radius: 8px; font: 400 14px/1.4 'Inter', sans-serif; outline: none; background: #f5f5f9; }
.tp-add-row input:focus { border-color: #6366f1; background: #fff; box-shadow: 0 0 0 2px rgba(99,102,241,.18); }
.tp-col.tp-drop-over { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.16); }
.tp-err { background: #fee2e2; color: #991b1b; padding: 10px 14px; border-radius: 8px; font: 400 13px/1.4 'Inter', sans-serif; }
`
  document.head.appendChild(s)
}

// --- the LOSOS pane interface ----------------------------------------------

function typeOf(subject, store) {
  if (!store || !subject) return null
  const id = (subject && typeof subject === 'object') ? subject.value : subject
  const node = store.get?.(id)
  if (node === undefined && !store.type) return null
  return store.type ? store.type(node !== undefined ? node : id) : null
}

function isTrackerType(t) {
  if (!t) return false
  const arr = Array.isArray(t) ? t : [t]
  return arr.some(x => typeof x === 'string' && /(^|[#:/])Tracker$/i.test(x))
}

export const label = 'Tasks'
export const icon  = '\u2705'

export function canHandle(subject, store) {
  return isTrackerType(typeOf(subject, store))
}

export function render(subject, store, container, rawData) {
  injectStyles()
  // Resource URL for PUTs: take the data island src if present, else the
  // subject's value (if it has http(s) scheme), else null (read-only).
  const dataEl = document.querySelector('script[type="application/ld+json"]')
  const src = dataEl?.getAttribute('src')
  const subjectVal = subject?.value || ''
  const url = src
    ? new URL(src, window.location.href).href
    : (/^https?:\/\//.test(subjectVal) ? subjectVal.replace(/#.*$/, '') : null)
  preactRender(h(TrackerColumn, { url, initialDoc: rawData || null }), container)
}

export default { label, icon, canHandle, render }
