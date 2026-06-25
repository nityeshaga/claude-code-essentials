# The Review Checklist

Read when reviewing a diff/PR or auditing a Rails codebase against the doctrine. Every row is a smell as you'd spot it in code; every fix points at the reference file that owns it.

The one yardstick: **count the edge cases a line absorbs for free** (rollback, second creation path, crashed laptop, copied-and-drifted string). Short lines should be short because a convention does the other nine-tenths; busy lines are usually re-implementing a convention by hand. → `01-doctrine.md` §1

---

## The 10-point pre-merge quick check

Highest-signal smells in scan order. Any hit: stop and read the owning reference.

1. **`Model.find(params[:id])` then a permission check** — authorization must be the *shape* of the query: `Current.user.<association>.find(...)`. → `10-auth-security.md`
2. **Plain `after_create`/`after_save`/`after_update` reaching outside the DB** (job, push, broadcast, email, index) — fires inside the transaction; a rollback leaves the ghost row. Must be `_commit` (after-durable). → `02-models.md`
3. **The same markup or DOM id string in two places** — drift is silent. One renderer; `dom_id` is the address. → `04-views-helpers.md`
4. **A new boolean that restates something derivable** (`used`, `online`, `read`, `unread_count`) — flags lie. Derive, don't store. → `02-models.md`
5. **A custom member route verb** (`post :ban`, `post :archive`, `LoginController#authenticate`) — every state change is CRUD on a hidden noun. → `03-controllers-routing.md`
6. **JSON on an internal wire** (`JSON.parse(request.body)`, serialized WebSocket payload, client template) — the wire carries HTML, not data. → `05-turbo-frames-streams.md`, `07-stimulus-widgets.md`
7. **`case`/`if` on a type/kind column** — the runtime already dispatches on class. → `02-models.md`
8. **A `position` integer renumbered on reorder** — order is derived from a sort axis, never stored. → `06-morphing-live-updates.md`
9. **Real logic or a guard inside a job's `perform`** — the job is a two-line thunk; the guard lives on the `_later` wrapper. → `08-jobs-background-work.md`
10. **`allow_unauthenticated_access` (or any skip) added in this diff** — a named hole in the secure-by-default wall; every one must be deliberate and reviewed by name. → `10-auth-security.md`

---

## Models

