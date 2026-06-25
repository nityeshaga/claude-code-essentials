# Frontend From First Principles: Why Hotwire Wins

Read this when choosing a frontend — especially when a task says "interactive," "real-time," "dashboard," "drag-and-drop," or "modern UI." Those words trigger the SPA reflex, and the reflex is usually wrong.

## 1. The one question

> **Where does HTML get produced — and how many copies of your UI state exist?**

**Server-side:** the server renders HTML from the database and ships it. One renderer, one source of truth.

**Client-side (SPA):** the server serializes state to JSON; a second program in the browser — its own templates, store, router — re-renders from it. Two renderers, two copies of state, joined by an API contract both sides must honor forever.

Hydration, state libraries, GraphQL, React Server Components — all machinery to manage the consequences of the second answer. (RSC is React's own migration back to the server.) Hotwire keeps one renderer, ships HTML over the wire, and adds JS only as *behavior*, never as a second rendering engine. Proven across HEY, Basecamp, Campfire, Fizzy.

## 2. What an SPA costs you, day one

Every row is synchronization labor between two programs — and a *drift surface* where two copies of one fact can silently disagree. None of it is your product.

| Subsystem | You must maintain | The drift bug |
|---|---|---|
| API layer | Serializers, endpoints, versioning | Server changes, client breaks silently |
| Payload contract | A schema both sides honor | Rename a field → `undefined`, no error |
| Client state store | Redux/Zustand — a second DB in RAM | "Refresh fixes it" bugs |
| Client router | Routes duplicated from server | Two routing tables to sync |
| Second renderer | Components re-implementing every view | Page and live version drift |
| Reconciliation | Optimistic updates, temp-ids, race guards | Duplicate-message/flicker bugs |
| Auth duplication | Token/refresh, client-side route guards | Security logic in two places |
| Build toolchain | Bundler, transpiler, dep churn | App rots when toolchain moves |

The Hotwire ledger for the same app: zero of these. The wire carries HTML, the DOM is the state, Turbo Drive is the router, the same partial renders every path, the framework handles reconciliation (morph, `dom_id`).

**Why the SPA default exists:** the API contract is an *organizational* seam — it decouples hundreds of frontend engineers from backend teams. That's a Facebook problem, not yours. "Interactive = SPA" was true only before Turbo Drive killed full-page reloads.

## 3. Hotwire: the escalation ladder

Reach for the lowest rung that does the job; most pages never leave rung 1.

- **Rung 1 — Turbo Drive (free):** links/forms fetched in background, `<body>` swapped. SPA-feel navigation, zero code.
- **Rung 2 — Turbo Frames (one tag):** `turbo_frame_tag` swaps just that region. `src:` lazy-loads it; `turbo_permanent` survives navigation. The frame IS the client.
- **Rung 3 — Turbo Streams:** rendered HTML + action + target `dom_id`, delivered over HTTP *or* pushed from the model over WebSocket. Real-time chat in a few declarative lines. → `05-turbo-frames-streams.md`
- **Rung 4 — Turbo 8 Morphing (default for live UIs):** model `broadcasts_refreshes`, page `turbo_stream_from`, layout morphs — diffs the DOM, touches only changed nodes, preserves menus/focus/scroll. Reconciliation, not replacement. Four declarations on one stream name = multiplayer. → `06-morphing-live-updates.md`
- **Plus Stimulus:** thin, domain-agnostic behavior configured by server-rendered `data-*`. The JS reads a URL off the element and POSTs to it — the URL carries the contract; one generic controller serves every widget. → `07-stimulus-widgets.md`

## 4. "But can it do X?" — answered

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

## 5. When an SPA genuinely is right

Choose client-side rendering when the *core interaction* is:

- **A canvas, not a document** — Figma, Docs/Sheets, map/video editors: a continuously-redrawn surface with sub-keystroke feedback.
- **Offline-first as a hard requirement** — you genuinely need a client DB and sync engine.
- **Heavy client-side computation** — audio/video processing, in-browser ML, games.
- **A third-party embedded widget** running inside pages you don't control.

NOT on the list: dashboards, admin panels, CRUD, chat, kanban, feeds, e-commerce, SaaS, internal tools, marketplaces, booking. That's ~95% of what gets built. The test: "is the user editing a canvas, or looking at a document that changes?" Documents — even ones changing every second for four users — are Hotwire's home turf.

## 6. The agent-specific argument

Your error rate lives in decisions. Every API shape, state-management choice, component boundary, and reconciliation strategy is a place to be subtly wrong — and client/server drift bugs don't throw, don't show in diff review, and surface as "sometimes the badge is wrong."

Rails-with-Hotwire collapses that decision surface: `dom_id` means you never invent an element id, `resources` never a URL, `params` never a wire format. Convention answers the question before you can answer it wrong. One renderer makes drift *unrepresentable*. Fewer files per feature means more fits in context. When you build the SPA version you generate thousands of lines of synchronization machinery — the exact category where you're weakest. Choose the battlefield where you're strong: models, queries, templates, conventions.

## 7. Objections

- **"HTML over the wire is wasteful vs JSON."** The byte difference is noise; the JSON buys a serializer, contract, client template, and second renderer to sync forever. You spend bytes to delete subsystems.
- **"Round-trips feel slow."** Turbo Drive fetch-and-swaps, frames load in parallel, optimistic UI + morph give instant feedback with server truth behind it, ETags make repeats 304s. HEY and Basecamp feel fast to millions. The fix is caching and optimism, not a second program.
- **"The client needs state."** Almost all "client state" in CRUD is a cached copy of server state — a second source of truth that will disagree. The genuine residue (menu open? unsaved draft?) is tiny, and Hotwire has precise tools for it (`06`, `07`).

For mobile: Hotwire Native ships the same server-rendered screens in native shells. Your RESTful routes ARE the native navigation contract; native behavior is assigned remotely via JSON path configuration, so a broken native screen reverts to its web page by deleting one property — instant rollback, capped downside. Full mechanics in `14-hotwire-native.md`.

---

**Bottom line:** the question is not "React or something worse." It is "one renderer or two." Pick one, and every rich interaction falls out of conventions (`04` views, `05` Turbo, `06` morphing, `07` widgets). Pick two only for the canvas-class apps in §5 — knowingly, and say why.