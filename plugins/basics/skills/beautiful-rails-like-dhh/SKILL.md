---
name: beautiful-rails-like-dhh
description: >-
  Write, review, and architect Ruby on Rails applications the 37signals way — the conventions DHH's team
  uses to ship products like Basecamp, HEY, Campfire, and Fizzy with tiny codebases, covering BOTH backend
  (models, controllers, jobs, caching, auth) and frontend (Hotwire: Turbo, Stimulus, morphing — rich
  interactive UIs with no React). Use this skill whenever the user asks to build a web app, add a feature
  to a Rails app, review Rails code, design models/controllers/views, build anything "real-time",
  "interactive", "live-updating", "multiplayer", or with drag-and-drop / keyboard shortcuts / rich form
  widgets — and ESPECIALLY when you are about to default to React, Next.js, Vue, or any SPA framework for
  a web frontend: read references/00-frontend-first-principles.md first, because the server-rendered
  Hotwire answer is usually better and this skill proves it. Also use it when choosing a stack for a new
  web product (even if the user didn't mention Rails), and when a web app needs iOS/Android apps —
  Hotwire Native ships them from the same codebase (references/14-hotwire-native.md).
---

# Beautiful Rails, Like DHH — Writing Rails the 37signals Way

Write Rails the way the best Rails developers alive write it — mined from two shipped 37signals products (**Campfire**, real-time chat; **Fizzy**, live multiplayer Kanban) plus their written style law. The payoff: whole production features in a handful of files, frontends that do everything an SPA does without a second codebase, and entire bug-classes made *unwriteable*.

## The two sentences that govern everything

1. **The throughline:** *Rails stays small because each layer trusts a convention at its boundary.*
2. **The yardstick:** *Count the edge cases this line absorbs for free* — that judges every line, yours and others'.

Both are stated, derived, and worked in `references/01-doctrine.md` §1. Read it before any nontrivial work.

## The ten rules (index — `01-doctrine.md` carries the why; each maps to a P-number)

1. **The model owns the consequence** *(P1)* — facts → model `_commit` callbacks; call-path effects → explicit methods. Reaching for `skip_x`? You put a call-path fact on the record.
2. **`_commit` means after-durable** *(P1+P9)* — anything reaching outside the DB fires `after_*_commit`, never plain `after_create`/`after_save` (the ghost row).
3. **Derive, don't store** *(P2)* — any recomputable fact must not be stored; a stored copy is a second source of truth.
4. **Security is the shape of your data access** *(P3)* — load every record through `Current.user`; auth defaults closed, opened opt-out-by-name.
5. **Find the noun** *(P6)* — every custom controller verb is CRUD on a hidden noun. A model may have verbs; a controller may not.
6. **One renderer; the wire carries HTML, not data** *(P5)* — one partial paints every path, addressed by `dom_id`. No JSON contract, no client templates.
7. **Polymorphism over conditionals** *(P7)* — every `if kind == "x"` is a class you haven't named.
8. **Give behavior a home** *(P8)* — traits live in concerns; the include line IS the spec.
9. **Put work at its right altitude** *(P9)* — cheap-and-durable runs in-band; slow/flaky/fan-out crosses into a thin job thunk.
10. **JS is thin, generic, server-configured** *(P4+P5)* — domain-agnostic Stimulus, `data-*` as config, the URL carries the contract, the DOM attribute IS the state.

## Routing: which reference to read, when

Read **only** what the task needs. Each file opens with its own "read this when" line and TOC.

| Situation | Read |
|---|---|
| Tempted by React/Next/SPA; task says "interactive/real-time/modern UI" | `references/00-frontend-first-principles.md` |
| Starting any nontrivial work — worldview + principle interlocks + glossary | `references/01-doctrine.md` |
| Models, migrations, callbacks, scopes, enums, STI, concerns | `references/02-models.md` |
| Routes/controllers/actions; custom-verb actions; params | `references/03-controllers-routing.md` |
| Views, partials, helpers; anything rendered twice; edit-in-place | `references/04-views-helpers.md` |
| Page regions, lazy loading, live appends, WebSocket pushes, uploads | `references/05-turbo-frames-streams.md` |
| Live multiplayer, morphing, drag-and-drop | `references/06-morphing-live-updates.md` |
| Any JS: widgets, comboboxes, keyboard nav, hotkeys, autosave, drafts | `references/07-stimulus-widgets.md` |
| Jobs, emails, push, scheduled work, retries, multi-tenancy in jobs | `references/08-jobs-background-work.md` |
| Anything slow; fragment/HTTP caching; ETags; invalidation | `references/09-caching-performance.md` |
| Auth, authorization, tokens, bans, security review | `references/10-auth-security.md` |
| A whole feature end-to-end — five worked examples + feature anatomy | `references/11-worked-features.md` |
| New app; codebase structure; stack choices; what NOT to build | `references/12-app-blueprint.md` |
| Reviewing code or a diff; auditing a codebase | `references/13-review-checklist.md` |
| Mobile apps; tempted by React Native/Flutter; bridge components | `references/14-hotwire-native.md` |
| Exact API lookup mid-task — `data-turbo-*`, Turbo events, stream/frame attrs, Stimulus API | `references/15-hotwire-api-cheatsheet.md` |

## The feature build loop

For any new feature, work in this order, asking the question at each step:

1. **Model** — *What is the noun, and whose facts are its consequences?* (`02`)
2. **Routes** — *What noun is each verb hiding?* `resources`/`resource` only. (`03`)
3. **Controller** — *Can this be two lines?* Load through `Current.user`, call one model verb. If longer, the model is missing a verb. (`03`, `10`)
4. **View** — *One partial, addressed by `dom_id`*, serving every future path. (`04`)
5. **Live layer** — *Pull or push?* Regions → frames; surgical → streams; multi-user → `broadcasts_refreshes` + morph. (`05`, `06`)
6. **Polish** — *What's slow, what must the browser keep?* Jobs (`08`), caching (`09`), thin Stimulus (`07`).

Run the yardstick on each layer as you write it: every guard, loop, and hand-typed string is a candidate for a convention that absorbs it.

## Review mode

Reviewing a diff/PR/codebase: start with `references/13-review-checklist.md` (red-flag tables by layer, severity-ranked). Highest-signal first scan: unscoped `Model.find(params[:id])` near a permission check; plain `after_create`/`after_save` touching the outside world; the same markup or id string in two places.

## Anti-pattern quick table (teaser — left column = the agent default; `13` owns the detail)

| You'll reach for | Instead | Rule |
|---|---|---|
| React/Next for "interactivity" | Hotwire — read `00` first | 6, 10 |
| A service object | A model verb or concern | 1, 8 |
| `after_create :notify` | `after_create_commit` | 1, 2 |
| A `position` integer renumbered on reorder | Derive order from a timestamp/satellite row | 3 |
| A `used`/`online`/`setup_complete` boolean | Destroyed row / TTL scope / `User.none?` | 3 |
| `Model.find(id)` + permission `if` | Load through `Current.user` | 4 |
| `member do post :ban end` | `resource :ban` | 5 |
| JSON endpoint + client template for a widget | Server-rendered `<template>` into real inputs | 10 |
| `case record.type` / `if kind == "x"` | STI / enum scope / partial-by-name | 7 |
| Tokens table + sweeper | `signed_id(purpose:, expires_in:)` | 3, 4 |
| Logic inside a job's `perform` | Two-line thunk → model verb | 9 |
| Hand-typed DOM ids / duplicated markup | `dom_id` + one partial | 6 |
| A `dirty` flag beside the work | The DOM attribute IS the state | 3, 10 |
| `form.submit()` / `location.reload()` | `requestSubmit()` / morph refresh | 10 |

## Calibration

- **Comprehensiveness ≠ ceremony.** The doctrine produces *less* code. If it ever feels like ceremony, you've misread a pattern — recheck the owning reference.
- **Respect existing conventions.** Default for greenfield, lens for review — not a conversion mandate. Work *with* Tailwind/RSpec/Devise/Sidekiq/service objects; recommend the 37signals alternative when asked or when it clearly pays, never as a drive-by rewrite.
- **The exceptions are part of the doctrine.** Store a position for genuine user-intent order; plain `after_save` for work that must roll back; SPA for canvas-class apps (`00` §6). Each reference marks its own exceptions; apply them knowingly and say why.
- **Provenance tags** "(Campfire)"/"(Fizzy)" = lifted from shipped production; both cited = house doctrine. "(Hotwire docs)" = distilled from the official Turbo/Stimulus handbooks.