| Red flag (as seen in the diff) | Why it's wrong | The fix |
|---|---|---|
| `after_create`/`after_save` whose method touches a job, push, mail, broadcast, or index | Fires inside the transaction — rollback after the side effect is the ghost row | The `_commit` variant (after-durable) → `02-models.md` |
| A broadcast/notification wired as a callback when only the interactive path should fire it | A callback claims the consequence is true of *every* record; a seed/import would replay it | Callback for record-facts, explicit method at the call path for call-path facts → `02-models.md` |
| `used: boolean` / `consumed_at` on a credential or one-time code | A flag flipped at exactly the right instant; redeem-then-rollback burns a valid code | Consume means destroy — "spent" is the row's absence → `10-auth-security.md` |
| `online: boolean` / a presence sweeper cron | Sticks `true` when a laptop lid slams; the sweeper exists only to correct a lie | A `connected_at` timestamp + TTL range scope that self-heals → `02-models.md` |
| `status: "expired"` flipped by a scheduled job | Expiry is a fact about the clock; an unswept row is wrongly valid | Read-time range comparison; cleanup is housekeeping, never correctness → `10-auth-security.md` |
| A stored derived value: `unread_count`, `searchable_text`, a denormalized copy | A second source of truth; the first half-failed write disagrees silently | Derive fresh from the data that implies it → `02-models.md` |
| `position` integer + renumbering on move | Two `update_all`s that must agree; corruption on a half-failed drop | One derived `order(...)` scope; "pinned" is a row's existence (Fizzy) → `06-morphing-live-updates.md` |
| `if kind == "direct"` / `case` on a type column copied across model, view, pusher | The branch is a missing abstraction; the fourth kind misses a copy | STI subclass overriding only the seam; predicates are `is_a?` → `02-models.md` |
| Flipping a `type`/`kind` column by hand to convert a record | The new type's callbacks never fire | `becomes!(NewSubclass)` and save → `02-models.md` |
| Three booleans for mutually exclusive states | Eight typeable combinations for four real states | One ordered `enum` with `prefix:` — exhaustive and exclusive by construction → `02-models.md` |
| `def self.search` returning `.select { }` / `.to_a` | An array can't compose; auth and pagination can't chain | A `scope` returning a chainable Relation → `02-models.md` |
| A controller looping `collection.create!(...)` with hardcoded defaults | N inserts; the verbs get re-typed everywhere | Association-extension block (`grant_to`, `revoke_from`) with one `insert_all` → `02-models.md` |
| `creator_id: current_user.id` threaded through every call site | The one site that forgets it is the bug | `belongs_to :creator, default: -> { Current.user }` → `02-models.md` |
| A `FIELDS` constant or `attr_accessor` for a real column | A second list of the columns | Delete it — Active Record reads the schema → `02-models.md` |
| A 300-line model, or a `FooService` extracted to relieve one | Strands model truth outside the model | Concerns at `app/models/foo/<trait>.rb`; the include line IS the spec → `02-models.md` |
| Token minted in the model, verified in a far-away helper/controller | The matching `purpose:`/secret drifts | Co-locate mint and verify in one concern → `02-models.md`, `10-auth-security.md` |
| A `setup_complete` / `onboarded` flag | Survives the deletion of the thing it describes | State by row existence: `User.none?` → `02-models.md` |
| Multi-step change as bare sequential `update!`s; or deleting a row before snapshotting facts off it | Half-applied state on failure; the fact dies with its source | One `transaction do` where line order is the spec → `02-models.md`, `11-worked-features.md` |
| `body.scan(/@(\w+)/)` + `User.where(name:)` to find mentions | Breaks on duplicate names, can't survive a rename | Mentions are derived attachables: embed signed global id, extract with `attachables.grep(User)` → `02-models.md` |
| A new table for one transient fact (`pending_logins`, `read_receipts`) | A row with its own lifecycle, cleanup, and drift | Ask first whether an existing row, a nullable timestamp, or a signed cookie carries it → `02-models.md`, `10-auth-security.md` |
| `where("body LIKE ?", "%#{q}%")` for search on a `has_rich_text` model | Full-scans the wrong column (rich text lives elsewhere), never stems | An FTS index kept in sync by a concern with three `_commit` callbacks, exposing a chainable `scope :search` → `02-models.md`, `11-worked-features.md` |
| `where(muted: false)` remembered at every call site | The site that forgets it leaks | Compose enum-generated scopes with `.merge` — the disabled state is the absence of a merge → `02-models.md` |

---

## Controllers & Routes

| Red flag | Why it's wrong | The fix |
|---|---|---|
| `member do post :ban end` / any custom action verb in `routes.rb` | The controller becomes a junk drawer with a drifting `only:` guard | Verb-as-noun: `resource :ban, only: %i[create destroy]` → `03-controllers-routing.md` |
| One controller with `case params[:destination]` | The branch grows a `when` per meaning | One REST resource per meaning, each controller 3–7 lines (Fizzy) → `03-controllers-routing.md`, `06-morphing-live-updates.md` |
| An action orchestrating consequences after `create` | The second creation path (bot, import, seed) copy-pastes and drifts | Two-line controller; the fan-out hangs off the model's `_commit` callback → `03-controllers-routing.md`, `02-models.md` |
| The same state change in two controllers (dragged *and* clicked; UI *and* job) | Two copies of the guard and event tracking drift | One transactional model verb both paths call → `02-models.md` |
| `LoginController` with `authenticate`/`verify`/`logout` actions | "Log in" has a noun | The REST lifecycle of `resource :session`; redeeming is `create` → `10-auth-security.md` |
| Plural `resources :profile` for a one-per-context noun | A meaningless `index` and unused `:id` | Singular `resource` — six routes, no index → `03-controllers-routing.md` |
| `params.permit!` or raw `params` into `update!`/`create!` | The client quietly sets `admin: true` | Strong params as the allow-list → `03-controllers-routing.md` |
| `head :forbidden unless record.creator == Current.user` repeated per action | Copies drift; next week's action forgets it | One predicate (`can_administer?`) through one `before_action` → `10-auth-security.md` |
| A parallel `Api::FooController` re-implementing an existing action | The fork drifts the first time the human path grows | Subclass + `super`, overriding only the genuine seam → `03-controllers-routing.md` |
| `open_room` / `switch_room` / `jump_to` endpoints | The verb is secretly a read | All are `GET #show` of a different record → `03-controllers-routing.md` |
| Controllers renamed or URLs bent for a tidy folder tree | The URL pays for an organizational concern | `scope module:` — tree mirrors routes, URL unchanged → `03-controllers-routing.md` |
| `Room.find(...)` 500ing on a stale cookie, next to a separate access check | A deleted record is an exception, not navigation | Association-scoped `find_by` + `|| default`; `find_by!` when no friendly fallback → `03-controllers-routing.md` |

