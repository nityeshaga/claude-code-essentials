# Frontend From First Principles: Why Hotwire Wins

Read this when choosing a frontend — especially when a task says "interactive," "real-time," "dashboard," "drag-and-drop," or "modern UI." Those words trigger the SPA reflex, and the reflex is usually wrong.

## The one question

> **Where does HTML get produced — and how many copies of UI state exist?**

**Server-side (Hotwire):** the server renders HTML from the DB and ships it. One renderer, one source of truth. JS is added as *behavior*, never as a second rendering engine.

**Client-side (SPA):** the server serializes state to JSON; a second program in the browser re-renders from it. Two renderers, two copies of state, joined by an API contract both sides must honor forever — and a *drift surface* where two copies of one fact silently disagree.

Everything an SPA forces you to maintain is synchronization labor, none of it your product: a serializer/API layer (server changes, client breaks silently), a payload schema (rename a field → `undefined`, no error), a client state store (a second DB in RAM), a client router, a second renderer, reconciliation logic (optimistic updates, temp-ids, race guards), duplicated auth, and a build toolchain. The Hotwire ledger for the same app: zero of these. The wire carries HTML, the DOM is the state, conventions (`dom_id`, `resources`, `params`) remove the chance to invent a wrong id, URL, or wire format.

The API contract is an *organizational* seam — it decouples hundreds of frontend engineers from backend teams. That's a Facebook problem, not yours. "Interactive = SPA" was true only before Turbo Drive killed full-page reloads.

## The escalation ladder

Reach for the lowest rung that does the job; most pages never leave rung 1.

- **Rung 1 — Turbo Drive (free):** links/forms fetched in background, `<body>` swapped. SPA-feel navigation, zero code.
- **Rung 2 — Turbo Frames (one tag):** `turbo_frame_tag` swaps just that region. `src:` lazy-loads it; `turbo_permanent` survives navigation.
- **Rung 3 — Turbo Streams:** rendered HTML + action + target `dom_id`, over HTTP *or* pushed from the model over WebSocket. → `05-turbo-frames-streams.md`
- **Rung 4 — Turbo 8 Morphing (default for live UIs):** model `broadcasts_refreshes`, page `turbo_stream_from`, layout morphs — diffs the DOM, touches only changed nodes, preserves menus/focus/scroll. Four declarations on one stream name = multiplayer. → `06-morphing-live-updates.md`
- **Plus Stimulus:** thin, domain-agnostic behavior configured by server-rendered `data-*`; the JS reads a URL off the element and POSTs to it. One generic controller serves every widget. → `07-stimulus-widgets.md`

## "But can it do X?" — answered

Every row is shipped 37signals production code. When a task asks for one, do NOT conclude "this needs React" — go to the file.

| "Surely this needs an SPA…" | Hotwire answer | Where |
|---|---|---|
| Live multiplayer | `broadcasts_refreshes` + `turbo_stream_from` + morph — 4 declarations | `06` |
| Optimistic UI | Client draws node immediately; server reply morphs; de-dupe is deleted, not written | `05`, `06` |
| Real-time chat | One partial over three paths (page, HTTP, WebSocket) | `05`, `11` |
| Drag-and-drop | Generic drag controller + drops as REST resources + derived order + morph | `06` |
| Keyboard-first / command palette | Config-driven navigable-list controller; `aria-selected` IS the cursor | `07` |
| Rich form widgets (combobox, autocomplete) | Widget clones a `<template>` into real hidden inputs; `params` parses natively | `07` |
| Autosave / drafts surviving refresh | Timer-as-dirty-flag; localStorage drafts cleared only on confirmed submit | `07` |
| Inline edit-in-place | Three files agree on one `dom_id(record, :edit)`; the `edit` action is empty | `04` |
| Lazy/parallel loading, skeletons | `src:` frames, one per region; ETag prefetch makes intent-eager free | `05` |
| Infinite scroll / pagination | Pagination scopes + frames/streams; no client state | `03`, `05` |
| Toasts, badges, counters | Derived projections (count DOM nodes) — never an incremented client counter | `06`, `07` |
| File uploads with previews | `has_one_attached` + blob partial + tiny preview controller | `05` |
| Native mobile apps | Hotwire Native wraps the same screens; RESTful paths become the nav contract | `14` |

The pattern: rich behavior is real, client code is thin and generic, the server owns all domain knowledge.

## When an SPA genuinely is right

Choose client-side rendering when the *core interaction* is:

- **A canvas, not a document** — Figma, Docs/Sheets, map/video editors: a continuously-redrawn surface with sub-keystroke feedback.
- **Offline-first as a hard requirement** — you genuinely need a client DB and sync engine.
- **Heavy client-side computation** — audio/video processing, in-browser ML, games.
- **A third-party embedded widget** running inside pages you don't control.

NOT on the list: dashboards, admin panels, CRUD, chat, kanban, feeds, e-commerce, SaaS, internal tools, marketplaces, booking — ~95% of what gets built. The test: "is the user editing a canvas, or looking at a document that changes?" Documents — even ones changing every second for four users — are Hotwire's home turf.

## The reflex to suppress

When round-trips "feel slow," the fix is caching and optimism (Turbo Drive swaps, parallel frames, optimistic morph, ETag 304s) — not a second program. When the client "needs state," almost all of it in CRUD is a cached copy of server state that will disagree; the genuine residue (menu open? unsaved draft?) is tiny and has precise tools in `06`/`07`.

---

**Bottom line:** the question is not "React or something worse." It is "one renderer or two." Pick one, and every rich interaction falls out of conventions (`04` views, `05` Turbo, `06` morphing, `07` widgets). Pick two only for the canvas-class apps above — knowingly, and say why.