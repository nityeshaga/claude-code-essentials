# The Review Checklist

Read this when you are reviewing a diff, a PR, or auditing an existing Rails codebase against the doctrine — every row is a pattern as you'd spot it in code, and every fix points at the reference file that owns it.

**Contents**

1. [The 10-point pre-merge quick check](#the-10-point-pre-merge-quick-check)
2. [Models](#models)
3. [Controllers & Routes](#controllers--routes)
4. [Views](#views)
5. [Turbo & Live Updates](#turbo--live-updates)
6. [Stimulus & Frontend](#stimulus--frontend)
7. [Jobs](#jobs)
8. [Caching](#caching)
9. [Security & Auth](#security--auth)
10. [Severity ranking](#severity-ranking)
11. [Review workflow](#review-workflow)

The one yardstick behind every row: **count the edge cases this line absorbs for free.** A suspicious line is rarely wrong because it's ugly — it's wrong because of the production edge cases it *fails* to absorb (the rollback, the second creation path, the crashed laptop, the copied-and-drifted string). When a line looks short, ask what convention is doing the other nine-tenths; when a line looks busy, ask which convention it's re-implementing by hand. Rails stays small because each layer trusts a convention at its boundary — most red flags below are a hand-built replacement for a boundary Rails already provides.

---

## The 10-point pre-merge quick check

The highest-signal smells, in scan order. Any hit means stop and read the owning reference.

1. **`Model.find(params[:id])` followed by a permission check** — the find and the guard are two lines that will be copied apart. Authorization must be the *shape* of the query: `Current.user.<association>.find(...)` — the IDOR you cannot type. → `10-auth-security.md`
2. **Plain `after_create` / `after_save` / `after_update` reaching outside the database** (a job, a push, a broadcast, an email, an index write). Fires *inside* the transaction; a rollback leaves you having notified phones about a row that no longer exists — the ghost row. Must be `_commit`: **_commit means after-durable.** → `02-models.md`
3. **The same markup or DOM id string existing in two places** (a hand-typed `"message_#{id}"`, a second copy of row HTML for the broadcast path). Drift is silent — nothing errors, things just stop updating. One renderer; `dom_id` is the address. → `04-views-helpers.md`
4. **A new boolean column that restates something derivable** — `used`, `online`, `read`, `dirty`, `setup_complete`, an `unread_count` integer. Flags lie; a stored copy is a second source of truth. Derive, don't store. → `02-models.md`
5. **A custom member route verb** — `member do post :ban end`, `post :archive`, a `LoginController#authenticate`. Every state change is CRUD on a hidden noun: find the noun. → `03-controllers-routing.md`
6. **JSON anywhere on an internal wire** — `JSON.parse(request.body)` for a widget, a serialized payload down a WebSocket, a client-side template. The wire carries HTML, not data; widgets materialize real form inputs. → `05-turbo-frames-streams.md`, `07-stimulus-widgets.md`
7. **`case`/`if` on a type/kind column** — `if kind == "direct"`, `case room.type`. The branch was a missing abstraction; the runtime already dispatches on class. → `02-models.md`
8. **A `position` integer renumbered on reorder** — two `update_all`s that must agree, corruption on a half-failed drop. Order is derived from a sort axis, never stored. → `06-morphing-live-updates.md`
9. **Real logic inside a job's `perform`, or a guard inside it** (`return unless ...` as the first line). The job is the thinnest thread boundary — a two-line thunk delegating to a model method; the guard lives on the `_later` wrapper. → `08-jobs-background-work.md`
10. **`allow_unauthenticated_access` (or equivalent skip) added in this diff** — every one is a named hole in the secure-by-default wall. Not automatically wrong, but every addition must be deliberate and reviewed by name. → `10-auth-security.md`

---

## Models

| Red flag (as seen in the diff) | Why it's wrong | The fix |
|---|---|---|
| `after_create :notify_x` / `after_save :broadcast_y` where the method touches a job, push, mail, broadcast, or index | Fires inside the transaction — a rollback after the side effect is the ghost row | Use the `_commit` variant; _commit means after-durable → `02-models.md` |
| A broadcast/notification wired as a callback when only the interactive path should fire it (a seed or import would replay it) | Whose fact is this? A callback claims the consequence is true of *every* record; a broadcast is true only of *how this one was made* | Callback for record-facts, explicit method at the call path for call-path facts; the model owns the consequence either way → `02-models.md` |
| `used: boolean` / `consumed_at` on a credential or one-time code | A flag you must flip at exactly the right instant; flags lie, and a redeem-then-rollback burns a valid code | Consume means destroy — "spent" is the row's absence; double-redeem becomes structurally impossible → `10-auth-security.md` |
| `online: boolean` / `is_connected` / a presence sweeper cron | The flag sticks at `true` when a laptop lid slams; the sweeper exists only to correct a value that lies | Presence is a question about time: a `connected_at` timestamp + a TTL range scope (`where(connected_at: TTL.ago..)`) that self-heals → `02-models.md` |
| `status: "expired"` flipped by a scheduled job | Expiry is a fact about the clock, not a state to write; an unswept row is wrongly valid | Read-time range comparison (`where(expires_at: Time.current...)`); cleanup is disk housekeeping, never correctness → `10-auth-security.md` |
| A stored derived value: `unread_count`, `searchable_text`, a denormalized copy of another row's field | A stored copy is a second source of truth; the first half-failed write makes it disagree silently | Derive, don't store — compute fresh from the data that implies it (`memberships.unread.count`, derive text at index-write time) → `02-models.md` |
| `position` integer + renumbering on move | Two `update_all`s that must agree; corruption on a half-failed drop; eventually a drift-sweeping cron | No position column: one derived `order(...)` scope on the real sort axis; "pinned" is the existence of a row, not an integer (Fizzy) → `06-morphing-live-updates.md` |
| `if kind == "direct"` / `case` on a type column, copied across model, view, pusher | The branch was a missing abstraction; the fourth kind misses a copy | STI subclass overriding only the seam; the normal kind is an *empty* subclass; predicates are `is_a?`, never string compares → `02-models.md` |
| Flipping a `type`/`kind` column by hand to convert a record | The new type's callbacks never fire; downstream consequences need manual bookkeeping | `becomes!(NewSubclass)` and save — the new subclass's callbacks ride along → `02-models.md` |
| Three booleans for mutually exclusive states (`muted`, `mentions_only`, …) | Eight typeable combinations for four real states, half impossible-but-storable | One ordered `enum` with `prefix:` — exhaustive and exclusive by construction, predicates/setters/scopes generated → `02-models.md` |
| `def self.search` (or any query method) returning `.select { }` / `.to_a` | An array can't compose; auth and pagination can't chain onto it; filtering moves into Ruby memory | `scope` returning a chainable Relation — `Current.user.reachable_messages.search(q).last(100)` composes only because every link is a Relation → `02-models.md` |
| A controller looping `collection.create!(...)` with hardcoded defaults | N inserts; the default is wrong for the subtype that needed a different one; the verbs get re-typed everywhere | Association-extension block: teach the collection its own grammar (`grant_to`, `revoke_from`) with one `insert_all` and the owner's default → `02-models.md` |
| `creator_id: current_user.id` threaded through every call site | The one call site that forgets it is the bug | `belongs_to :creator, default: -> { Current.user }` — the model owns the default → `02-models.md` |
| A `FIELDS` constant or `attr_accessor` for a real column | A second list of the columns; the migration is the only list | Delete it — Active Record reads the schema → `02-models.md` |
| A 300-line model, or a `FooService` extracted to relieve one | The capability list becomes unreadable; the service strands model truth outside the model | Concerns at `app/models/foo/<trait>.rb`; the include line IS the spec; `included do` is the wiring harness → `02-models.md` |
| Token minted in the model, verified in a helper/controller far away | The matching `purpose:`/secret drifts the day one side changes | Co-locate mint and verify a few lines apart in one concern → `02-models.md`, `10-auth-security.md` |
| A `setup_complete` / `onboarded` flag | The flag survives the deletion of the thing it describes | State by row existence: `User.none?` asks the truth directly → `02-models.md` |
| Multi-step state change as bare sequential `update!`s; or deleting a row before snapshotting facts off it | Half-applied state on failure; the fact dies with its source | One `transaction do` where line *order* is the spec — snapshot durable state before you delete its source → `02-models.md`, `11-worked-features.md` |
| `body.scan(/@(\w+)/)` + `User.where(name:)` to find mentions | Breaks on duplicate names, can't survive a rename, can't render an avatar | Mentions are derived attachables: embed the signed global id in rich text, extract with `attachables.grep(User)` → `02-models.md` |
| A new table for one transient fact (a `pending_logins` table, a `read_receipts` table) | A row with its own lifecycle, cleanup job, and drift; the join row or a cookie already carries it | Ask first whether an existing row (the membership join), a nullable timestamp, or a signed cookie carries the fact → `02-models.md`, `10-auth-security.md` |
| `where("body LIKE ?", "%#{q}%")` for search — especially on a `has_rich_text` model | Full-scans the wrong column (rich text lives in `action_text_rich_texts`), never stems, matches nothing forever | A real FTS index kept in sync by a self-contained concern with three symmetric `_commit` callbacks (create/update/destroy — no fourth state to forget), exposing a chainable `scope :search`; derive the indexed text at write time, never store a `searchable_text` column → `02-models.md`, `11-worked-features.md` |
| `where(muted: false)` (or any exclusion filter) remembered at every call site | The call site that forgets it leaks; code that doesn't exist can't have a bug | Compose the enum-generated scopes with `.merge` so they read like English — the disabled state is the *absence* of a merge, never a filter to remember → `02-models.md` |

---

## Controllers & Routes

| Red flag | Why it's wrong | The fix |
|---|---|---|
| `member do post :ban end` / `post :archive, on: :member` / any custom action verb in `routes.rb` | The controller becomes a junk drawer with a drifting `only:` guard array; every verb wants a route, a helper, and its own guard | Verb-as-noun: banning is creating a Ban — `resource :ban, only: %i[create destroy]`; introduce a resource rather than a custom action → `03-controllers-routing.md` |
| One controller with `case params[:destination]` (a drop, a move, a multi-meaning gesture) | The branch grows a `when` per meaning; the routing table should own the case | One REST resource per meaning, each controller 3–7 lines calling one model verb; the URL carries the contract (Fizzy) → `03-controllers-routing.md`, `06-morphing-live-updates.md` |
| An action that orchestrates consequences after `create` ("mark unread, then push, then broadcast") | The second creation path (bot, import, seed) copy-pastes and drifts; the model owns the consequence | Two-line controller: translate HTTP into one model method call, redirect; the fan-out hangs off the model's `_commit` callback → `03-controllers-routing.md`, `02-models.md` |
| The same state change implemented in two controllers (dragged *and* clicked; UI *and* scheduled job) | Two copies of the guard and the event tracking drift | One intention-revealing transactional model verb both paths call → `02-models.md` |
| `LoginController` with `authenticate` / `verify` / `logout` actions | "Log in" has a noun | The REST lifecycle of `resource :session` (and `resource :magic_link` under it); redeeming is `create` → `10-auth-security.md` |
| Plural `resources :profile` for a one-per-context noun (with an id never used) | The router has a word for cardinality; a meaningless `index` and an unused `:id` appear | Singular `resource` — six routes, no index → `03-controllers-routing.md` |
| `params.permit!` or `params` passed raw into `update!`/`create!` | The client quietly sets `admin: true` | Strong params as the allow-list: `params.require(:x).permit(...)` — the allow-list is the whole defense → `03-controllers-routing.md` |
| `head :forbidden unless record.creator == Current.user` repeated per action | Copies drift; next week's action forgets it | One predicate (`can_administer?`) wired through one `before_action` over every write → `10-auth-security.md` |
| A parallel `Api::FooController` re-implementing an existing action for a second caller | The fork drifts the first time the human path grows a feature | Subclass + `super`, overriding only the genuine seam (e.g. `message_params`); the bot path IS the human path → `03-controllers-routing.md` |
| `open_room` / `switch_room` / `jump_to` endpoints | The verb is secretly a read | All of them are `GET #show` of a different record — a read, not a verb → `03-controllers-routing.md` |
| Controllers renamed or URLs bent to get a tidy folder tree | The URL pays for an organizational concern | `scope module:` — folder tree mirrors routes.rb, URL unchanged → `03-controllers-routing.md` |
| `Room.find(...)` 500ing on a stale cookie, next to a separate access check | The check is separable from the find; a deleted record is an exception, not navigation | Association-scoped `find_by` + `|| default` — authorization and graceful fallback are the same expression; `find_by!` (hard 404) when there is no friendly fallback → `03-controllers-routing.md` |

---

## Views

| Red flag | Why it's wrong | The fix |
|---|---|---|
| A hand-typed DOM id: `id="message_<%= message.id %>"`, `"room_#{id}_messages"` | The day the page spells it one way and the broadcast another, they drift with no error | `dom_id(record)` / `dom_id(record, :prefix)` on every side of every wire — dom_id is the address → `04-views-helpers.md` |
| Row markup existing twice — once in the page, once in a broadcast/stream template or mailer | "The same" the day written; drifted by the next feature; the bug errors nowhere | One partial, every path — page load, HTTP reply, socket, refresh, search results all render the same `_row` → `04-views-helpers.md` |
| `<% @items.each do |item| %><%= render "item", item: item %><% end %>` | Hand-writes what `collection:` does, and forecloses `cached: true` (the only hook for batched `read_multi`) | `render partial: "items/item", collection: @items, cached: true` → `04-views-helpers.md` |
| Edit-in-place threading a computed `@target_id` through controller and templates | Id-drift wearing a routing costume | Three files agree on `dom_id(record, :edit)` (row frame, edit link target, edit response frame); `def edit; end` stays empty → `04-views-helpers.md` |
| A `tag.div` + `dom_id` + data-attribute cluster inlined in two templates | The two-copies bug one altitude up | A helper (`messages_tag`) so the markup lives once and ERB reads in domain words → `04-views-helpers.md` |
| Template contortions to render a region in physical position | The line that decides the content shouldn't be the line that paints it | `content_for :region` + layout `yield` → `04-views-helpers.md` |
| A genuinely unshareable twin (a static optimistic client template) left silently duplicated | Convention can't reach it, so a human must — silence guarantees rot | Loud twin comments at the top of *both* files naming each other; mirror the `dom_id` shape exactly → `04-views-helpers.md` |

---

## Turbo & Live Updates

| Red flag | Why it's wrong | The fix |
|---|---|---|
| A channel class + event names + `render_to_string` pushed down a socket | A hand-authored contract between view and model that drifts; a second renderer | `turbo_stream_from` on the page + `broadcast_append_to` on the model — both derive the stream name and target from the same conventions; one renderer → `05-turbo-frames-streams.md` |
| JSON payload over the WebSocket + a client-side template | Buys a serializer, a client rendering engine, and a schema kept in sync across two codebases | The wire carries HTML, not data — broadcast the same server partial the page renders → `05-turbo-frames-streams.md` |
| `after_create_commit :broadcast` firing the live append for every record | A seed or import replays history onto screens; create/update/destroy need different verbs one callback can't express; whose fact is this? | Broadcast is an explicit method called at the interactive call path → `05-turbo-frames-streams.md`, `02-models.md` |
| An optimistic-UI reconciliation pass: temp id tracked, swapped for the db id, race-guarded | All bookkeeping to undo a duplicate created by letting the server invent identity after insert | Override `to_key` to return the client-chosen id; `dom_id` then matches the optimistic node and Turbo replaces in place — the de-dupe is deleted, not written → `05-turbo-frames-streams.md` |
| `turbo_stream.replace` (destructive) answering a user's own gesture (a drag, an edit) | Rips out the node mid-transition, discards focus and the optimistic mutation | `method: :morph` — morph is reconciliation, not replacement; when the client guessed right, morph finds nothing to change → `06-morphing-live-updates.md` |
| A broadcast verb per model per change kind, plus loops re-broadcasting dependent records | A hand-authored fan-out matrix | `broadcasts_refreshes` once + `touch: true` on the associations that already exist — staleness rides the existing graph; with `turbo_refreshes_with method: :morph` and `turbo_stream_from`, multiplayer is emergent, not a subsystem → `06-morphing-live-updates.md` |
| `window.onfocus = () => location.reload()` for wake-from-sleep catch-up | Throws away the page to learn what changed | A turbo_stream diff: append the new, replace the edited, by `dom_id`, through the one partial → `05-turbo-frames-streams.md` |
| Morphing pages containing lazy `src` frames, with no self-heal | Page morph overwrites loaded frame content with the server's empty placeholder | The frame cancels the wholesale morph and reloads itself (`morphReload`), wired once in the frame helper → `06-morphing-live-updates.md` |
| Live refresh slamming menus shut / collapsing panels | `open`/`class` is browser-only state the server's render can't know | A `turbo:before-morph-attribute` veto for exactly the attribute carrying transient state → `06-morphing-live-updates.md` |
| A scroll-aware (or otherwise special-cased) second renderer for one update kind | Two renderers drifting, wearing a behavior costume | Stamp intent as data on the wire (`attributes: { maintain_scroll: true }`); the client honors the flag, the transport stays generic → `05-turbo-frames-streams.md` |
| Optimistic drag/insert placing the node by the client's own guess about position | When the guess disagrees with the server's ordering, the morph corrects it with a visible flicker | Constrain the guess to the one server sort axis: the server stamps the deciding bit as a data attribute (top-or-bottom), the client reads exactly that — the guess can't disagree with truth (Fizzy) → `06-morphing-live-updates.md` |

---

## Stimulus & Frontend

| Red flag | Why it's wrong | The fix |
|---|---|---|
| The diff adds React/Next/an SPA layer or a client-side router | The default the doctrine exists to displace | Server-rendered HTML + Turbo + Stimulus; read `00-frontend-first-principles.md` before touching the stack |
| `this.selected = index` + a hand-painted `.highlighted` class | Two copies of "which item is selected," and the screen reader reads neither | The DOM attribute IS the state: set `aria-selected` and let CSS and assistive tech both read the one fact → `07-stimulus-widgets.md` |
| A Stimulus controller per list variant (vertical list, horizontal list, dropdown) | Four forks of one mechanism, each drifting | Config over forks: one generic controller varied entirely by `data-*` values declared in the ERB → `07-stimulus-widgets.md` |
| A hotkey handler calling `postpone(card)` or any domain method directly | Bakes the domain into the keyboard layer; reuse means forking the handler | Read the action URL off the focused element (`data-*-url` stamped in ERB, pointing at a REST resource); the URL carries the contract — the keyboard is one more client of the routing table → `07-stimulus-widgets.md` |
| `form.submit()` called from JS | Skips native validation and bypasses Turbo — full-page reload | `requestSubmit()` always → `07-stimulus-widgets.md` |
| JS constructing `<input>` names, or serializing a bespoke JSON shape for a widget (`JSON.parse(request.body)` server-side) | The client owns a wire format Rails already has; name and array-shape knowledge drifts across two files; mutating JSON submits step outside form-level CSRF | A server-rendered `<template>` authors the field name once — the same side that writes the `permit` list; single-vs-multi select IS the scalar-vs-array param distinction (`name` vs `name[]`) → `07-stimulus-widgets.md` |
| One Stimulus controller importing or directly invoking another | A dependency only a refactor can change | Declare the pipeline as `data-action` chains in the markup (publisher/subscriber authored in ERB), or a declared outlet for parent/child reach → `07-stimulus-widgets.md` |
| A `dirty` flag maintained next to a debounce timer | The flag and the work drift the instant a save races a keystroke | The timer IS the dirty flag — `#dirty` asks whether the timer exists; flush in `disconnect()` → `07-stimulus-widgets.md` |
| Call sites hand-writing the full `data-controller` list onto `form_with` | The second feature clobbers the first | Additive decorator helpers merging contributions (`[data[:action], "..."].compact.join(" ")`) → `07-stimulus-widgets.md` |
| A special-case `if` inside a JS controller to exempt one list/element | The exemption hides where no one building the view can see it | Capability by subtraction in markup: stamp `data-*-disabled: true` on the exempt element; the controller just reads the flag → `07-stimulus-widgets.md` |
| Cursor/selection logic that re-selects item zero (or strands focus on a removed node) after a live morph | Yanks the user to the top, or leaves the keyboard dead | Remember only the index, await the real morph signal in a bounded `Promise.race` with a short fallback, re-derive the cursor from the fresh DOM (cursor-rehoming) → `07-stimulus-widgets.md` |
| Client-side drafts cleared on submit *attempt*, or keyed globally | A failed save eats the draft; two resources collide | Key per resource, clear only on confirmed success, re-derive the visible text after every morph — derive-don't-store at the client layer → `06-morphing-live-updates.md`, `07-stimulus-widgets.md` |
| A buttonless background submit built as a waiting controller + manual cleanup | Bookkeeping for a lifecycle Turbo already emits | A self-submitting, self-erasing form: one controller that calls `requestSubmit()` in `connect()` and removes the form on a successful `turbo:submit-end` — still a boring Rails form through ordinary `params` (Fizzy) → `07-stimulus-widgets.md` |

---

## Jobs

| Red flag | Why it's wrong | The fix |
|---|---|---|
| Real logic inside `perform` | Strands the work behind a queue — testing or reusing it means draining a queue | The thinnest thread boundary: a 2–3 line thunk delegating to a model/PORO method, synchronously testable → `08-jobs-background-work.md` |
| `perform_later(record.id)` + `Model.find` inside the job + a hand-rolled "what if deleted" branch | Re-implements what GlobalID does, per job | Pass the record itself; `discard_on ActiveJob::DeserializationError` once on `ApplicationJob` → `08-jobs-background-work.md` |
| `return unless condition` as the job's first line | A worker occupied and records deserialized to discover there was nothing to do; the guard gets copy-pasted into every job | The guard lives on the `_later` wrapper, before the enqueue (`X::Job.perform_later(...) if condition`); the job assumes the precondition → `08-jobs-background-work.md` |
| Job enqueued from plain `after_create` | A rolled-back row is still picked up by the worker — the ghost row at the queue layer | Enqueue from `after_create_commit`; the _commit boundary is the trigger altitude → `08-jobs-background-work.md` |
| The whole fan-out in-band: a per-member loop sending pushes inside the request | One flaky provider drags the sender's response to a crawl | Split at the sync/async line inside one domain method: cheap-and-durable stays in-band (one bulk `update_all`), slow-and-flaky crosses into a job (`push_later`) — altitude is decided at the seam → `08-jobs-background-work.md` |
| A per-row `update` loop for the cheap half ("mark each member unread") | An N+1 hiding inside a callback — cheap work done expensively | One bulk `update_all` over composed scopes that reads like the sentence it implements → `08-jobs-background-work.md`, `02-models.md` |
| Live Active Record objects handed into a raw thread pool | Threads lazily query through the ORM outside the Rails executor — connection pool exhaustion under load | Such work lives in `lib/`; do all AR reads *before* posting, hand the pool only plain data → `08-jobs-background-work.md` |

---

## Caching

| Red flag | Why it's wrong | The fix |
|---|---|---|
| A hand-assembled cache key: `"message-#{id}-v3"` | You are the version-control system; bump `v4` across call sites and pray. A cache key is a second source of truth about "has this changed?" | `cache record do` — the key derives from `updated_at` (cache_version); the database already maintains it → `09-caching-performance.md` |
| `after_create { parent.update(updated_at: Time.current) }` to bust a parent fragment | Fires on the one path you remembered, silently skips destroy — deleting a child leaves it on screen | `belongs_to :parent, touch: true` — declares the dependency edge once; fires on create, update, *and* destroy; nested `cache` blocks give Russian-doll expiry → `09-caching-performance.md` |
| Caching per item inside a hand-written loop | N separate store round-trips, no batched key computation | `render ... collection:, cached: true` — all keys computed up front, warm fragments fetched in one `read_multi` → `09-caching-performance.md` |
| `Rails.cache.fetch` wrapped around an expensive action's output | Still runs the action and re-ships the bytes every time — it caches on your server, not in the browser | Gate the entire body behind `if stale?(etag: record)` (or statement-form `fresh_when`) so a hit is a bare 304 with no render and no payload → `09-caching-performance.md` |
| A changed resource served at an unchanged URL (avatar, asset) with long cache headers | "I shipped the new image and people still see the old one" | Change the content, change the URL: stamp `v: record.updated_at` into the route; digested assets get `immutable, max-age=1.year` by construction → `09-caching-performance.md` |

The unifying audit question for this whole layer: **is any freshness fact stored rather than derived?** A hand-bumped version integer, a hand-touched parent, a hand-checked "is this fresh?" field — same bug, different altitude.

---

## Security & Auth

| Red flag | Why it's wrong | The fix |
|---|---|---|
| `Model.find(params[:id])` followed by a permission check (`head :forbidden unless ...`) | The find and the guard are separable; the new controller copies the find and forgets the guard — and the leak errors nowhere | Load every record through the current user: `Current.user.<association>.find(...)` — the record either exists from your vantage point or doesn't. The IDOR you cannot type → `10-auth-security.md` |
| A global query (search, export, feed) "filtered by permission" after the fact | The exact place a results leak hides — the day a caller copies only the first half | Compose auth onto the left of the chain: `Current.user.reachable_messages.search(q)` — authorized by construction, because the scope is a chainable Relation → `10-auth-security.md` |
| `before_action :require_login` sprinkled per controller | The unprotected action is the one someone forgot to annotate — discipline fails open | Secure-by-default, opt-out-by-name: the guard lives in the base class's `included do`; public pages must *ask* via `allow_unauthenticated_access`. Forgetting now fails closed → `10-auth-security.md` |
| Creator/admin check re-typed in each mutating action | Copies drift | One predicate (`can_administer?` = admin ∨ creator ∨ new-record) behind one `before_action` over every write → `10-auth-security.md` |
| A parallel permission system for a restricted actor (bot, API client) | Two permission sets drift | Capability by subtraction: the actor is a `User` with a role, denied everywhere by default (`deny_bots`); `allow_bot_access` removes one denial on one action → `10-auth-security.md` |
| `rescue => false` (or any "couldn't tell, let it through") in a network/SSRF guard | Precisely the hole — uncertainty resolved toward open | Fail closed: invalid means dangerous; an unparseable address is treated as private and blocked → `10-auth-security.md` |
| Login/reset form answering differently for known vs unknown emails (even by timing or a guard-clause `render :ok`) | A free user directory; the guard-clause fix drifts the day someone edits the real path | Anti-enumeration by structural identity: the unknown path constructs the same (unsaved) object and runs the identical code — byte-identical by shared code, not hand-matched branches (Fizzy) → `10-auth-security.md` |
| A `tokens` table with `expires_at` checks, one-time destroy, and a sweeper cron | Three subsystems for what one signed string does | `signed_id(purpose:)` / `find_signed!(purpose:)` — the credential IS the URL, zero rows; mint and verify co-located → `10-auth-security.md` |
| A `pending_logins` table (or session row) for "this browser is mid-login" | A row with its own lifecycle and cleanup, for one transient fact | A signed, `httponly`, self-expiring cookie whose `expires:` matches the code's — tamper-evident, dies on the same clock → `10-auth-security.md` |
| A magic link/code redeemable from any browser | A code mailed to one inbox redeemed by a browser claiming another | Bind credential to browser: one constant-time compare (`secure_compare`) at redeem between the cookie's sealed email and the consumed link's → `10-auth-security.md` |
| `status: "banned"` on the user row as the whole enforcement | Dies with the account — log out, re-register, back in thirty seconds; and only bites at next login | Persist the ban as a fact about the *machine* (an IP row that outlives session and account) + an ambient self-registering `before_action` gate installed by one include, checking every mutating request → `10-auth-security.md` |
| A blocked request answered with a candid `403 Forbidden` | Tells the attacker they're specifically targeted | Reply indistinguishably (e.g. a 429 that reads as rate-limiting); guard mutating verbs only, let GET/HEAD pass → `10-auth-security.md` |
| Mutating endpoints with CSRF disabled wholesale for an API caller | Removes the defense for humans too | Conditional CSRF keyed on the authenticated caller kind (skip only when the request proves it's the bot path) → `10-auth-security.md` |

---

## Severity ranking

When time is short, triage findings in this order. Severity tracks *failure direction and silence*, not ugliness.

| Rank | Class | Members | Why first |
|---|---|---|---|
| 1 | **Security-shape violations** | Unscoped `find` + separate guard; post-hoc permission filtering; `params.permit!`; fail-open network guards; enumeration oracles; per-controller auth sprinkle; wholesale CSRF skips | They fail *open* and *silent* — a leak throws no exception, and the broken pattern invites copying. The shape, not the instance, is the bug |
| 2 | **Ghost-row class** | Plain `after_create`/`after_save`/`after_update` reaching outside the DB; jobs enqueued pre-commit; index writes inside the transaction | Irreversible side effects (pushes, emails, queue rows, index entries) about rows that may not exist. _commit means after-durable; one suffix deletes the class |
| 3 | **Second-source-of-truth state** | Flags (`used`, `online`, `read`, `dirty`), stored counters, `position` integers, stored derived text, hand-typed DOM ids, duplicated markup/renderers, hand-maintained cache keys | Drift bugs: nothing errors, the copies just disagree one day. Derive, don't store — flags lie |
| 4 | **Structure smells** | Custom route verbs, `case` on type columns, fat controllers, god models / service objects, forked parallel controllers and JS variants, guards inside `perform` | Junk-drawer growth: each instance is survivable, but each invites the next, and the `only:` arrays and copies drift toward rank 1–3 bugs |
| 5 | **Performance shape** | Per-row loops where one `update_all` serves, missing `collection: cached:`, full fan-out in-band, `Rails.cache.fetch` where a 304 serves | Real cost, but fails loud (slow) rather than wrong; fix after correctness |

A diff that *adds* an instance of ranks 1–2 should not merge. Ranks 3–4 are strong push-back; rank 5 is a note unless on a hot path.

---

## Review workflow

Order of operations for any audit or nontrivial diff review:

1. **Read the models first.** `ls app/models` — the nouns are the domain; controllers are plumbing that pokes them. For each touched model, read the `include` line before any method body: the include line IS the spec. A new capability arriving as fifty buried lines instead of one word on line one is itself a finding (→ `02-models.md`). Then read every callback in the diff and apply the ghost-row test: does it reach outside the database, and does it say `_commit`? Then ask of each one: whose fact is this — every record's, or this call path's?
2. **Read the routes diff for verbs that should be nouns.** Every `member do`/`collection do` block, every `post :verb`, every controller named after an action is a hidden noun waiting to be found. Also check cardinality: a `resources` whose `:id` is never meaningfully used wants singular `resource` (→ `03-controllers-routing.md`).
3. **Grep the enumerable attack surface.** The whole point of secure-by-default is that the holes are *named*, so list them: grep for `allow_unauthenticated_access`, `allow_bot_access`, `skip_before_action`, `skip_forgery_protection`, `permit!`. Each hit is a deliberate opening that must justify itself; a diff that adds one without comment is a finding. Then grep for the leak shapes that bypass the wall entirely: bare `\.find(params`, bare `ModelName.find(` outside a user-scoped chain (→ `10-auth-security.md`).
4. **Grep the drift shapes.** Hand-typed ids and duplicated renderers are textual, so search for them: `id="` with interpolation in ERB, `render_to_string`, `JSON.parse(request.body)`, `form.submit()`, `after_create `/`after_save ` (trailing space — excludes the `_commit` forms), `update(updated_at`, `boolean.*default` in new migrations (then ask of each new boolean: could a row's absence, a timestamp, or an enum carry this?), `position` in migrations, `case .*type`.
5. **For every suspicious line, count the edge cases it FAILS to absorb.** This is the yardstick run in reverse. The hand-rolled version is rarely wrong on the happy path — enumerate the cases the conventional move would have eaten for free: the rollback, the destroy path the callback skips, the second creation path (bot/import/seed/console), the crashed client that never disconnects, the half-failed write, the laptop waking hours behind, the copied line missing its guard. If the line under review handles none of them and the doctrine move handles all of them in fewer characters, the review comment writes itself: name the edge case, name the move, cross-ref the file that owns it.
6. **Check composition last.** The deepest wins are interlocks: `touch:` + `broadcasts_refreshes` + `turbo_stream_from` + `method: :morph` = multiplayer for free; Relation-shaped scopes + authorization-by-association + a chainable `search` = leak-proof search in one line. When a diff implements one of these by hand, the finding isn't the line — it's the missing composition (→ `01-doctrine.md` for the interlock map, `11-worked-features.md` for end-to-end shapes).

What a clean review concludes: the diff added nouns, not verbs; callbacks say `_commit` and pass the whose-fact test; no fact is stored twice; every id and key is derived; every wire carries HTML; the new attack surface is empty or named; and the short lines got short by trusting a convention at the boundary, not by hiding work.