---

## Views

| Red flag | Why it's wrong | The fix |
|---|---|---|
| A hand-typed DOM id: `id="message_<%= message.id %>"` | The page and the broadcast drift with no error | `dom_id(record)` on every side of every wire → `04-views-helpers.md` |
| Row markup existing twice — page and broadcast/mailer template | Drifted by the next feature; the bug errors nowhere | One partial, every path → `04-views-helpers.md` |
| `<% @items.each do %><%= render "item" %><% end %>` | Forecloses `cached: true` (the only hook for batched `read_multi`) | `render partial:, collection:, cached: true` → `04-views-helpers.md` |
| Edit-in-place threading a computed `@target_id` through controller and templates | Id-drift in a routing costume | Three files agree on `dom_id(record, :edit)`; `def edit; end` stays empty → `04-views-helpers.md` |
| A `tag.div` + `dom_id` + data-attribute cluster inlined in two templates | The two-copies bug one altitude up | A helper (`messages_tag`) so the markup lives once → `04-views-helpers.md` |
| Template contortions to render a region in physical position | The line deciding content shouldn't be the line painting it | `content_for :region` + layout `yield` → `04-views-helpers.md` |
| A genuinely unshareable twin (a static optimistic template) left silently duplicated | Convention can't reach it, so a human must | Loud twin comments at the top of both files; mirror the `dom_id` shape → `04-views-helpers.md` |

---

## Turbo & Live Updates

| Red flag | Why it's wrong | The fix |
|---|---|---|
| A channel class + event names + `render_to_string` pushed down a socket | A hand-authored view/model contract that drifts; a second renderer | `turbo_stream_from` + `broadcast_append_to`; one renderer → `05-turbo-frames-streams.md` |
| JSON payload over the WebSocket + a client template | A schema kept in sync across two codebases | The wire carries HTML — broadcast the same server partial → `05-turbo-frames-streams.md` |
| `after_create_commit :broadcast` firing the live append for every record | A seed/import replays history onto screens; whose fact is this? | Broadcast is an explicit method at the interactive call path → `05-turbo-frames-streams.md`, `02-models.md` |
| An optimistic-UI reconciliation pass (temp id swapped for db id, race-guarded) | All bookkeeping to undo a server-invented identity | Override `to_key` to return the client-chosen id; the de-dupe is deleted → `05-turbo-frames-streams.md` |
| `turbo_stream.replace` (destructive) answering a user's own gesture | Rips out the node mid-transition, discards focus | `method: :morph` — reconciliation, not replacement → `06-morphing-live-updates.md` |
| A broadcast verb per model per change kind, plus loops re-broadcasting dependents | A hand-authored fan-out matrix | `broadcasts_refreshes` + `touch: true`; with morph + `turbo_stream_from`, multiplayer is emergent → `06-morphing-live-updates.md` |
| `window.onfocus = () => location.reload()` for wake catch-up | Throws away the page to learn what changed | A turbo_stream diff by `dom_id` through the one partial → `05-turbo-frames-streams.md` |
| Morphing pages with lazy `src` frames and no self-heal | Morph overwrites loaded content with the empty placeholder | The frame cancels the morph and reloads itself (`morphReload`) → `06-morphing-live-updates.md` |
| Live refresh slamming menus shut / collapsing panels | `open`/`class` is browser-only state the server can't know | A `turbo:before-morph-attribute` veto for that attribute → `06-morphing-live-updates.md` |
| A scroll-aware second renderer for one update kind | Two renderers drifting in a behavior costume | Stamp intent as data on the wire; transport stays generic → `05-turbo-frames-streams.md` |
| Optimistic drag/insert placing the node by the client's own position guess | The guess disagrees with server ordering — visible flicker | The server stamps the deciding bit as a data attribute; the client reads exactly that (Fizzy) → `06-morphing-live-updates.md` |

