# Frontend From First Principles: Server-Side vs Client-Side, and Why Hotwire Wins

Read this when you are about to choose a frontend approach — for a new app, a new feature, or any moment you feel the pull toward React/Next.js/Vue/an SPA. Especially read it if the task says "interactive," "real-time," "dashboard," "drag-and-drop," or "modern UI" — those words trigger the SPA reflex, and the reflex is usually wrong.

## Contents

1. The question underneath every frontend decision
2. The accounting: what a client-rendered frontend actually costs
3. Why the SPA default exists (and why it doesn't apply to you)
4. What Hotwire actually is — the escalation ladder
5. "But can it do X?" — the rich-UX checklist, answered
6. When an SPA genuinely is the right call
7. The agent-specific argument: decision surface
8. How to talk about this choice (objections and answers)

---

## 1. The question underneath every frontend decision

Strip away framework names and there is exactly one architectural question:

> **Where does HTML get produced — and how many representations of your UI state exist?**

**Server-side answer:** the server renders HTML from the database, ships it, and the browser displays it. There is **one renderer** (your templates) and **one source of truth** (your database). The browser holds almost no state worth synchronizing.

**Client-side answer (SPA):** the server serializes state into JSON, ships it over an API, and a second program running in the browser — with its own templates, its own state store, its own routing — renders HTML from it. Now there are **two renderers** and **two copies of state**, connected by a contract (the API schema) that both sides must honor forever.

Everything else — hydration, state management libraries, GraphQL, React Server Components, tRPC — is machinery invented to manage the consequences of the second answer. The complexity isn't incidental; it is the *structural cost of having two programs that must agree about what the user is looking at*. React Server Components are the React world's own admission of this: a decade-long migration back toward rendering on the server.

The 37signals position, proven across HEY, Basecamp, Campfire, and Fizzy: **keep one renderer, ship HTML over the wire, and add small amounts of JavaScript as *behavior*, never as a second rendering engine.** That's Hotwire. It is not a lesser frontend. It is the removal of an entire category of synchronization work.

## 2. The accounting: what a client-rendered frontend actually costs

When you pick an SPA, you sign up for ALL of these, on day one, regardless of app size:

| Subsystem | What you must build/maintain | The drift bug it creates |
|---|---|---|
| API layer | Serializers, endpoints, versioning | Server model changes, client breaks silently |
| Payload contract | A schema both codebases honor | Rename a field on one side → `undefined` on the other, no error |
| Client state store | Redux/Zustand/context — a second database in RAM | Store disagrees with server; "refresh fixes it" bugs |
| Client router | Routes duplicated from the server | Two routing tables to keep in sync |
| Second renderer | Components re-implementing every view | Page version and live version drift apart |
| Reconciliation | Optimistic updates, temp-id swaps, race guards | The classic duplicate-message/flicker bug class |
| Auth duplication | Token handling, refresh flows, guarding routes client-side | Security logic in two places, one of them forgeable |
| Build toolchain | Bundler, transpiler, dependency churn | The app rots when the toolchain moves |

Count the rows. None of them are your product. Every one is **synchronization labor between two programs you chose to have**, and every one is a *drift surface* — a place where two copies of the same fact can silently disagree. The whole doctrine of this skill ("derive, don't store"; "one renderer"; "a stored copy is a second source of truth") says: the way to win that war is to never start it.

The Hotwire ledger for the same app: zero API layer (the wire carries HTML, not data), zero client store (the DOM the server rendered IS the state), zero client router (Turbo Drive intercepts real navigation), zero second renderer (the same partial renders every path), and reconciliation handled by the framework (morph, `dom_id`). The bytes-on-the-wire cost is real and small; the subsystems deleted are large and permanent.

## 3. Why the SPA default exists (and why it doesn't apply to you)

Be honest about why the ecosystem defaults to React: (a) Facebook-scale orgs needed to decouple hundreds of frontend engineers from backend teams — the API contract is an *organizational* seam, not a technical necessity; (b) training data and tutorials skew overwhelmingly toward it; (c) "interactive = SPA" became a reflex when server-rendered meant full-page reloads — **which has not been true since Turbo Drive**.

None of these reasons apply to a small team — or to an agent — building a product. You don't have two teams needing an org-chart seam. You don't need the reflex; you need the result. And the result — instant navigation, partial updates, live multiplayer, optimistic UI — is fully achievable server-side. The proof is not theoretical: HEY (email client), Basecamp, Campfire (real-time chat), and Fizzy (live multiplayer Kanban with drag-and-drop and keyboard control) all ship this way.

## 4. What Hotwire actually is — the escalation ladder

Hotwire is four mechanisms, used in escalating order. Reach for the lowest rung that does the job; most pages never leave rung 1.

**Rung 1 — Turbo Drive (free).** Every link and form is intercepted, fetched in the background, and the `<body>` swapped — SPA-feel navigation with zero code. You write a boring `GET /rooms/5`; the user experiences an instant transition. This alone removes the #1 historical argument for SPAs.

**Rung 2 — Turbo Frames (one tag).** Wrap a region in `turbo_frame_tag`; any response containing a frame with the same id swaps only that region. With `src:` a frame lazy-loads itself (skeleton-fast first paint, regions filling in parallel); with `turbo_permanent` it survives navigation (a sidebar that loads once). A board that renders one empty frame per column, each filling itself over a plain `GET`, is lazy loading + parallel fetching with no client code — the frame IS the client.

**Rung 3 — Turbo Streams (push and pull).** A stream is rendered HTML + an action (`append`/`replace`/`remove`) + a target `dom_id`, delivered either as an HTTP response or pushed over WebSocket from the model (`broadcast_append_to` / `turbo_stream_from`). Same partial, both transports. This is real-time chat in a handful of declarative lines. Mechanics: `05-turbo-frames-streams.md`.

**Rung 4 — Turbo 8 Morphing (the modern default for live UIs).** The model declares `broadcasts_refreshes`; the page subscribes with `turbo_stream_from @board`; the layout declares `turbo_refreshes_with method: :morph, scroll: :preserve`. The wire carries the literal word *refresh*; every subscribed browser re-renders and **morphs** — diffs the DOM and touches only changed nodes, preserving open menus, focused inputs, scroll position, in-flight animations. **Morph is reconciliation, not replacement.** Four declarations agreeing on a stream name = multiplayer, with no channel classes, no events, no client store. Mechanics: `06-morphing-live-updates.md`.

**Plus Stimulus, used correctly:** JavaScript as thin, *domain-agnostic* behavior configured by `data-*` attributes the server renders. The JS never knows what "postpone" means — it reads a URL off the element and POSTs to it (**the URL carries the contract**). One generic controller serves every list/menu/widget, varied by data values declared in ERB (**config over forks**). Mechanics: `07-stimulus-widgets.md`.

## 5. "But can it do X?" — the rich-UX checklist, answered

Every entry below is shipped, production 37signals code — not a claim. When the task asks for one of these, do NOT conclude "this needs React." Go to the referenced file.

| "Surely this needs an SPA…" | The Hotwire answer | Where |
|---|---|---|
| Live multi-user updates (multiplayer) | `broadcasts_refreshes` + `turbo_stream_from` + morph — 4 declarations | `06` |
| Optimistic UI (instant feedback before the server answers) | Client draws/moves the node immediately; server reply morphs or replaces-by-shared-id; when the guess was right the confirmation is a no-op. The de-dupe is *deleted, not written* (`to_key` handshake / morph) | `05`, `06` |
| Real-time chat | One partial over three paths (page, HTTP reply, WebSocket); `turbo_stream_from` is the whole subscription | `05`, `11` |
| Drag-and-drop | Generic drag controller + drops as REST resources + derived order (no position column) + morph reconciliation | `06` |
| Keyboard-first UI / command palette feel | One config-driven navigable-list controller; `aria-selected` IS the cursor (accessibility by construction); hotkeys POST to URLs stamped on elements | `07` |
| Rich form widgets (multi-select combobox, autocomplete) | Widget clones a server-rendered `<template>` into real `<input name="x[]">` hidden fields — `params` parses it natively; no wire format invented | `07` |
| Autosave, local drafts that survive refresh | Timer-as-dirty-flag controller; localStorage drafts cleared only on confirmed submit, restored after morph | `07` |
| Inline edit-in-place | Three files agree on one `dom_id(record, :edit)` frame; the controller's `edit` action is literally empty | `04` |
| Lazy/parallel loading, skeleton screens | `src:` frames, one per region; eager-on-intent prefetch by flipping `loading` + a `fresh_when` ETag making it free | `05` |
| Infinite scroll / pagination | Pagination scopes + frames/streams; no client state | `03`, `05` |
| Toasts, badges, counters | Derived projections (count the DOM nodes, derive from one column) — never an incremented client counter | `06`, `07` |
| File uploads with previews | `has_one_attached` + the polymorphic blob partial + a tiny optimistic preview controller | `05` |
| Native mobile apps later | Hotwire Native wraps the same server-rendered screens; your RESTful paths become the native navigation contract | §8 |

The pattern in every row: **the rich behavior is real, the client code is thin and generic, and the server owns all domain knowledge.** What you never build: the API, the store, the second renderer, the reconciliation layer.

## 6. When an SPA genuinely is the right call

Intellectual honesty makes the doctrine credible. Choose client-side rendering when the *core interaction* is one of these:

- **A canvas, not a document.** Figma, Google Docs/Sheets, map editors, video editors — apps where the artifact being manipulated is a continuously-redrawn surface with sub-keystroke feedback loops and complex local geometry. The DOM-as-server-rendered-document model is the wrong substrate.
- **Offline-first as a requirement** (not a nice-to-have): field tools that must work without connectivity and sync later. You genuinely need a client-side database and sync engine.
- **Heavy client-side computation over local data** — audio/video processing, in-browser ML, games.
- **A third-party embedded widget** that must run inside pages you don't control.

Note what's NOT on this list: dashboards, admin panels, CRUD apps, chat, kanban boards, social feeds, e-commerce, SaaS products of essentially every kind, internal tools, marketplaces, booking systems. That's ~95% of what gets built — and of what agents get asked to build. If the app is *forms, lists, and live views of shared data*, the server-rendered answer is strictly better. When in doubt, ask: "is the user editing a canvas, or looking at a document that changes?" Documents — even ones that change every second for four simultaneous users — are Hotwire's home turf.

## 7. The agent-specific argument: decision surface

This section is about *you*, the agent. Your error rate lives in decisions: every API shape you invent, every state-management choice, every component boundary, every reconciliation strategy is a place you can be subtly wrong — and client/server drift bugs are exactly the kind that don't throw, don't show in a diff review, and surface as "sometimes the badge is wrong."

Rails-with-Hotwire is the stack that **collapses decision surface**:

- `dom_id` means you never invent an element id. `resources` means you never invent a URL shape. `params` means you never invent a wire format. Convention answers the question before you can answer it wrong.
- One renderer means a whole class of your most common failure (two representations drifting) is *unrepresentable*.
- Fewer files per feature means more of the app fits in your context window, and review passes see the whole change.
- The yardstick — **count the edge cases this line absorbs for free** — is also a token-and-error budget: every convention you lean on is logic you didn't generate and can't have generated wrong.

When you build the SPA version, you are generating thousands of lines of synchronization machinery — the exact code category where you are weakest, because it's invisible-state-dependent and feedback comes late. When you build the Hotwire version, the framework already wrote that machinery, tested across two decades of production apps. Choose the battlefield where you're strong: models, queries, templates, and conventions.

## 8. How to talk about this choice (objections and answers)

**"HTML over the wire is wasteful vs a JSON payload."** The byte difference on a chat message or a board column is noise; what the JSON buys you is a serializer, a contract, a client template, and a second renderer to keep in sync forever. You spend bytes to delete subsystems. This is the trade DHH made on purpose.

**"Server round-trips will feel slow."** Turbo Drive makes navigation fetch-and-swap; frames load regions in parallel; optimistic UI + morph give instant feedback with server truth reconciled behind it; ETags make repeat requests 304s. HEY and Basecamp feel fast to millions of users. Latency engineering is real, but it's caching and optimism — not a reason to maintain a second program.

**"The client needs state."** Almost all "client state" in a CRUD app is a cached copy of server state — and a cached copy is **a stored copy, i.e. a second source of truth** that will disagree with the first. The genuinely-client-side residue (is this menu open? is there an unsaved draft?) is tiny, and Hotwire has precise tools for exactly that residue: morph-attribute vetoes, localStorage drafts, timer-as-dirty-flag (`06`, `07`).

**"Everyone hires for / writes React."** For a human org, maybe relevant. For an agent, the training-data skew is an argument to *load this skill*, not to follow the crowd into the high-drift architecture.

**"What about mobile?"** Hotwire Native ships the same server-rendered screens inside native shells, with native chrome where it matters — one codebase, app-store presence. 37signals ships HEY and Basecamp mobile this way. The mechanics reward the discipline this file already demands — every piece of the native story leans on the URL contract (Hotwire docs):

- **Your routes ARE the native navigation contract.** Native behavior is assigned by a JSON *path configuration*: `rules` regex-match URL paths (path + query string by default) and apply `properties` — `context` (`modal` vs `default`), `presentation`, `pull_to_refresh_enabled`, `animated`. Rules apply sequentially — a first `".*"` rule sets the default, later rules override. The canonical rule: `"/new$"` presents as a modal with pull-to-refresh disabled, so the gesture can't clear a half-entered form or fight the dismiss swipe. That one rule turns *every* form screen in the app into a native modal — and it works only because resourceful routing puts every form at a `/new` path. RESTful route discipline (`03`) is literally what makes the native app configurable.
- **Navigation stays server-driven, even in native.** Native clients append `Hotwire Native iOS/Android…` plus their registered bridge-component list to the user agent, powering turbo-rails' `hotwire_native_app?` for controller/view branches. After a form submitted from a native modal, the Rails controller dismisses it with the historical-location helpers — `recede_or_redirect_to` (pop the visible screen/modal), `refresh_or_redirect_to` (pop, reload, invalidate cache), `resume_or_redirect_to` (just dismiss) — which the iOS/Android frameworks honor automatically. Closing a native modal after create is a one-line controller change, not Swift.
- **Native chrome via bridge components — web-side code you write in the Rails app.** A `BridgeComponent` is a Stimulus `Controller` subclass (`@hotwired/hotwire-native-bridge`) with a `static component` name matching a registered native counterpart; it talks via `this.send(event, data, callback)` and reads `data-bridge-*` attributes (`data-bridge-title`, with `aria-label`/`textContent` fallback). House them in a `bridge/` subdirectory of your Stimulus controllers; per-platform opt-out via `data-controller-optout-ios/android`. Hide the web fallback with scoped CSS — `[data-bridge-components~="form"] [data-controller~="bridge--form"] { display: none }` — so the web element disappears *only* when the running native app actually supports that component; web users keep it. This is the conceptual ground under `07`'s `bridge--form` submit-button helper.
- **Going native is a per-screen ladder with a server-side undo.** Web screen by default → bridge component for native chrome → fully native Swift/Kotlin only for maximum fidelity — the same shape as §4's ladder. You will be tempted to push native view controllers manually — don't; even fully native screens keep a corresponding URL and route through the path configuration. Because the config lives remotely on your server, a broken native screen reverts to its web page by deleting one `view_controller`/`uri` property from JSON — instant rollback, no app-store review. Capped downside, native upside.
- **Keep every app screen on one domain.** Off-domain URLs are *external*: they fall out of the native stack into an in-app browser (`SFSafariViewController` / Custom Tabs). And the web's navigation semantics carry over — navigating to the current path replaces instead of pushes, the previous path pops, and `data-turbo-action="replace"` on links and forms is honored natively.

---

**The bottom line:** the frontend question is not "React or something worse." It is "one renderer or two." Pick one renderer, and the rest of this skill shows how every rich interaction you'd defect to an SPA for falls out of conventions — `04` for views, `05` for Turbo, `06` for morphing/multiplayer, `07` for widgets. Pick two renderers only for the canvas-class apps in §6, knowingly, and say why.
