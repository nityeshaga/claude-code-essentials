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

You are about to write Rails the way the best Rails developers alive write it — mined from two shipped 37signals products (**Campfire**, a real-time chat app, and **Fizzy**, a live multiplayer Kanban board) plus their written style law. The result of following this doctrine: whole production features in a handful of files, frontends that do everything an SPA does without a second codebase, and a bug-class graveyard — entire categories of error made *unwriteable* rather than avoided.

## The two sentences that govern everything

1. **The throughline:** *Rails stays small because each layer trusts a convention at its boundary.* The framework already knows what to name a DOM id, when a record is durable, how to find a row through an association, how to parse an array param. Let that knowledge live at the seam instead of re-deriving it by hand — most "architecture" is the refusal to do this.

2. **The yardstick:** *Count the edge cases this line absorbs for free.* That is how you judge every line — yours and others'. `belongs_to :room, touch: true` absorbs an entire stale-cache bug class in one token. A line that looks suspiciously short is usually a convention doing nine-tenths of the work; a long, careful, defensive block is usually a convention being re-implemented badly.

## The ten rules (the doctrine in brief)

Each rule is expanded with mechanics and code in the references — this is the index you reason from. The reference files cite principles by their **P-numbers** (P1–P9, defined in `references/01-doctrine.md`); each rule below carries its P-number so the two numberings can't mis-resolve — note they differ.

1. **The model owns the consequence** *(= P1)*. Effects of a fact becoming true (mark unread, sync the index) are model callbacks; effects of *how* it became true (broadcast an interactive send) are explicit methods at the call site. Ask: **whose fact is this?** If you're reaching for a `skip_x` flag, you put a call-path fact on the record.
2. **`_commit` means after-durable** *(the load-bearing mechanic of P1 + P9)*. Anything that reaches outside the database — a job, a push, a broadcast, an email — fires from `after_*_commit`, never plain `after_create`/`after_save`. The plain forms fire inside the transaction and produce **the ghost row**: fifty phones notified about a message a rollback erased.
3. **Derive, don't store** *(= P2)*. Any fact recomputable from data you have must not be stored — a stored copy is a second source of truth and **flags lie**. Read-state is one nullable timestamp; presence is a time-window scope; "spent" is a destroyed row; the cache key is `updated_at`; the badge is a count asked fresh.
4. **Security is the shape of your data access** *(= P3)*. Load every record *through* the current user (`Current.user.reachable_messages.find(...)`) so the unauthorized version is **the IDOR you cannot type**. Auth defaults closed, opened **opt-out-by-name** (`allow_unauthenticated_access`). Capability is granted **by subtraction** (a bot is a User minus one filter).
5. **Find the noun** *(= P6)*. Every custom verb you want to add to a controller (ban, reset, close, mute, search) is CRUD on a hidden noun (`Ban`, `JoinCode`, `Closure`, `Involvement`, `Search`). Name it, get a two-line resourceful controller, and the routes file stays flat. A model may have verbs; a controller may not.
6. **One renderer; the wire carries HTML, not data** *(= P5, glued by P4 convention-is-leverage)*. One partial paints every path — first load, HTTP reply, WebSocket push, refresh, search result. **dom_id is the address** every path computes (never types). No JSON contract, no client templates, no drift.
7. **Polymorphism over conditionals** *(= P7)*. Every `if kind == "x"` is a class you haven't named: STI subclass, enum family, controller subclass + `super`, partial-picked-by-name. The branch's bugs disappear with the branch.
8. **Give behavior a home** *(= P8)*. Traits live in concerns: **the include line IS the spec**, **`included do` is the wiring harness**, the constructor lives next to the trait. A 44-line `Message` with five concerns beats a 400-line junk drawer.
9. **Put work at its right altitude** *(= P9)*. Cheap-and-must-be-durable runs in-band (one bulk `update_all`); slow/flaky/fan-out crosses **the sync/async line** into a job that is **the thinnest thread boundary** — a two-line thunk delegating to a model verb, with the guard on the `_later` wrapper.
10. **JS is thin, generic, and configured by the server** *(the frontend face of P4 + P5)*. Stimulus controllers are domain-agnostic mechanisms; ERB `data-*` attributes are the configuration (**config over forks**); **the URL carries the contract** (the client POSTs to server-stamped URLs, never knowing what they mean); **the DOM attribute IS the state** (`aria-selected` is the cursor). The client invents no wire format — widgets materialize real form inputs and `params` parses them.

## Routing: which reference to read, when

Read **only** what the task needs. Each file opens with its own "read this when" line and TOC.