---

## Stimulus & Frontend

| Red flag | Why it's wrong | The fix |
|---|---|---|
| The diff adds React/Next/an SPA layer or a client-side router | The default the doctrine exists to displace | Server-rendered HTML + Turbo + Stimulus; read `00-frontend-first-principles.md` first |
| `this.selected = index` + a hand-painted `.highlighted` class | Two copies of selection; the screen reader reads neither | The DOM attribute IS the state: `aria-selected` → `07-stimulus-widgets.md` |
| A Stimulus controller per list variant | Four forks of one mechanism, each drifting | One generic controller varied by `data-*` in the ERB → `07-stimulus-widgets.md` |
| A hotkey handler calling a domain method directly | Bakes the domain into the keyboard layer | Read the action URL off the focused element (`data-*-url` in ERB) → `07-stimulus-widgets.md` |
| `form.submit()` called from JS | Skips native validation, bypasses Turbo — full reload | `requestSubmit()` always → `07-stimulus-widgets.md` |
| JS constructing `<input>` names or a bespoke JSON shape for a widget | The client owns a wire format Rails already has; CSRF bypass | A server-rendered `<template>` authors the field name once; `name` vs `name[]` IS scalar-vs-array → `07-stimulus-widgets.md` |
| One Stimulus controller importing or invoking another | A dependency only a refactor can change | Declare the pipeline as `data-action` chains, or an outlet → `07-stimulus-widgets.md` |
| A `dirty` flag maintained next to a debounce timer | Flag and work drift when a save races a keystroke | The timer IS the dirty flag; flush in `disconnect()` → `07-stimulus-widgets.md` |
| Call sites hand-writing the full `data-controller` list onto `form_with` | The second feature clobbers the first | Additive decorator helpers merging contributions → `07-stimulus-widgets.md` |
| A special-case `if` inside a JS controller to exempt one element | The exemption hides where view-builders can't see it | Stamp `data-*-disabled: true` in markup; the controller reads the flag → `07-stimulus-widgets.md` |
| Cursor logic re-selecting item zero after a live morph | Yanks the user to the top, or strands focus | Remember the index, await the morph in a bounded `Promise.race`, re-derive from fresh DOM → `07-stimulus-widgets.md` |
| Client drafts cleared on submit *attempt*, or keyed globally | A failed save eats the draft; two resources collide | Key per resource, clear only on confirmed success, re-derive after morph → `06-morphing-live-updates.md`, `07-stimulus-widgets.md` |
| A buttonless background submit built as a waiting controller + manual cleanup | Bookkeeping for a lifecycle Turbo already emits | A self-submitting, self-erasing form via `requestSubmit()` in `connect()` (Fizzy) → `07-stimulus-widgets.md` |

---

## Jobs

