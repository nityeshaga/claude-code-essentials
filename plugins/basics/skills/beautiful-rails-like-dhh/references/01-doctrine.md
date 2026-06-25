# Doctrine: The Nine Principles and Why They Hold

Read this before you write, review, or architect any Rails code. This is the worldview every other reference file applies — load it first and let it override your defaults (service objects, JSON APIs, React-shaped state, hand-maintained flags).

## Contents

1. [The throughline and the yardstick](#1-the-throughline-and-the-yardstick)
2. [The ten-minute orientation](#2-the-ten-minute-orientation)
3. [P1 — The model owns the consequence](#p1)
4. [P2 — Derive, don't store](#p2)
5. [P3 — Security is the shape of your data access](#p3)
6. [P4 — Convention is leverage](#p4)
7. [P5 — One renderer: HTML over the wire](#p5)
8. [P6 — Model every state change as CRUD on a noun](#p6)
9. [P7 — Polymorphism over conditionals](#p7)
10. [P8 — Give behavior a home](#p8)
11. [P9 — Put work at its right altitude](#p9)
12. [The dependency graph](#12-the-dependency-graph)

---

## 1. The throughline and the yardstick

**The throughline: Rails stays small because each layer trusts a convention at its boundary.** The framework already knows what to name a DOM node, when a record is durable, how to reach a row through an association, when a cache key changes. 37signals code lets that knowledge live at the seam instead of re-deriving it by hand. Campfire's entire `Message` model is 44 lines; attachments, mentions, search, broadcasting all exist, each filed behind a convention boundary.

**The yardstick: count the edge cases this line absorbs for free.** This is the single judgment tool for all code in this skill. When a line looks suspiciously short, don't think "elegant" — ask how many production bugs it makes unwriteable. `belongs_to :room, touch: true` absorbs an entire stale-cache bug class across every create and destroy path. `after_create_commit` differs from `after_save` by one word, and that word deletes the ghost-row bug class. When 37signals code is one-tenth the size of what you'd write, a convention at the boundary is silently doing the other nine-tenths.

Apply it both directions:

- **Reviewing:** a short line backed by a convention beats a long explicit version. Don't "improve" `touch: true` into an `after_create` callback.
- **Writing:** before adding a flag, table, service object, JSON endpoint, or client-side state store, ask which convention already absorbs the need. The subsystem you're about to build usually shouldn't exist. In Campfire, presence is a timestamp compared against a 60-second window (no sweeper), read-state is one nullable column (no `read_receipts` table), live update and HTTP response are the same HTML over two transports (no sync layer). **The missing subsystems ARE the doctrine.**

When both Campfire (chat) and Fizzy (Kanban) reach for the same move, it's doctrine, not taste. Fizzy ships a `STYLE.md` writing it down: new resources instead of custom actions, thin controllers calling rich models with no service objects, shallow `_later`/`_now` jobs delegating to the model.

---

## 2. The ten-minute orientation

Dropped into an unfamiliar Rails codebase, make three moves in order: **(1)** `ls app/models` — the nouns are the domain; **(2)** read each model's include line — **the include line IS the spec**, each name a concern at `app/models/<noun>/<trait>.rb`; **(3)** read `routes.rb` — the sitemap of every state change, where `resource :ban, only: %i[ create destroy ]` tells you banning is the *creation of a Ban*. Do **not** start by tracing a request through controllers — controllers tell you how models get poked, not what's true. Full orientation: `12-app-blueprint.md` §11.

---

## P1 — The model owns the consequence

**Statement:** A record is the single source of truth about a fact, and the effects of that fact coming into being belong to the model — except when the effect belongs to the call path, which is the line you must learn to draw. P1 is the root: once one object owns each fact, P2 recomputes consequences, P8 files them under traits, P9 sets their altitude, and "fat model, skinny controller" becomes forced rather than disciplined.

The discriminating question for every consequence — **whose fact is this?**

- True for **every record that exists** (bot message, imported, seeded) → callback on the model.
- True only because of **how this record came into being** (an interactive send, people watching) → explicit method, called at the call site.

**Signature moves:**

1. *The owned consequence as a `_commit` callback* — fires for every creation path, after durability:

```ruby
class Message < ApplicationRecord
  after_create_commit -> { room.receive(self) }   # every message, however born
end
```

2. *The consequence that refused to be a callback* — broadcasting is a call-path fact, so it's a plain method invoked by the interactive controller and the bot webhook, never by seeds:

```ruby
module Message::Broadcasts
  def broadcast_create
    broadcast_append_to room, :messages, target: [ room, :messages ]
  end
end

@message.broadcast_create       # controller
room.messages.create!(body: text, creator: user).broadcast_create  # webhook
```

3. *Truth without a table* — a model can own a fact with no schema. Campfire's `FirstRun` is a PORO borrowing `create!` to orchestrate Account + Room + User; `Sound` is an in-memory catalog with `find_by_name`. The principle is ownership, not storage: decide which object is *responsible* and the storage question answers itself.

4. *State as row existence* — no `setup_complete` boolean; "has this app been set up?" is `redirect_to first_run_url if User.none?`. A flag can lie; `User.none?` asks the truth directly.

5. *The association owns its own grammar* — when the model owns a relationship, it owns the verbs, defined on the association block so every call site speaks one sentence (Fizzy's `Card#triage_into` is the same shape):

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

One bulk insert stamped with the room's subclass-correct default, not N `create!` calls looping in a controller.

**Not:** you'll be tempted to put the fan-out in the controller because that's where the request landed, or to bind *both* kinds of consequence to one callback and bolt on `attr_accessor :skip_broadcast` for seeds — don't. The flag is the smell: the moment you write `skip_broadcast`, you've admitted the consequence belongs to the caller.

---

## P2 — Derive, don't store

**Statement:** Every fact you can recompute from data you already have is one you must not store, because a stored copy is a second source of truth that will eventually disagree with the first. **Flags lie**; derived predicates self-heal.

**Signature moves:**

1. *Read-state as one nullable timestamp* — null means caught up; the null IS the data. One column derived into three surfaces (unread scope, sidebar dot, push badge as `user.memberships.unread.count`), so no counter can drift:

```ruby
scope :unread, -> { where.not(unread_at: nil) }
def read = update!(unread_at: nil)
```

2. *Presence is a question about time, not a flag* — a 60-second window self-heals; the crashed client ages out with no sweeper. Beginless/endless ranges fold `nil` (never connected) into the same `where`:

```ruby
CONNECTION_TTL = 60.seconds
scope :connected,    -> { where(connected_at: CONNECTION_TTL.ago..) }
scope :disconnected, -> { where(connected_at: [ nil, ...CONNECTION_TTL.ago ]) }
```

3. *The credential IS the URL* — `signed_id` capability links: no tokens table, no expiry checks, no sweeper. Mint and verify sit a few lines apart with the identical `purpose:`, so they can't drift; an avatar token can't replay as a transfer token:

```ruby
def avatar_token = signed_id(purpose: :avatar)
def self.from_avatar_token(sid) = find_signed!(sid, purpose: :avatar)
def transfer_id = signed_id(purpose: :transfer, expires_in: 4.hours)   # expiring variant
```

4. *State as the absence of a row* (Fizzy) — a card is closed iff a `Closure` row exists: `scope :closed, -> { joins(:closure) }`, `scope :open, -> { where.missing(:closure) }`. Reopen is `closure&.destroy`. Fizzy's one-time login codes do the same in auth: `consume` *destroys* the code, and validity is `where(expires_at: Time.current...)` so the DB never returns a stale code.

5. *Mentions are derived attachables* — an `@mention` is a signed global id in the rich-text body, rehydrated into a live `User` (`body.body.attachables.grep(User).uniq`), never a literal `@name` you regex back out. Renames propagate; duplicates can't collide.

6. *A 304 is derivation at the HTTP layer* — `if stale?(etag: @user)` wraps expensive variant processing so it never runs on a hit; `fresh_when @messages` for collections. The avatar URL stamps `v: user.updated_at` so when content changes the key changes — no hand-bumped version integer.

**Not:** you'll be tempted to add a `read_receipts` table, an `online` boolean, an `unread_count` counter, or a `position` integer because the feature "obviously needs storage" — don't. Ask what existing data already implies the fact. **Exceptions:** (a) store when the value is genuine user intent that can't be recomputed (Fizzy's dragged-into-place column `position`) — but even then it reaches the web as CRUD on a noun (P6), never a custom verb; (b) a *keyed cache* (key = `updated_at`) is a function with a memo and self-heals — fine; a *bumped counter* is a second authority and drifts. Never make the stored value the authority.

---

## P3 — Security is the shape of your data access

**Statement:** Authorization is strongest when it isn't a guard you remember to add but the very query you write — load every record THROUGH the current user, so the leaking version is one you literally cannot type. This is P1+P2 applied to access: visibility is *derived* from membership rows, not stored in an ACL.

The danger lives in the gap between loading the record and checking the predicate, because the unsafe version is *shorter*. Delete the gap.

**Signature moves:**

1. *Authorization-by-association* — one association line is the entire visibility rule, and every controller loads through it (Campfire: `has_many :reachable_messages, through: :rooms, source: :messages`; Fizzy: identical `accessible_cards`):

```ruby
def set_message
  @message = Current.user.reachable_messages.find(params[:message_id])
end
```

No `Message.find` exists to copy — **the IDOR you cannot type.** A non-member gets a 404, not a 403 that leaks existence. Because the association is a chainable Relation, everything downstream is authorized by construction: `Current.user.reachable_messages.search(query).last(100)`.

2. *Secure-by-default, opt-out-by-name* — flip the request-layer default so every action requires a session and denies bots; each open door is a named declaration:

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

The attack surface becomes *enumerable* — grep the two opt-out verbs to list every public door. Forgetting a guard fails open; forgetting the opt-out fails closed (the new page demands a login until you notice).

3. *One predicate guards every write; a subclass bends it* — `can_administer?(record) = administrator? || self == record&.creator || record&.new_record?`, wired once as `before_action :ensure_can_administer, only: %i[ edit update destroy ]`. The Direct-room exception (everyone in a DM can administer) is a subclass override returning true (P7), not an `if room.direct?` in the base.

4. *The ambient self-registering gate* — a concern mounts its own `before_action` in `included do`, so one line in `ApplicationController`'s include list guards every non-idempotent request against banned IPs. No per-action vigilance.

5. *Fail closed; invalid means dangerous* — the SSRF guard's rescue arm returns `true` (blocked) when an address can't be parsed; `rescue → false` ("couldn't tell, let it through") is the hole. Fizzy's anti-enumeration: an unknown login email gets a **fake, never-saved** `MagicLink.new` through the *same* response path as a real one — one shape, nothing for an attacker to read.

6. *Two failure manners, chosen by context* — `find_by!` (hard 404) for API-ish sub-resources; `find_by` + redirect for human navigation (`Current.user.rooms.find_by(id: cookies[:last_room]) || default_room`).

**Not:** you'll be tempted to write `Model.find(params[:id])` then a permission check, or to rely on discipline across forty controllers and three years — don't. That's a hope, not a security model.

---

## P4 — Convention is leverage

**Statement:** When both sides of a boundary ask the framework the same question (`dom_id`, `to_key`, `touch:`), they can never drift — convention turns "two things I keep in sync by hand" into "one thing computed in one place." A drifted hand-typed id throws no exception; it just silently stops working. Human vigilance is not a synchronization mechanism.

**Signature moves:**

1. *dom_id is the address* — page render, turbo_stream reply, live broadcast, refresh, and edit all name the node by asking `dom_id` about the same model; none types an id string:

```ruby
tag.div id: dom_id(room, :messages)                              # the container
turbo_stream.append dom_id(@message.room, :messages), @message   # the HTTP reply
broadcast_append_to room, :messages, target: [ room, :messages ] # the live broadcast
```

2. *The empty `edit` action* — edit-in-place needs three files to agree on one frame id; all three ask `dom_id(message, :edit)`. The convention does the whole swap, so the action is literally:

```ruby
def edit
end
```

3. *`touch:` declares the freshness edge once* — Russian-doll caching with no hand-maintained key. `belongs_to :room, touch: true`: touch the child → parent's `updated_at` bumps → parent fragment's key changes → cache expires through *every* create and destroy path. The key is `updated_at` — derived (P2), never a hand-bumped integer.

4. *`to_key` is the convention bridge for identity itself* — override the one ActiveModel method `dom_id` consults, and the optimistic client node and the server's broadcast share an address (full story in P5).

**Not:** you'll be tempted to type `"room_#{@room.id}_messages"` in the view and re-type it in the broadcast, or to hand-write `room.update(updated_at: Time.current)` — don't. Where convention genuinely can't reach (the client-side optimistic template that can't call the server's partial), make the seam loud with a warning comment at the top of both files. Reserve hand-discipline for exactly the places a function can't absorb.

---

## P5 — One renderer: HTML over the wire

**Statement:** Render HTML on the server once, send that same HTML over every transport, and let identity conventions make the optimistic client node and the server's broadcast converge — so "the HTTP reply" and "the live update" are one feature.

The naive realtime build makes two mistakes. First, it assumes the wire carries *data*, so each end must render — and now page render, the cable's `render_to_string`, and the stream reply are three copies that drift (**the two-renderer drift bug**). Invert it: **the wire carries HTML, not data** — the byte-identical output of one server partial — and the client only places it at a named target. Second, it treats the sender's optimistic bubble as special (broadcast-except-sender, temp-id reconciliation). It isn't — it's the same row; agree on identity from the first keystroke and the de-dupe is deleted, not written.

**Signature moves:**

1. *One partial, every transport* — page load, the POST's turbo_stream reply, the cable broadcast, the edit replace, and the wake-from-sleep diff all render `messages/_message` and address by `dom_id`. Change the partial and every path changes together.

2. *The optimistic-id handshake* — the client draws a placeholder with a UUID it chose; the server adopts it and teaches `dom_id` to speak it:

```ruby
before_create -> { self.client_message_id ||= Random.uuid }   # bots don't care

def to_key
  [ client_message_id ]
end
```

`to_key` is the method `dom_id` consults, so the authoritative broadcast arrives carrying the placeholder's id, and Turbo **replaces in place** instead of stacking a duplicate. (Fizzy reaches the same convergence with `method: :morph`; see `06-morphing-live-updates.md`.)

3. *Two audiences, no branch* — `update` broadcasts a `replace` to spectators and plain-redirects the actor; each path is determined by where the request originated (the actor's submit was inside the edit frame), not an `if current_user ==` check.

4. *Server declares intent as data on the wire* — when the client must behave differently for one update kind, stamp the intent as an attribute (`attributes: { maintain_scroll: true }`) instead of forking a second renderer.

5. *The wire payload shrinks to a word* (Fizzy) — `broadcasts_refreshes` on the model + `turbo_stream_from @board` on the page + morph means the wire carries "refresh" and every browser re-renders the same partials. `touch:` + `broadcasts_refreshes` + `turbo_stream_from` = multiplayer with no bespoke realtime code.

**Not:** you'll be tempted to broadcast JSON and template it client-side, to `render_to_string` a second copy for the cable, or to build broadcast-except-sender channels — don't. The few extra HTML bytes buy an entire layer (serializer, client renderer, schema, reconciler) you never write.

---

## P6 — Model every state change as CRUD on a noun

**Statement:** Any verb you're tempted to bolt onto a controller (ban, reset, mute, open-room) is really the create/update/destroy of a hidden noun — name that noun and the controller collapses to a tiny resourceful seven-actions. Custom member routes accrete: six months in, the controller has fifteen actions, the `only:` guard array has drifted, and the day someone adds an action but not the guard you've shipped an open admin endpoint.

Stop asking "what action is this?" and ask **"what is the thing whose lifecycle is changing?"** Banning is the creation of a `Ban`. Fizzy writes it as law: `resource :closure`, not `post :close` / `post :reopen`.

**Signature moves:**

1. *The two-line CRUD controller* — translate HTTP into one model method call, redirect; the work lives on the model (P1):

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

A model is allowed verbs; a controller is not. `reset_join_code` behind a standard `create` route is a domain method — the web only ever sees the noun's lifecycle.

2. *Routes vocabulary that carries the structure* — singular `resource :ban` because a user has exactly one ban (no meaningless `index`); `scope module: "users"` so the folder tree mirrors the route tree while the URL stays flat; `scope defaults: { user_id: "me" }` so the "my profile" helper needs no argument.

3. *The verb that was a read all along* — opening a room, switching rooms, and following a deep link are all the same `GET #show`. The only real work is choosing the slice: `page_around(message)` for a deep link, `last_page` for a plain open. Before inventing a verb, check whether it's a read you already have.

4. *Even the URL's query state is a noun* (Fizzy) — a board filter is a real `Filter` record, found-or-built from params (`find_by_params(params) || build(params)`) via a canonical digest. The index is one line because the noun owns its own query.

**Not:** you'll be tempted to write `member do post :ban end` and a fat action that opens a session, deletes rows, loops, and flips a status — don't. When an arrangement genuinely must be stored (P2's exception), keep the web shape: Fizzy's slide-a-column-left is `resource :left_position` whose `create` calls `@column.move_left`.

---

## P7 — Polymorphism over conditionals

**Statement:** Every if-this-type / elsif-that-type branch is a polymorphism you haven't named yet — push the difference into a subclass, an enum, or a `super` call, and the case statement disappears along with the bugs in its branches. The branch metastasizes into the model, controller, view, and pusher: four copies that must agree forever. **The branch was a missing abstraction** — the cost isn't the `if`, it's the copies.

**Signature moves:**

1. *STI: subclasses override only the seam* — one `rooms` table, a `type` column, three subclasses. `Rooms::Direct` overrides exactly one method; `Rooms::Closed` is a **literally empty class** because "closed" is the default behavior:

```ruby
def default_involvement = "mentions"       # the base

class Rooms::Direct < Room
  def default_involvement = "everything"   # the ENTIRE difference
end

class Rooms::Closed < Room
end
```

Predicates ask the object, never a column: `def direct? = is_a?(Rooms::Direct)`. Conversion recasts: `@room = @room.becomes!(Rooms::Open)` so the new subclass's callbacks fire, and `type_previously_changed?(to: "Rooms::Open")` gates the re-grant to fire only on actual conversion.

2. *Enum as a query vocabulary; the disabled state is the absence of a merge* — four exclusive notification tiers as one ordered enum, not three booleans encoding eight typeable states:

```ruby
enum :involvement, %w[ invisible nothing mentions everything ].index_by(&:itself), prefix: :involved_in
```

The pusher composes scopes like English (`relevant_subscriptions.merge(Membership.involved_in_everything)`) — and there's *no code at all* for muted: `invisible`/`nothing` simply have no `.merge`. Code that doesn't exist can't have a bug.

3. *Controller inheritance + super: the bot path IS the human path* — `Messages::ByBotsController < MessagesController` overrides only `message_params` and calls `super`; auth, lookup, creation, broadcast all inherited. **Capability by subtraction:** a bot is a `User` with `role: :bot`, denied by `deny_bots`, and `allow_bot_access only: :create` removes one denial on one action.

4. *The branch-erasing move holds at every altitude* (Fizzy) — the `Eventable` concern is a template-method loop: `eventable_prefix` derives the action name from `self.class.name`; the view dispatches by *computed partial name* (`render "events/event/eventable/#{event.action}"` guarded by `lookup_context.exists?`) — dozens of event types, zero `case`; adding one is dropping a file.

**Not:** you'll be tempted to add a `kind` string column and branch on it, to model exclusive states as a fistful of booleans, or to fork an `Api::MessagesController` — don't. The fork drifts the day the human path grows a feature the copy doesn't.

---

## P8 — Give behavior a home

**Statement:** A model's include list is its table of contents; each concern files a trait where it belongs — host-changing wiring inside `included do`, plain behavior in the module body, the named constructor beside the trait it builds — so you know what a class can do before reading a method. The problem with the 300-line god model isn't length; it's that a trait's pieces are *scattered*, so they drift and you can't find them. The `MessageService` escape hatch makes it worse: now the trait is a service plus a fan of hand-synced call sites.

**The include line IS the spec**: `include Attachment, Broadcasts, Mentionee, Pagination, Searchable` (Campfire's Message stays 44 lines); Fizzy's `Card` runs one include to twenty-four traits and stays 95 lines.

**Signature moves:**

1. *The three-region grammar* — `ActiveSupport::Concern` gives a trait's three kinds of thing exact homes. **`included do` is the wiring harness** (the only place a scope, callback, or association can attach); the module body holds plain behavior; `class_methods do` holds the named constructor:

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

That concern is a *complete production full-text search feature* in ~25 lines — indexed, self-syncing, chainable, which is why `Current.user.reachable_messages.search(query).last(100)` composes auth + search + pagination on one line. Keep trait scopes chainable Relations, never methods returning arrays.

2. *Co-location makes desync unwriteable* — Avatar's mint (`signed_id(purpose: :avatar)`) and verify (`find_signed!(sid, purpose: :avatar)`) sit eight lines apart in one module, so the round-trip can't drift to different purposes. The callback that fires `create_in_index` sits directly above the method it calls.

3. *The concern is where the other principles' outputs live* — P1's owned consequences file under their trait (`Bannable` owns `remove_banned_content_later`); P3's ambient gates install themselves from `included do`; P9's `_later` wrapper sits next to its synchronous twin.

**Not:** you'll be tempted to open the class and add one more method (the file grows by fifty buried lines), or to peel logic into a `FooService` (the trait loses its home) — don't. Add a concern and add its name to the include line: the file grows by one readable word. The "action at a distance" worry is answered by naming — the host advertises which modules wire into it, on line one, in order.

---

## P9 — Put work at its right altitude

**Statement:** Decide for every unit of work whether it runs in-band (cheap, must be durable for the response) or out-of-band (slow, flaky, fan-out), and make the seam the thinnest possible thread boundary — a two-line job that only exists to be on another thread.

The naive everything-in-one-callback version grows four bugs that are all the same bug — work at the wrong altitude: N sequential UPDATEs where one bulk statement would do; the sender's request blocking on fifty push gateways; `after_save` firing *inside* the transaction so a rollback ships notifications for a vanished row (**the ghost row**); re-notification on every edit. The cut: In-band = cheap and the response would lie without it. Out-of-band = anything the sender should never wait on. Altitude is a *correctness* boundary, not a performance tactic.

**Signature moves:**

1. *The `_commit` trigger and the explicit split* — **_commit means after-durable**: a rolled-back row can never reach a worker. The receiving method draws the line out loud, one named intent per altitude:

```ruby
after_create_commit -> { room.receive(self) }

def receive(message)
  unread_memberships(message)   # in-band: one bulk update_all
  push_later(message)           # out-of-band: enqueue and return
end

def unread_memberships(message)
  memberships.visible.disconnected.where.not(user: message.creator)
    .update_all(unread_at: message.created_at, updated_at: Time.current)
end
```

No `each`, no N+1 — the in-band half is one statement.

2. *Jobs are thunks* — every job is the same ~3-line shape (Fizzy's `STYLE.md` states it as law):

```ruby
class Room::PushMessageJob < ApplicationJob
  def perform(room, message)
    Room::MessagePusher.new(room:, message:).push
  end
end
```

The logic stays on the model where it's synchronously testable; the job exists only to be on another thread. Pass *records*, not ids — Active Job serializes them as GlobalIDs; never write `find(id)` at the top of a `perform`.

3. *The guard lives on the `_later` wrapper, not in the job* — the precondition runs once, synchronously, before the enqueue, so the worker never re-checks and ineligible work is never enqueued:

```ruby
def deliver_webhook_later(message)
  Bot::WebhookJob.perform_later(self, message) if webhook   # the guard
end

def deliver_webhook(message)
  webhook.deliver(message)                                  # the work
end
```

4. *The lowest altitude: escaping the Rails executor* — work needing a raw thread pool (thousands of push deliveries) moves to `lib/`, and the iron rule is **do all Active Record reads before posting to threads** — by the time work crosses into the pool it carries a plain object and an integer:

```ruby
def deliver_later(payload, subscription)
  notification    = subscription.notification(**payload)   # AR reads happen here
  subscription_id = subscription.id
  delivery_pool.post { deliver(notification, subscription_id) }
end
```

**Not:** you'll be tempted to hang everything on one `after_save`, to stuff the real logic into the worker (trapped behind a queue you must boot to test), or to put the precondition inside the job — don't. The altitude question is decided *per consequence*, at the seam: marking-unread rides the `_commit` callback (true of every message) while broadcasting stays an explicit method (differs by call path).

---

## 12. The dependency graph

The nine principles are a dependency graph — read the arrows as **"makes possible,"** not "comes before." Apply them as a system.

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
             ▼  (shared derived address + shared identity ⇒ one rendering hits every transport)
            P5  one renderer, HTML over the wire

            P6  CRUD on a noun      ┐
            P7  polymorphism        │  ← THE COMPRESSORS: keep everything small
            P8  give behavior a home│     so the first six stay readable
            P9  right altitude      ┘
```

"Fat model, skinny controller" is the *forced consequence* of this graph: the model owns the truth (P1), so you derive its projections (P2), load through the user (P3), let conventions carry identity (P4) and rendering (P5), name the noun (P6), give the kind its difference (P7), file each trait (P8), and run each piece at its altitude (P9). The controller is the small boring seam left over.

When you meet a design decision mid-task, locate it on the graph:

- "where does this code go?" → P1/P8/P9
- "do I need a column/table?" → P2
- "how do I authorize this?" → P3 (usually dissolves into P6's load line)
- "how do I keep these in sync?" → P4
- "how does this reach the screen?" → P5
- "what route/action?" → P6
- "if type ==" in your draft → P7