| Situation | Read |
|---|---|
| Choosing a frontend approach; tempted by React/Next/SPA; task says "interactive/real-time/modern UI" | `references/00-frontend-first-principles.md` |
| Starting any nontrivial work — get the worldview + principle interlocks + glossary | `references/01-doctrine.md` |
| Writing/changing models, migrations, callbacks, scopes, enums, STI, concerns | `references/02-models.md` |
| Adding routes/controllers/actions; an action wants a custom verb; params handling | `references/03-controllers-routing.md` |
| Writing views, partials, helpers; anything rendered in two places; edit-in-place | `references/04-views-helpers.md` |
| Page regions, lazy loading, live appends, WebSocket pushes, optimistic UI, uploads | `references/05-turbo-frames-streams.md` |
| Live multiplayer, morphing, drag-and-drop, "everyone's screen should update" | `references/06-morphing-live-updates.md` |
| Any JavaScript: widgets, comboboxes, keyboard nav, hotkeys, autosave, drafts, drag JS | `references/07-stimulus-widgets.md` |
| Background jobs, emails, push notifications, scheduled work, retries, multi-tenancy in jobs | `references/08-jobs-background-work.md` |
| Anything slow; fragment/HTTP caching; ETags; cache invalidation | `references/09-caching-performance.md` |
| Auth (login/sessions/passwordless), authorization, tokens, bans, security review | `references/10-auth-security.md` |
| Building a whole feature end-to-end — see five complete worked examples + the feature anatomy | `references/11-worked-features.md` |
| Starting a new app; structuring a codebase; stack choices; what NOT to build | `references/12-app-blueprint.md` |
| Reviewing code or a diff; auditing an existing codebase | `references/13-review-checklist.md` |
| Mobile apps — "we need an iOS/Android app", tempted by React Native/Flutter; path configuration, bridge components | `references/14-hotwire-native.md` |
| Exact API lookup mid-task — any `data-turbo-*` attribute, Turbo event, stream action, frame attribute, or Stimulus API (values/targets/outlets/actions/lifecycle) | `references/15-hotwire-api-cheatsheet.md` |
| Anything the doctrine files don't settle; the framework's own words | `hotwire-docs/` — the official handbooks, vendored verbatim (`turbo/`, `stimulus/`, `native-ios/`, `native-android/`, `native-overview/`; each folder has an `INDEX.md`) |

## The feature build loop

For any new feature, work in this order, asking this question at each step:

1. **Model** — *What is the noun, and whose facts are its consequences?* Write the model + migration. Consequences of existing → `_commit` callbacks; consequences of the call path → explicit methods. Facts derivable → scopes, not columns. (`02`)
2. **Routes** — *What noun is each verb hiding?* `resources`/`resource` only; singular for one-per-context; nested under the owner; `scope module:` to mirror folders. No `member do post :x`. (`03`)
3. **Controller** — *Can this be two lines?* Load through `Current.user` (the load IS the authorization), call one model verb, redirect or render. If it's longer, the model is missing a verb. (`03`, `10`)
4. **View** — *One partial, addressed by `dom_id`.* The same partial must serve every future path (list, live update, search hit). Helpers for any markup used twice. (`04`)
5. **Live layer** — *Pull or push?* Region updates → frames. Surgical append/replace → streams + `turbo_stream_from`. Multi-user liveness → `broadcasts_refreshes` + morph + `touch:` fan-out. (`05`, `06`)
6. **Polish** — *What's slow, and what does the browser need to keep?* Slow → jobs at the right altitude (`08`) and caching (`09`). Client behavior → thin configured Stimulus (`07`).

Before writing each layer, run the yardstick on what you just wrote: every guard, loop, and hand-typed string is a candidate for a convention that absorbs it.

## Review mode

Reviewing Rails code (a diff, a PR, a codebase): start with `references/13-review-checklist.md` — red-flag tables by layer, severity-ranked, each fix cross-referenced. The three highest-signal smells to scan for first: an unscoped `Model.find(params[:id])` near a permission check (security shape), a plain `after_create`/`after_save` touching the outside world (ghost row), and the same markup or id string existing in two places (drift).

## Anti-pattern quick table

You will be tempted by every row's left column — they are the agent defaults. Don't.

| You'll reach for | Instead | Rule |
|---|---|---|
| React/Next for "interactivity" | Hotwire — read `00` before deciding | 6, 10 |
| A service object (`MessageService`) | A model verb or a concern — find the noun/trait | 1, 8 |
| `after_create :notify` | `after_create_commit`, or an explicit method if call-path-dependent | 1, 2 |
| A `position` integer renumbered on reorder | Derive order from a timestamp/satellite row | 3 |
| A `used`/`online`/`setup_complete` boolean | Destroyed row / TTL window scope / `User.none?` | 3 |
| `Model.find(id)` + permission `if` | Load through `Current.user`'s associations | 4 |
| `member do post :ban end` | `resource :ban, only: %i[create destroy]` | 5 |
| JSON endpoint + client template for a widget | Server-rendered `<template>` cloned into real form inputs | 10 |
| `case record.type` / `if kind == "x"` | STI subclass, enum scope family, or partial-by-name | 7 |
| A tokens table with `expires_at` + sweeper | `signed_id(purpose:, expires_in:)` — the credential IS the URL | 3, 4 |
| Logic inside a job's `perform` | Two-line thunk → model verb; guard on the `_later` wrapper | 9 |
| Hand-typed DOM id strings / duplicated markup | `dom_id` + one partial | 6 |
| A `dirty` flag beside the work it describes | The pending timer IS the dirty flag; the DOM attribute IS the state | 3, 10 |
| `form.submit()` / `location.reload()` | `requestSubmit()` / morph refresh | 10 |

## Calibration

- **Comprehensiveness ≠ ceremony.** The doctrine produces *less* code, not more. If following it ever feels like adding ceremony, you've misread a pattern — recheck the owning reference.
- **Respect existing conventions.** This doctrine is the default for greenfield code and the lens for review — not a conversion mandate for codebases with history. If the team uses Tailwind, RSpec, Devise, Sidekiq, or has service objects, work *with* those; apply the principles where they naturally fit (you can still find the noun, derive instead of store, and load through the user inside any stack). Recommend the 37signals alternative when asked or when it clearly pays, never as a drive-by rewrite.
- **The exceptions are part of the doctrine.** Store a position when order is genuine user intent. Use plain `after_save` for work that must roll back with the transaction. Build an SPA for canvas-class apps (`00` §6). Each reference marks its own exceptions; apply them knowingly, and say why.
- **Provenance tags** like "(Campfire)" / "(Fizzy)" in the references mean the pattern is lifted from shipped 37signals production code. When both products are cited, it's house doctrine, not a one-off. "(Hotwire docs)" marks guidance from the official handbooks — vendored in full under `hotwire-docs/` for when you need the framework's exact words.