| Red flag | Why it's wrong | The fix |
|---|---|---|
| Real logic inside `perform` | Strands the work behind a queue — testing means draining it | A 2–3 line thunk delegating to a model/PORO method → `08-jobs-background-work.md` |
| `perform_later(record.id)` + `Model.find` + a hand-rolled "what if deleted" branch | Re-implements GlobalID, per job | Pass the record; `discard_on ActiveJob::DeserializationError` once → `08-jobs-background-work.md` |
| `return unless condition` as the job's first line | A worker occupied to discover nothing to do; copied into every job | The guard lives on the `_later` wrapper before the enqueue → `08-jobs-background-work.md` |
| Job enqueued from plain `after_create` | A rolled-back row is still picked up — the ghost row at the queue | Enqueue from `after_create_commit` → `08-jobs-background-work.md` |
| The whole fan-out in-band: a per-member push loop inside the request | One flaky provider drags the response to a crawl | Split at the sync/async line: cheap-and-durable in-band, slow-and-flaky into a job → `08-jobs-background-work.md` |
| A per-row `update` loop for the cheap half | An N+1 hiding inside a callback | One bulk `update_all` over composed scopes → `08-jobs-background-work.md`, `02-models.md` |
| Live AR objects handed into a raw thread pool | Lazy queries outside the Rails executor — pool exhaustion | Work lives in `lib/`; do AR reads before posting, hand the pool plain data → `08-jobs-background-work.md` |

---

## Caching

| Red flag | Why it's wrong | The fix |
|---|---|---|
| A hand-assembled cache key: `"message-#{id}-v3"` | You become the version-control system; a second source of truth about "changed?" | `cache record do` — the key derives from `updated_at` → `09-caching-performance.md` |
| `after_create { parent.update(updated_at:) }` to bust a parent fragment | Skips destroy — deleting a child leaves it on screen | `belongs_to :parent, touch: true`; nested `cache` gives Russian-doll expiry → `09-caching-performance.md` |
| Caching per item inside a hand-written loop | N store round-trips, no batched key computation | `render ... collection:, cached: true` — one `read_multi` → `09-caching-performance.md` |
| `Rails.cache.fetch` around an expensive action's output | Still runs the action and re-ships bytes; caches on your server, not the browser | Gate the body behind `if stale?(etag: record)` so a hit is a bare 304 → `09-caching-performance.md` |
| A changed resource at an unchanged URL with long cache headers | New image, people still see the old one | Change content, change URL: stamp `v: record.updated_at` into the route → `09-caching-performance.md` |

Audit question for this layer: **is any freshness fact stored rather than derived?** A bumped version, a touched parent, a "is this fresh?" field — same bug, different altitude.

---

## Security & Auth

| Red flag | Why it's wrong | The fix |
|---|---|---|
| `Model.find(params[:id])` followed by a permission check | The new controller copies the find and forgets the guard; the leak errors nowhere | `Current.user.<association>.find(...)` — the IDOR you cannot type → `10-auth-security.md` |
| A global query (search, export, feed) "filtered by permission" after the fact | Where a results leak hides — the day a caller copies only the first half | Compose auth onto the left: `Current.user.reachable_messages.search(q)` → `10-auth-security.md` |
| `before_action :require_login` sprinkled per controller | The forgotten action fails open | Secure-by-default in the base class's `included do`; public pages must ask via `allow_unauthenticated_access` → `10-auth-security.md` |
| Creator/admin check re-typed in each mutating action | Copies drift | One predicate (`can_administer?`) behind one `before_action` → `10-auth-security.md` |
| A parallel permission system for a bot/API client | Two permission sets drift | Capability by subtraction: a `User` with a role, denied by default; `allow_bot_access` removes one denial → `10-auth-security.md` |
| `rescue => false` in a network/SSRF guard | Uncertainty resolved toward open — precisely the hole | Fail closed: an unparseable address is treated as private → `10-auth-security.md` |
| Login/reset form answering differently for known vs unknown emails (even by timing) | A free user directory | The unknown path constructs the same unsaved object and runs identical code — byte-identical by shared code (Fizzy) → `10-auth-security.md` |
| A `tokens` table with `expires_at`, one-time destroy, and a sweeper cron | Three subsystems for what one signed string does | `signed_id(purpose:)` / `find_signed!(purpose:)` — zero rows → `10-auth-security.md` |
| A `pending_logins`/session row for "mid-login" | A row with its own lifecycle for one transient fact | A signed, `httponly`, self-expiring cookie matching the code's clock → `10-auth-security.md` |
| A magic link/code redeemable from any browser | A code mailed to one inbox redeemed from another | Bind credential to browser: one `secure_compare` at redeem → `10-auth-security.md` |
| `status: "banned"` on the user row as the whole enforcement | Dies with the account — re-register, back in thirty seconds | Persist the ban as a fact about the machine (an IP row) + an ambient `before_action` gate → `10-auth-security.md` |
| A blocked request answered with a candid `403 Forbidden` | Tells the attacker they're specifically targeted | Reply indistinguishably (a 429 reading as rate-limiting); guard mutating verbs only → `10-auth-security.md` |
| Mutating endpoints with CSRF disabled wholesale for an API caller | Removes the defense for humans too | Conditional CSRF keyed on the authenticated caller kind → `10-auth-security.md` |

