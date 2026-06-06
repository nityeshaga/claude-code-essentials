# Doctrine: The Nine Principles and Why They Hold

Read this when you are about to write, review, or architect any Rails code — this file is the worldview every other reference file in this skill applies; load it first and let it override your defaults (service objects, JSON APIs, React-shaped state, hand-maintained flags).

## Contents

1. [The throughline and the yardstick](#1-the-throughline-and-the-yardstick)
2. [The ten-minute orientation](#2-the-ten-minute-orientation-reading-any-rails-codebase)
3. [P1 — The model owns the consequence](#p1--the-model-owns-the-consequence)
4. [P2 — Derive, don't store](#p2--derive-dont-store)
5. [P3 — Security is the shape of your data access](#p3--security-is-the-shape-of-your-data-access)
6. [P4 — Convention is leverage](#p4--convention-is-leverage)
7. [P5 — One renderer: HTML over the wire](#p5--one-renderer-html-over-the-wire)
8. [P6 — Model every state change as CRUD on a noun](#p6--model-every-state-change-as-crud-on-a-noun)
9. [P7 — Polymorphism over conditionals](#p7--polymorphism-over-conditionals)
10. [P8 — Give behavior a home](#p8--give-behavior-a-home)
11. [P9 — Put work at its right altitude](#p9--put-work-at-its-right-altitude)
12. [The dependency graph](#12-the-dependency-graph)
13. [Glossary of canonical vocabulary](#13-glossary-of-canonical-vocabulary)

---

## 1. The throughline and the yardstick

**The throughline: Rails stays small because each layer trusts a convention at its boundary.** The framework already knows what to name a DOM node, when a record is durable, how to reach a row through an association, when a cache key changes. 37signals code lets that knowledge live at the seam instead of re-deriving it by hand. The result is not clever code — there is not a single clever line in Campfire — it is an app far smaller than the pile of production edge cases it quietly handles. Campfire's entire `Message` model is 44 lines; the attachment handling, mention parsing, search indexing, and broadcasting all exist, but each is filed behind a convention boundary.

**The yardstick: count the edge cases this line absorbs for free.** This is the single judgment tool for all code in this skill. When a line looks suspiciously short, do not think "elegant" and move on — ask how many production bugs it makes unwriteable. `belongs_to :room, touch: true` is one token that absorbs an entire stale-cache bug class across every create and destroy path. `after_create_commit` differs from `after_save` by one word, and that word deletes the ghost-row bug class. When 37signals code is one-tenth the size of what you would write, it is not doing less — a convention at the boundary is silently doing the other nine-tenths.

Apply the yardstick in both directions:

- **Reviewing:** a short line backed by a convention beats a long explicit version. Do not "improve" `touch: true` into an `after_create` callback.
- **Writing:** before adding a flag, a table, a service object, a JSON endpoint, or a client-side state store, ask which convention already absorbs the need. The subsystem you are about to build usually shouldn't exist. In Campfire, presence is a timestamp compared against a 60-second window (no sweeper job), read-state is one nullable column (no `read_receipts` table), and the live update and the HTTP response are the same rendered HTML over two transports (no sync layer). The missing subsystems ARE the doctrine.

When both Campfire (chat) and Fizzy (Kanban) — two unrelated shipped products — reach for the same move, it is doctrine, not one app's taste. Fizzy even ships a `STYLE.md` writing the conventions down as law: new resources instead of custom actions, thin controllers calling rich models with no service objects, shallow `_later`/`_now` jobs delegating to the model.

---

## 2. The ten-minute orientation (reading any Rails codebase)

Dropped into an unfamiliar Rails codebase, make three moves in order: **(1)** `ls app/models` — the nouns are the domain; **(2)** read each model's include line — **the include line IS the spec**, each name a concern file at `app/models/<noun>/<trait>.rb`; **(3)** read `routes.rb` — the sitemap of every state change, where `resource :ban, only: %i[ create destroy ]` tells you banning is the *creation of a Ban* (P6 sitting in the routes file). Do **not** start by tracing a request through controllers or scrolling the fattest file — controllers tell you how models get poked, not what is true. Full orientation with the diagram and the why: `12-app-blueprint.md` §11.

---

## P1 — The model owns the consequence

**Statement:** A record is the single source of truth about a fact, and the effects of that fact coming into being belong to the model — except when the effect belongs to the call path, which is the line you must learn to draw.

**Why (first principles):** A controller exists once per request shape, but a fact about a record is true no matter who created it or how. Put a consequence in the controller and you re-type it in every creation path (the bot webhook, the import script, the seed) and watch the copies drift. The discriminating question for every consequence is: **whose fact is this?**

- True for **every record that exists** (bot message, imported message, seeded message) → callback on the model.
- True only because of **how this record came into being** (an interactive send, with people watching) → explicit method, called at the call site.

**Signature moves:**

1. *The owned consequence as a `_commit` callback* (Campfire) — fires for every creation path, after durability:

```ruby
class Message < ApplicationRecord
  after_create_commit -> { room.receive(self) }   # every message, however born
end
```

2. *The consequence that refused to be a callback* (Campfire) — broadcasting is a call-path fact, so it is a plain method invoked explicitly by the interactive controller and the bot webhook, and never by seeds or imports:

```ruby
module Message::Broadcasts
  def broadcast_create
    broadcast_append_to room, :messages, target: [ room, :messages ]
  end
end

# messages_controller.rb        # webhook.rb
@message.broadcast_create       room.messages.create!(body: text, creator: user).broadcast_create
```

3. *Truth without a table* — a model can own a fact with no schema behind it. Campfire's `FirstRun` is a PORO that borrows the `create!` verb to orchestrate Account + Room + User as one setup script; `Sound` is an in-memory catalog with `find_by_name` that quacks like Active Record with zero queries. The principle is ownership, not storage: decide which object is *responsible*, and the storage question answers itself.

4. *State as row existence* — there is no `setup_complete` boolean in Campfire; "has this app been set up?" is `redirect_to first_run_url if User.none?`. The data IS the state machine. A flag can lie (delete every user and it still says done); `User.none?` asks the truth directly.

5. *The association owns its own grammar* — when the model owns a relationship, it owns the verbs for changing it, defined on the association block so every call site speaks one sentence (Campfire; Fizzy's `Card#triage_into` is the same shape — one transactional model verb shared by two call paths):

```ruby
has_many :memberships, dependent: :delete_all do
  def grant_to(users)
    room = proxy_association.owner
    Membership.insert_all(Array(users).collect { |user|
      { room_id: room.id, user_id: user.id, involvement: room.default_involvement } })
  end

  def revoke_from(users) = destroy_by(user: users)
end
```

One bulk insert, stamped with the room's own subclass-correct default, instead of N `create!` calls with a hardcoded involvement looping in a controller.

**Not:** you will be tempted to put the fan-out in the controller because that's where the request landed, or to bind *both* kinds of consequence to one callback and then bolt on an `attr_accessor :skip_broadcast` flag for seeds — don't. The flag is the smell: the moment you write `skip_broadcast`, you've admitted the consequence belongs to the caller, not the record.

**What it unlocks:** P1 is the root of the graph. Once one object owns each fact, P2 can recompute consequences instead of duplicating them, P8 has something to file under traits, and P9 can decide each consequence's altitude. "Fat model, skinny controller" stops being a discipline and becomes a forced consequence: file every consequence where it's actually true and the controller has nothing left to orchestrate.

**Failure mode prevented:** consequence logic copy-pasted across creation paths that drift apart; seeds spraying live broadcasts; flags threading call-site decisions through model state.

---

## P2 — Derive, don't store

**Statement:** Every fact you can recompute from data you already have is a fact you must not store, because a stored copy is a second source of truth that will eventually disagree with the first.

**Why (first principles):** Whether a room is unread is implied by when you last looked versus when the last message arrived. Whether you're online is implied by when you last touched the connection. Whether a URL is a valid capability is implied by a signature — math, not a row. A stored copy of any of these is a cache you keep in sync by hand, and a hand-synced cache is a bug waiting for a quiet afternoon. **Flags lie**; derived predicates self-heal.

**Signature moves:**

1. *Read-state as one nullable timestamp* (Campfire) — null means caught up; the null IS the data. One column derived into three surfaces (the unread scope, the sidebar dot, the OS push badge computed fresh as `user.memberships.unread.count`), so there is no badge counter to drift:

```ruby
scope :unread, -> { where.not(unread_at: nil) }

def read = update!(unread_at: nil)
```

2. *Presence is a question about time, not a flag* (Campfire) — a 60-second window self-heals; the crashed client ages out with no sweeper job. Note the beginless/endless ranges folding `nil` (never connected) into the same `where`:

```ruby
CONNECTION_TTL = 60.seconds
scope :connected,    -> { where(connected_at: CONNECTION_TTL.ago..) }
scope :disconnected, -> { where(connected_at: [ nil, ...CONNECTION_TTL.ago ]) }
```

3. *The credential IS the URL* (Campfire) — `signed_id` capability links: no tokens table, no hand-checked expiry, no sweeper cron. Mint and verify sit a few lines apart in one concern with the identical `purpose:`, so they cannot drift; an avatar token cannot be replayed as a transfer token because the purpose is part of the signature:

```ruby
def avatar_token = signed_id(purpose: :avatar)

def self.from_avatar_token(sid) = find_signed!(sid, purpose: :avatar)

# expiring variant:
def transfer_id = signed_id(purpose: :transfer, expires_in: 4.hours)
```

4. *State as the absence of a row* (Fizzy) — a card is closed iff a satellite `Closure` row exists: `scope :closed, -> { joins(:closure) }`, `scope :open, -> { where.missing(:closure) }`. The satellite carries its own metadata (`closed_by` is `closure&.user`), reopen is `closure&.destroy` — destroying the row IS the reset. Fizzy's one-time login codes are the same move in auth: `consume` *destroys* the code rather than flagging it `used`, and validity is a range scope (`where(expires_at: Time.current...)`) so the database never returns a stale code.

5. *Mentions are derived attachables, not parsed strings* (Campfire) — an `@mention` is stored as a signed global id in the rich-text body and rehydrated into a live `User` (`body.body.attachables.grep(User).uniq`), never a literal `@name` token you regex back out. Renames propagate; duplicates can't collide.

6. *A 304 is derivation at the HTTP layer* (Campfire) — freshness is computed from the data the response was built from, never stored: `if stale?(etag: @user)` wraps the expensive variant processing so it never runs on a hit; `fresh_when @messages` for collections. Same idea on the route: the avatar URL stamps `v: user.updated_at` so when content changes, the key changes — no hand-bumped version integer at any altitude.

**Not:** you will be tempted to add a `read_receipts` table, an `online` boolean, an `unread_count` counter, a `tokens` table, or a `position` integer because the feature "obviously needs storage" — don't. Ask first what existing data already implies the fact. (Fizzy's card order is *computed* from `order(last_active_at: :desc, id: :desc)` — no position column, no renumber-the-column subsystem.) Exception worth knowing: **store when the value is genuine user intent that cannot be recomputed** — Fizzy's column order is a real dragged-into-place `position` — but even then the change reaches the web as CRUD on a noun (P6), never a custom verb. And derivation isn't "never store a computed value": a *keyed cache* (key = `updated_at`) is a function with a memo and self-heals; a *bumped counter* is a second authority and drifts. Never make the stored value the authority.

**What it unlocks:** with P1 (one owner per fact) every other representation becomes a projection computed at its surface — the badge can't disagree with the truth because there's no second number. With P3, derived credentials are unforgeable and un-replayable from one signed string. With P4, "if the content changes, the key changes" runs at three altitudes (dom_id, fragment key, asset URL) with zero hand-maintained versions.

**Failure mode prevented:** the drift-bug class entire — badge says 3 while the room is empty, `online` stuck true after a lid-slam, orphaned token rows, sweeper crons whose only job is correcting values that lie.

---

## P3 — Security is the shape of your data access

**Statement:** Authorization is strongest when it isn't a guard you remember to add but the very query you write — load every record THROUGH the current user, so the leaking version is one you literally cannot type.

**Why (first principles):** Security-as-a-checkpoint puts the guard in a separate line from the load, and the unsafe version is *shorter* — which is exactly the version that gets copied into the next controller. The danger lives in the gap between loading the record and checking the predicate. Delete the gap: if the only way to find the record is through the user, the record a user can't see does not exist from their vantage point. This is P1+P2 applied to access — visibility is *derived* from membership rows, not stored in an ACL, and the fact "what can you see" has one owner.

**Signature moves:**

1. *Authorization-by-association* — one association line is the entire visibility rule, and every controller loads through it. Campfire: `has_many :reachable_messages, through: :rooms, source: :messages`; Fizzy mints the identical `has_many :accessible_cards, through: :boards, source: :cards`. Doctrine, not idiom:

```ruby
def set_message
  @message = Current.user.reachable_messages.find(params[:message_id])
end
```

No `Message.find` exists to copy — **the IDOR you cannot type.** A non-member gets a 404 (the row doesn't exist from where they stand), not a 403 that leaks existence. Because the association is a chainable Relation, everything downstream is authorized by construction: `Current.user.reachable_messages.search(query).last(100)` — the permission is the left half of the chain, and you physically cannot search a room you're not in.

2. *Secure-by-default, opt-out-by-name* — flip the request-layer default so every action requires a session and denies bots, and each open door is a named declaration (Campfire and Fizzy share the vocabulary):

```ruby
included do
  before_action :require_authentication
  before_action :deny_bots
  protect_from_forgery with: :exception, unless: -> { authenticated_by.bot_key? }
end

class_methods do
  def allow_unauthenticated_access(**options) = skip_before_action(:require_authentication, **options)
  def allow_bot_access(**options)             = skip_before_action(:deny_bots, **options)
end
```

The attack surface becomes *enumerable* — grep for the two opt-out verbs and you've listed every public door. Note the direction of failure: forgetting a guard fails open (a leak); forgetting the opt-out fails closed (your new public page demands a login until you notice). Auth itself is an OR-chain that IS the priority order: `restore_authentication || bot_authentication || request_authentication`. CSRF is scoped to the threat that exists (skipped for key-authenticated bots, which submit no forgeable forms).

3. *One predicate guards every write; a subclass bends it* (Campfire) — `can_administer?(record) = administrator? || self == record&.creator || record&.new_record?`, wired once as `before_action :ensure_can_administer, only: %i[ edit update destroy ]` and reused everywhere. The Direct-room exception (everyone in a DM can administer it) is a subclass override of `ensure_can_administer` returning true — the exception lives in the one file that IS the exception (P7), not an `if room.direct?` in the base.

4. *The ambient self-registering gate* (Campfire) — a concern that mounts its own `before_action` in `included do`, so one line in `ApplicationController`'s include list guards every non-idempotent request in the app against banned IPs. No per-action vigilance because there is no per-action anything.

5. *Fail closed; invalid means dangerous* (Campfire) — the SSRF guard's rescue arm returns `true` (private, blocked) when an address can't even be parsed. The tempting `rescue → false` ("couldn't tell, let it through") is precisely the hole. Fizzy extends the instinct to anti-enumeration: an unknown login email gets a **fake, never-saved** `MagicLink.new` pushed through the *same* response path as a real one — one branch, one shape, nothing for an attacker to read. Don't make two branches look equal; build one shape and just don't persist it.

6. *Two failure manners, chosen by context* — `find_by!` (hard 404) for API-ish sub-resources where a missing row is an error; `find_by` + redirect for human navigation where a stale bookmark deserves a gentle bounce (`Current.user.rooms.find_by(id: cookies[:last_room]) || default_room` — authorization and graceful fallback as the same expression).

**Not:** you will be tempted to write `Model.find(params[:id])` followed by a permission check, or to rely on discipline ("I'll always remember the guard across forty controllers and three years") — don't. That is a hope, not a security model.

**What it unlocks:** with P6, the thin resourceful controller and the secure controller are the same controller — auth rides in on the loading line, no separate auth layer per noun. With P8, gates install themselves by being listed. The result is **defense-in-depth with no per-call vigilance**: at every layer the safe path is also the only ergonomic path, which is the only kind of security that survives a growing codebase and a tired developer.

**Failure mode prevented:** the IDOR shipped by a copied `find` missing its second line; the unprotected endpoint nobody remembered to guard; search-result leaks; SSRF via unparseable addresses; account enumeration via divergent responses.

---

## P4 — Convention is leverage

**Statement:** When both sides of a boundary ask the framework the same question (`dom_id`, `to_key`, `touch:`), they can never drift — convention turns "two things I must keep in sync by hand" into "one thing computed in one place."

**Why (first principles):** Hand-typed identity strings drift because there are two of them, one on each side of a seam, kept equal by vigilance — and a drifted id throws no exception, it just silently stops working. Human vigilance is not a synchronization mechanism. Delete one copy: have every site call one function that computes the value *from the model*, and mismatch stops being a bug you avoid and becomes a state you cannot express. Convention is not "memorize the Rails magic" — it is delegating bookkeeping to a function at the seam so two humans on two sides cannot desync it.

**Signature moves:**

1. *dom_id is the address* — page render, HTTP turbo_stream reply, live broadcast, wake-from-sleep refresh, and edit all name the node by asking `dom_id` about the same model; not one of them types an id string (Campfire; Fizzy does the same with `dom_id(card, :messages)`):

```ruby
tag.div id: dom_id(room, :messages)                                  # the container, in the helper
turbo_stream.append dom_id(@message.room, :messages), @message       # the HTTP reply
broadcast_append_to room, :messages, target: [ room, :messages ]     # the live broadcast
```

2. *The empty `edit` action* (Campfire and Fizzy) — edit-in-place needs three files to agree on one frame id; all three ask `dom_id(message, :edit)` (the row's `<turbo-frame>`, the Edit link's `turbo_frame:` target, the edit response's frame). The convention does the whole swap, so the controller action is literally:

```ruby
def edit
end
```

3. *`touch:` declares the freshness edge once* — Russian-doll caching with no hand-maintained cache key. Declared on the association edge that owns the dependency in both products (`belongs_to :room, touch: true` on Campfire's message and boost; `belongs_to :board, touch: true` / `belongs_to :card, touch: true` in Fizzy). Touch the child → the parent's `updated_at` bumps → the parent fragment's key changes → the cache expires through *every* create and destroy path. The cache key itself is `updated_at` — derived, never a hand-bumped version integer (P2): "if the content changes, the key changes," at the DOM id, the fragment key, and the asset URL alike.

4. *`to_key` is the convention bridge for identity itself* — override the one ActiveModel method `dom_id` consults, and the optimistic client node and the server's broadcast share an address (full story in P5).

**Not:** you will be tempted to type `"room_#{@room.id}_messages"` in the view and re-type it in the broadcast, or to write an `after_create` doing `room.update(updated_at: Time.current)` by hand — don't. Where convention genuinely cannot reach (the client-side optimistic template that can't call the server's partial), do what Campfire does: make the seam loud with a warning comment at the top of both files. Reserve hand-discipline for exactly the places a function can't absorb.

**What it unlocks:** P4 is the glue P5 stands on — "the same HTML hitting the same node over every transport" is only possible because every path derives the same address from the same model. With P1, `touch:` makes caching fall out of association declarations. The deepest written proof that convention is leverage: Fizzy ships a `STYLE.md` stating the house conventions as law, so humans and AI on both sides of every seam can trust them without a conversation.

**Failure mode prevented:** the silent-drift class — renamed id prefix in one file, edits targeting a frame that matches nothing, markup duplicated between page and broadcast where one copy grows a feature the other doesn't, caches that don't bust on the path nobody remembered.

---

## P5 — One renderer: HTML over the wire

**Statement:** Render HTML on the server once, send that same HTML over every transport, and let identity conventions make the optimistic client node and the server's broadcast converge — so "the HTTP reply" and "the live update" are one feature, not two.

**Why (first principles):** The naive realtime build makes two mistakes. First, it assumes the wire carries *data* (JSON, or a string rendered at each delivery point), so each end must render — and now the page render, the `render_to_string` for the cable, and the stream reply are three copies of the markup that drift silently (**the two-renderer drift bug**). Invert it: **the wire carries HTML, not data** — the byte-identical output of one server partial — and the client's only job is to place it at a named target. There is no second place for markup to live, so nothing drifts; no serializer, no client templating engine, no payload schema synced across two codebases. Second, it treats the sender's optimistic bubble as a special case needing branches (broadcast-except-sender, temp-id reconciliation, race guards). It isn't special — it's the same row; the two DOM nodes just don't know they're the same. Agree on identity from the first keystroke and the de-dupe is deleted, not written.

**Signature moves:**

1. *One partial, every transport* (Campfire) — page load, the POST's turbo_stream reply, the cable broadcast, the edit replace, and the wake-from-sleep refresh diff all render `messages/_message` and address by `dom_id`. Five paths, one renderer, zero glue; change the partial and every path changes together.

2. *The optimistic-id handshake* (Campfire) — the client draws a placeholder with a UUID it chose; the server adopts it and teaches `dom_id` to speak it:

```ruby
before_create -> { self.client_message_id ||= Random.uuid } # Bots don't care

def to_key
  [ client_message_id ]
end
```

`to_key` is the ActiveModel method `dom_id` consults, so the authoritative broadcast arrives carrying the id the placeholder already has, and Turbo **replaces in place** instead of stacking a duplicate. No per-user channels, no reconciliation pass, no race guard. (Fizzy reaches the same convergence with morph: the dragged card's optimistic move is reconciled by a `method: :morph` replace — same shape, different mechanism; see `06-morphing-live-updates.md`.)

3. *Two audiences, no branch* (Campfire) — `update` broadcasts a `replace` to spectators and plain-redirects the actor; each audience's path is determined by where their request originated (the actor's submit was inside the edit frame), not by an `if current_user ==` check. Fizzy merges further: its `update.turbo_stream.erb` IS both the HTTP reply and the live repaint, morphing the same partials the first paint used.

4. *Server declares intent as data on the wire* (Campfire) — when the client must behave differently for one update kind, stamp the intent as an attribute (`attributes: { maintain_scroll: true }`) instead of forking a second scroll-aware renderer. The transport stays generic HTML-at-a-target; nuance rides along as a labeled flag the client honors.

5. *The wire payload shrinks to a word* (Fizzy) — the newest form of the same principle: `broadcasts_refreshes` on the model + `turbo_stream_from @board` on the page + morph means the wire literally carries "refresh" and every browser re-renders the same partials. Composition: `touch:` + `broadcasts_refreshes` + `turbo_stream_from` = multiplayer, with no bespoke realtime code (mechanics in `06-morphing-live-updates.md`).

**Not:** you will be tempted to broadcast a JSON payload and template it client-side, or to `render_to_string` a second copy of the markup for the cable, or to build broadcast-except-the-sender channels — don't. The few extra bytes of HTML versus JSON are noise; what they buy is an entire layer (serializer, client renderer, schema, reconciler) you never write, test, or debug.

**What it unlocks:** with P4 supplying the shared address and P1 supplying the trigger (persistence fires the consequence; `broadcast_create` stays call-path-explicit), optimistic real-time multi-user UI — the feature category people pay Slack for — is a handful of declarative lines. With P9, the broadcast rides in-band while the push fan-out defers, keeping the optimistic loop snappy.

**Failure mode prevented:** markup drift between page and live paths ("works on reload, broken live, nothing errors"); the duplicate-bubble bug; the entire client-side state-sync layer an agent reaches for by React habit.

---

## P6 — Model every state change as CRUD on a noun

**Statement:** Any verb you're tempted to bolt onto a controller (ban, reset, mute, open-room) is really the create/update/destroy of a hidden noun — name that noun and the controller collapses to a tiny resourceful seven-actions, and the routes file stays flat.

**Why (first principles):** Custom member routes accrete: six months in, the controller has fifteen actions, the `only:` array on the auth guard has drifted, and the day someone adds an action but not the guard you've shipped an open admin endpoint with no error. Stop asking "what action is this?" and ask **"what is the thing whose lifecycle is changing?"** Banning is the creation of a `Ban`. Regenerating a join code is the creation of a fresh `JoinCode`. Muting is the update of your `Involvement`. **Find the noun**, and the verb becomes one of the seven RESTful actions Rails routes for free. Fizzy writes this as law in `STYLE.md`: introduce a new resource rather than a custom action — `resource :closure`, not `post :close` / `post :reopen`.

**Signature moves:**

1. *The two-line CRUD controller* (Campfire; Fizzy identical with `@card.gild`/`@card.ungild` on a `Goldness`) — translate HTTP into one model method call, redirect; the work lives on the model (P1):

```ruby
class Users::BansController < ApplicationController
  before_action :ensure_can_administer

  def create
    @user.ban
    redirect_to @user
  end

  def destroy
    @user.unban
    redirect_to @user
  end
end
```

A model is allowed to have verbs; a controller is not. `reset_join_code` behind a standard `create` route is a domain method, an implementation detail of the noun — the web only ever sees the noun's lifecycle.

2. *Routes vocabulary that carries the structure* (Campfire) — singular `resource :ban` because a user has exactly one ban relationship (the router has a word for cardinality; no meaningless `index`); `scope module: "users"` so the controller folder tree mirrors the route tree while the URL stays flat; `scope defaults: { user_id: "me" }` so the path helper for "my profile" needs no argument.

3. *The verb that was a read all along* (Campfire) — opening a room, switching rooms, and following a deep link are all the same `GET #show` (`@messages = find_messages`, one action). The only real work is choosing the slice: `page_around(message)` for a deep link, `last_page` for a plain open — two composable pagination scopes feeding one render path. Before inventing a verb, check whether it's a read you already have.

4. *Even the URL's query state is a noun* (Fizzy) — a board filter is a real `Filter` record, found-or-built from params (`find_by_params(params) || build(params)`) via a canonical digest (params normalized, sorted, MD5'd, uniquely indexed). The controller's index is one line — `set_page_and_extract_portion_from @filter.cards` — because the noun owns its own query. Once you see a throwaway query become a findable, saveable noun, almost nothing in a web app isn't CRUD on something.

**Not:** you will be tempted to write `member do post :ban end` and a fat action that opens a session, deletes rows, loops, and flips a status — don't. And when an order or arrangement genuinely must be stored (real user intent, P2's exception), keep the web shape: Fizzy's slide-a-column-left is `resource :left_position` whose `create` calls `@column.move_left` — stored or derived, the verb never reaches the controller.

**What it unlocks:** skinny controllers are not discipline — they're **what's left over** when every action is genuine CRUD: P1 took the logic, P3 took the authorization (the nested resourceful load through the user authorizes as a byproduct), P5 took the rendering. With P3, one resourceful action per noun means one load path to secure.

**Failure mode prevented:** the fat controller junk drawer; the drifting `only:` guard array; three endpoints (`open_room`, `switch_room`, `jump_to_message`) re-implementing one read; query-building logic smeared across index, sidebar, and export.

---

## P7 — Polymorphism over conditionals

**Statement:** Every if-this-type / elsif-that-type branch is a polymorphism you haven't named yet — push the difference into a subclass, an enum, or a `super` call, and the case statement disappears along with the bugs that hid in its branches.

**Why (first principles):** `if kind == "direct"` re-asks a question the runtime already answers by holding the object — and the branch metastasizes into the model, the controller, the view, and the pusher: four copies that must agree forever. Add a fourth kind and you hunt every copy and pray; miss one and the new kind silently inherits the wrong behavior. **The branch was a missing abstraction.** A difference that depends on the kind of a thing belongs to the kind. The cost objection ("a three-line if is simpler than a subclass") is wrong about where the cost is: it's not the `if`, it's the copies — the subclass writes the difference once, in the file named after it, and deletes the other three.

**Signature moves:**

1. *STI: subclasses override only the seam* (Campfire) — one `rooms` table, a `type` column, three subclasses. `Rooms::Direct` overrides exactly one method; `Rooms::Closed` is a **literally empty class** because "closed" is the default behavior — the empty body is the lesson (a subclass lets the default stay silent):

```ruby
def default_involvement = "mentions"     # the base

class Rooms::Direct < Room
  def default_involvement = "everything" # the ENTIRE behavioral difference
end

class Rooms::Closed < Room
end
```

Predicates ask the object, never a column: `def direct? = is_a?(Rooms::Direct)`. Conversion recasts the object — `@room = @room.becomes!(Rooms::Open)` — so the *new* subclass's callbacks fire on save, and `type_previously_changed?(to: "Rooms::Open")` (free dirty-tracking) gates the re-grant so it fires only on actual conversion, never on a rename.

2. *Enum as a query vocabulary; the disabled state is the absence of a merge* (Campfire) — four mutually exclusive notification tiers as one ordered enum, not three booleans encoding eight typeable states for four real ones:

```ruby
enum :involvement, %w[ invisible nothing mentions everything ].index_by(&:itself), prefix: :involved_in
```

The pusher composes generated scopes like English (`relevant_subscriptions.merge(Membership.involved_in_everything)`) — and there is *no code at all* for muted: `invisible`/`nothing` simply have no `.merge`, so a muted member never enters the set. Silence implemented by silence; code that doesn't exist can't have a bug.

3. *Controller inheritance + super: the bot path IS the human path* (Campfire) — `Messages::ByBotsController < MessagesController` overrides only `message_params` (a bot sends a raw body, not a form) and calls `super`; auth, room lookup, creation, broadcast, and the model-level fan-out are all the inherited path. **Capability by subtraction:** a bot is just a `User` with `role: :bot`, denied everywhere by `deny_bots`, and `allow_bot_access only: :create` removes one denial on one action. Nobody wrote a bot messaging system; they wrote one filter skip and one method override.

4. *The branch-erasing move holds at every altitude* (Fizzy) — the event ledger's `Eventable` concern is a template-method loop: `eventable_prefix` derives the action name from `self.class.name`, `should_track_event?` and `event_was_created` are hooks each noun overrides on its own turf — no `case eventable_type` in the concern. And the view dispatches by *computed partial name* (`render "events/event/eventable/#{event.action}"` guarded by `lookup_context.exists?`) — dozens of event types, zero `case`; adding one is dropping a file, not editing a branch.

**Not:** you will be tempted to add a `kind` string column and branch on it, to model exclusive states as a fistful of booleans, or to fork an `Api::MessagesController` that re-implements the human path — don't. The fork drifts the day the human path grows a feature the copy doesn't (bots that can't post images).

**What it unlocks:** with P1, per-kind behavior lives on the kind, leaving controllers nothing to branch on. With P3, the rule exception is a subclass overriding the guard. With P5, the bot's reply rides the identical broadcast rails as a human's — zero bot-specific render code.

**Failure mode prevented:** the metastasized `if kind ==` missed in one of four copies; impossible-but-storable boolean combos; forked parallel controllers drifting apart; central `case` statements that must grow an arm per new type forever.

---

## P8 — Give behavior a home

**Statement:** A model's include list is its table of contents; each concern files a trait where it belongs — host-changing wiring inside `included do`, plain behavior in the module body, the named constructor beside the trait it builds — so you know what a class can do before reading a single method.

**Why (first principles):** The problem with the 300-line god model isn't length — it's that a trait's pieces are *scattered*, so they drift and you can't find them. The escape hatch of a `MessageService` makes it worse: now the trait is a service plus a fan of call sites synced by hand, and forgetting one leaves the index quietly stale. The requirement is co-location: every piece of "search" — callbacks, scope, private SQL — in one named place, advertised on the model's first line. **The include line IS the spec**: `include Attachment, Broadcasts, Mentionee, Pagination, Searchable` (Campfire's Message, which stays 44 lines); Fizzy's `Card` runs one include to twenty-four traits and the class file is still 95 lines.

**Signature moves:**

1. *The three-region grammar* — `ActiveSupport::Concern` gives a trait's three kinds of thing exact homes. **`included do` is the wiring harness** (runs in the host's context — the only place a scope, callback, or association can attach); the module body holds plain behavior; `class_methods do` holds the named constructor next to the trait it builds (Campfire's `create_bot!` lives in `User::Bot` beside `bot_key` and `deliver_webhook`; Fizzy's `Card::Taggable` splits identically):

```ruby
module Message::Searchable
  extend ActiveSupport::Concern

  included do                                  # wiring: changes the host
    after_create_commit  :create_in_index
    after_update_commit  :update_in_index
    after_destroy_commit :remove_from_index
    scope :search, ->(query) { joins("join message_search_index idx on messages.id = idx.rowid").where("idx.body match ?", query).ordered }
  end

  private                                      # behavior: plain methods
    def create_in_index
      execute_sql_with_binds "insert into message_search_index(rowid, body) values (?, ?)", id, plain_text_body
    end
    # update_in_index / remove_from_index follow the same shape
end
```

That concern is a *complete production full-text search feature* in ~25 lines — indexed, self-syncing, and chainable, which is why `Current.user.reachable_messages.search(query).last(100)` composes auth + search + pagination on one line. Keep trait scopes chainable Relations, never methods returning arrays.

2. *Co-location makes desync unwriteable* — Avatar's mint (`signed_id(purpose: :avatar)`) and verify (`find_signed!(sid, purpose: :avatar)`) sit eight lines apart in one module, so the two halves of the round-trip can't drift to different purposes. The callback that fires `create_in_index` sits directly above the method it calls.

3. *The concern is where the other principles' outputs live* — P1's owned consequences file under their trait (`Bannable` owns `remove_banned_content_later`; `Searchable` owns its index sync). P3's ambient gates install themselves from `included do` by being listed. P9's `_later` wrapper sits next to its synchronous twin so the guard and the work are four lines apart.

**Not:** you will be tempted to open the class and add one more method (the file grows by fifty buried lines), or to peel logic into a `FooService` (the trait loses its home entirely) — don't. When a model needs to do one more thing, add a concern and add its name to the include line: the file grows by one readable word. And the "action at a distance" worry is answered by naming: the host advertises exactly which modules may wire into it, on line one, in order — when search misbehaves you don't grep the app for callbacks, you open one file.

**What it unlocks:** P8 is the answer to the question P1, P3, and P9 each raise — "this behavior has to go *somewhere*." It is what keeps rich models readable as they grow, which is what makes "fat model" sustainable rather than a junk drawer.

**Failure mode prevented:** the scroll-hunt ("how does search work in this app?"); the stale index from a forgotten service call site; mint/verify pairs drifting to different settings; capability lists nobody can read.

---

## P9 — Put work at its right altitude

**Statement:** Decide for every unit of work whether it runs in-band (cheap, must be durable for the response) or out-of-band (slow, flaky, fan-out), and make the seam between them the thinnest possible thread boundary — a two-line job that only exists to be on another thread.

**Why (first principles):** The naive everything-in-one-callback version grows four production bugs that are all the same bug — work at the wrong altitude: N sequential UPDATEs where one bulk statement would do; the sender's request blocking on fifty third-party push gateways; `after_save` firing *inside* the transaction so a rollback ships notifications for a row that no longer exists (**the ghost row**); and re-notification on every edit. The cut: ask "at what altitude does each unit belong?" In-band = cheap and the response would lie without it. Out-of-band = anything the sender should never wait on. That boundary is **the sync/async line**, and altitude is a *correctness* boundary, not a performance tactic.

**Signature moves:**

1. *The `_commit` trigger and the explicit split* (Campfire; Fizzy's webhook delivery is the identical seam: `after_create_commit :deliver_later` → one-line job enqueue) — **_commit means after-durable**: a rolled-back row can never reach a worker. Then the receiving method draws the line out loud, one named intent per altitude:

```ruby
after_create_commit -> { room.receive(self) }

def receive(message)
  unread_memberships(message)   # in-band: one bulk update_all over composable scopes
  push_later(message)           # out-of-band: enqueue and return
end

def unread_memberships(message)
  memberships.visible.disconnected.where.not(user: message.creator)
    .update_all(unread_at: message.created_at, updated_at: Time.current)
end
```

No `each`, no N+1, no loading rows into Ruby to filter them — the in-band half is one statement.

2. *Jobs are thunks* — every job in Campfire is the same ~3-line shape, and Fizzy's `STYLE.md` states it as law ("shallow job classes that delegate the logic to domain models", `_later` enqueues / `_now` does the work):

```ruby
class Room::PushMessageJob < ApplicationJob
  def perform(room, message)
    Room::MessagePusher.new(room:, message:).push
  end
end
```

The logic stays on the model where it's synchronously testable; the job exists only to be on another thread. Pass *records*, not ids — Active Job serializes them as GlobalIDs and the worker re-derives the row (a small P2); never write `find(id)` at the top of a `perform`.

3. *The guard lives on the `_later` wrapper, not in the job* (Campfire) — the precondition runs once, synchronously, before the enqueue, so the worker never re-checks defensively and ineligible work is never enqueued at all:

```ruby
def deliver_webhook_later(message)
  Bot::WebhookJob.perform_later(self, message) if webhook   # the guard
end

def deliver_webhook(message)
  webhook.deliver(message)                                  # the work
end
```

4. *The lowest altitude: escaping the Rails executor* (Campfire) — work that needs a raw thread pool (thousands of push deliveries) moves to `lib/`, and the iron rule is **do all Active Record reads before posting to threads** — by the time work crosses into the pool it carries a plain object and an integer, no live AR connection required on the other side:

```ruby
def deliver_later(payload, subscription)
  # Ensure any AR operations happen before we post to the thread pool
  notification    = subscription.notification(**payload)
  subscription_id = subscription.id
  delivery_pool.post { deliver(notification, subscription_id) }
end
```

**Not:** you will be tempted to hang everything on one `after_save` callback, to stuff the real logic into the worker (now trapped behind a queue you must boot to test), or to put the precondition inside the job where it gets duplicated defensively — don't. And note the altitude question is decided *per consequence*, at the seam, not by the model: marking-unread rides the `_commit` callback (true of every message) while broadcasting stays an explicit method (differs by call path) — P1's line, re-read through timing.

**What it unlocks:** P1 says what the consequence is and whose; P9 says when it's safe to fire and which thread carries it — they compose on a single declaration with zero glue. With P8, the `_later`/plain pairing files under its trait. The entire async surface of a production chat app reads in about a dozen lines: one `_commit` trigger, one `receive` drawing the line, three thunk jobs, one `lib/` pool that reads first.

**Failure mode prevented:** the ghost row; the sender's request hanging on someone else's slow gateway; re-notify on typo-fix edits; defensive `if`s duplicated in every worker; connection leaks outside the executor.

---

## 12. The dependency graph

The nine principles are not a flat checklist. They are a dependency graph — read the arrows as **"makes possible,"** not "comes before." This is why you apply them as a system, not one at a time.

```
            P1  the model owns the consequence            ← THE ROOT
             │
             ▼  (one owner per fact ⇒ every other copy must be computed)
            P2  derive, don't store
             │
             ▼  (derive "who can see what" through the user ⇒ access IS a query shape)
            P3  security is the shape of data access

            P4  convention is leverage                    ← THE GLUE
             │
             ▼  (shared derived address + shared identity ⇒ one rendering can hit every transport)
            P5  one renderer, HTML over the wire

            P6  CRUD on a noun      ┐
            P7  polymorphism        │  ← THE COMPRESSORS: keep everything small
            P8  give behavior a home│     so the first six stay readable
            P9  right altitude      ┘
```

The interlocks, spelled out:

- **P1 roots P2:** once the model is the single source of truth, you can *recompute* a fact's projections instead of keeping second copies. P1 says "this object is responsible"; P2 says "so don't keep a second copy of what it's responsible for." Two halves of one discipline.
- **P2 roots P3:** deriving *who can see what* by loading every record through the current user is P1+P2 applied to access. You don't store an ACL; you derive visibility from membership rows that already exist — and the leak becomes unwriteable.
- **P4 glues P5:** one renderer needs every transport to name the same DOM node and every identity to resolve the same way — `dom_id`, `to_key`, `touch:` are the questions both sides of each seam ask the framework. Without the shared address, one renderer would have nothing to aim at.
- **P6–P9 keep everything small:** P6 collapses fat controllers into resourceful nouns (and P1 gives the noun's model somewhere to put the weight; P3 rides in on the load line). P7 dissolves every per-kind branch into the kind itself. P8 files all of it — P1's consequences, P3's gates, P9's `_later` pairs — into named homes so the include line stays a readable spec. P9 splits each consequence across the sync/async line so correctness survives rollback and fan-out.
- **The compound effect:** "fat model, skinny controller" is not advice — it is the *forced consequence* of the graph. The model owns the truth (P1), so you derive its projections (P2), load through the user (P3), let conventions carry identity (P4) and rendering (P5), name the noun (P6), give the kind its difference (P7), file each trait (P8), and run each piece at its altitude (P9). Each principle hands the next one exactly what it needs, and the controller is the small boring seam left over.

When you meet a design decision mid-task, locate it on the graph: a "where does this code go?" question is P1/P8/P9; a "do I need a column/table?" question is P2; a "how do I authorize this?" question is P3 (and usually dissolves into P6's load line); a "how do I keep these in sync?" question is P4; a "how does this reach the screen?" question is P5; a "what route/action?" question is P6; an "if type ==" in your draft is P7.

---

## 13. Glossary of canonical vocabulary

Use these exact phrases — they are the skill's shared language across all reference files.

| Term | Meaning |
|---|---|
| **Count the edge cases this line absorbs for free** | The yardstick for all code judgment. A line's value is the production bug classes it makes unwriteable, not its cleverness or brevity. |
| **Rails stays small because each layer trusts a convention at its boundary** | The throughline. Each seam (model↔controller, server↔wire, view↔stream) delegates its bookkeeping to a framework convention instead of hand-syncing. |
| **The model owns the consequence** | P1: effects of a record's existence belong on the model (as callbacks), not on whoever happened to create it. |
| **Whose fact is this?** | The P1 discriminator: true for every record that exists → model callback; true only because of how this record was made → explicit method at the call site. |
| **_commit means after-durable** | `after_create_commit` / `after_*_commit` callbacks fire only after the transaction commits — the row is permanently saved before any outside-world effect runs. |
| **The ghost row** | The bug class plain `after_create`/`after_save` causes: the callback fires inside the transaction, a rollback follows, and you've notified the world about a row that no longer exists. |
| **Derive, don't store** | P2: replace every recomputable stored fact with a function of existing data. |
| **A stored copy is a second source of truth** | Why P2 holds: the copy must be kept in sync by hand and will eventually disagree with the original. |
| **Flags lie** | A stored boolean asserts a state that events must maintain; miss one event (the lid-slam disconnect) and the flag is wrong forever. Derived predicates self-heal. |
| **The IDOR you cannot type** | P3's property: when records are only reachable through `Current.user`'s associations, the unscoped leaking lookup isn't discouraged — it's absent. |
| **Secure-by-default, opt-out-by-name** | Every action requires auth and denies bots via shared `included do`; each open door is a named macro (`allow_unauthenticated_access`, `allow_bot_access`), so mistakes fail closed and the attack surface is greppable. |
| **Capability by subtraction** | Grant a restricted actor power by removing one denial (one `skip_before_action`, one `super`), never by building a parallel permission system or code path. |
| **dom_id is the address** | A DOM node's identity is computed from the model by one function; every path (view, stream, broadcast, refresh, edit) asks `dom_id` instead of typing a string. |
| **One renderer** | P5: exactly one server partial paints a given piece of UI, reused across page load, HTTP reply, broadcast, and refresh. |
| **The wire carries HTML, not data** | The transport ships the rendered output of the one partial (or an instruction to re-fetch it); the client places it, never templates it. |
| **The de-dupe is deleted, not written** | When client and server agree on identity up front (`to_key` speaking the client's UUID), duplicate reconciliation code never needs to exist. |
| **Verb-as-noun / find the noun** | P6's move: every custom controller action is the create/update/destroy of a hidden noun; name the noun and the verb becomes standard CRUD. |
| **The include line IS the spec** | A model's `include` list is its table of contents — read it and you know the class's capabilities before any method body. |
| **`included do` is the wiring harness** | The concern region that runs in the host class's context — the only place a trait's scopes, callbacks, and associations can attach to the host. |
| **The thinnest thread boundary** | A background job reduced to a two-or-three-line thunk: receive records, call a model method, return. It exists only to be on another thread. |
| **The sync/async line** | The explicit split between in-band work (cheap, must be durable before the response) and out-of-band work (slow, flaky, fan-out), drawn in a named method like `receive`. |
| **Altitude** | Where a unit of work runs: in-band in the request, out-of-band in a job, or below the executor in a `lib/` thread pool. Decided per consequence, at the seam — a correctness boundary, not a performance tactic. |
| **Config over forks** | Vary behavior by configuration/data (an enum value, a data attribute, a subclass override) rather than forking a parallel implementation that will drift. |
| **The DOM attribute IS the state** | Client-side state lives in the DOM (a class, an `aria-` attribute, a data attribute) and is recomputed from it, never mirrored into a JS variable that can go stale. |
| **The URL carries the contract** | Request state (filters, targets, intent) rides in URLs and params that hydrate into domain objects — the client invents no private wire format. |
| **Morph is reconciliation, not replacement** | Turbo 8 morphing diffs incoming HTML against the live DOM and updates in place, preserving local state — the mechanism behind Fizzy's refresh-based multiplayer (see `06-morphing-live-updates.md`). |