---

## Severity ranking

When time is short, triage in this order. Severity tracks *failure direction and silence*, not ugliness.

| Rank | Class | Members | Why first |
|---|---|---|---|
| 1 | **Security-shape violations** | Unscoped `find` + guard; post-hoc permission filtering; `params.permit!`; fail-open guards; enumeration oracles; per-controller auth sprinkle; CSRF skips | Fail open and silent; the broken pattern invites copying |
| 2 | **Ghost-row class** | Plain `after_*` reaching outside the DB; jobs enqueued pre-commit; index writes in the transaction | Irreversible side effects about rows that may not exist; one `_commit` suffix deletes the class |
| 3 | **Second-source-of-truth state** | Flags, stored counters, `position` integers, stored derived text, hand-typed DOM ids, duplicated renderers, hand-maintained cache keys | Drift bugs: nothing errors, the copies just disagree one day |
| 4 | **Structure smells** | Custom route verbs, `case` on type columns, fat controllers, service objects, forked controllers/JS variants, guards inside `perform` | Junk-drawer growth; each invites the next and drifts toward rank 1–3 |
| 5 | **Performance shape** | Per-row loops where `update_all` serves, missing `collection: cached:`, in-band fan-out, `Rails.cache.fetch` where a 304 serves | Real cost, but fails loud (slow); fix after correctness |

A diff that *adds* a rank 1–2 instance should not merge. Ranks 3–4 are strong push-back; rank 5 is a note unless on a hot path.

---

## Review workflow

1. **Read the models first.** `ls app/models` — the nouns are the domain. Read each touched model's `include` line (it IS the spec) before any method body. Then apply the ghost-row test to every callback: does it reach outside the DB, and does it say `_commit`? Then: whose fact is this? (→ `02-models.md`)
2. **Read the routes diff for verbs that should be nouns.** Every `member do`, `post :verb`, or controller named after an action is a hidden noun. Check cardinality: a `resources` whose `:id` is never used wants singular `resource` (→ `03-controllers-routing.md`).
3. **Grep the enumerable attack surface.** List the named holes: `allow_unauthenticated_access`, `allow_bot_access`, `skip_before_action`, `skip_forgery_protection`, `permit!` — each addition must justify itself. Then the leak shapes: bare `\.find(params`, `ModelName.find(` outside a user-scoped chain (→ `10-auth-security.md`).
4. **Grep the drift shapes.** `id="` with interpolation, `render_to_string`, `JSON.parse(request.body)`, `form.submit()`, `after_create `/`after_save ` (trailing space excludes `_commit`), `update(updated_at`, `boolean.*default`, `position` in migrations, `case .*type`.
5. **For every suspicious line, count the edge cases it FAILS to absorb.** Enumerate what the conventional move eats for free: the rollback, the destroy path skipped, the second creation path, the crashed client, the half-failed write, the copied line missing its guard. If the line handles none and the doctrine move handles all in fewer characters, name the edge case, name the move, cross-ref the owner.
6. **Check composition last.** The deepest wins are interlocks: `touch:` + `broadcasts_refreshes` + `turbo_stream_from` + `method: :morph` = multiplayer for free; Relation scopes + auth-by-association + chainable `search` = leak-proof search in one line. When a diff hand-implements one, the finding is the missing composition (→ `01-doctrine.md`, `11-worked-features.md`).

A clean review: the diff added nouns not verbs; callbacks say `_commit` and pass the whose-fact test; no fact is stored twice; every id and key is derived; every wire carries HTML; the new attack surface is empty or named; short lines got short by trusting a convention.