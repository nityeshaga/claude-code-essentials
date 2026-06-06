# Active Record the 37signals Way

Read this when you are writing, reviewing, or restructuring anything in `app/models` — a new model, a callback, a scope, an enum, a state flag, or a file that is getting long.

**Contents**
1. [The model is the single source of truth](#1-the-model-is-the-single-source-of-truth)
2. [The callback lifecycle and the `_commit` discipline](#2-the-callback-lifecycle-and-the-_commit-discipline)
3. [Callback vs explicit method — whose fact is this?](#3-callback-vs-explicit-method--whose-fact-is-this)
4. [Compute before save, act after commit](#4-compute-before-save-act-after-commit)
5. [Associations carry their options](#5-associations-carry-their-options)
6. [Association-extension blocks own the relationship's verbs](#6-association-extension-blocks-own-the-relationships-verbs)
7. [Scopes are chainable Relations, never arrays](#7-scopes-are-chainable-relations-never-arrays)
8. [Enums: one line, a whole vocabulary](#8-enums-one-line-a-whole-vocabulary)
9. [STI: the difference lives in the subclass](#9-sti-the-difference-lives-in-the-subclass)
10. [Polymorphism at the model layer: template-method concerns](#10-polymorphism-at-the-model-layer-template-method-concerns)
11. [Truth without a table: PORO models](#11-truth-without-a-table-poro-models)
12. [State as row existence](#12-state-as-row-existence)
13. [Derive, don't store — applied to columns](#13-derive-dont-store--applied-to-columns)
14. [Concerns: the three-region grammar](#14-concerns-the-three-region-grammar)
15. [Red flags → fixes](#15-red-flags--fixes)

Scope: everything that lives in `app/models`. The authorization shape (`reachable_messages`, load-through-the-user) is `10-auth-security.md`. Where work *runs* — jobs, `_later` methods, the sync/async line — is `08-jobs-background-work.md`. Cache keys and `touch:`'s caching payoff are `09-caching-performance.md`. Broadcast/morph wire mechanics are `06-morphing-live-updates.md`. This file owns *what the model declares*; those files own what happens downstream.

---

## 1. The model is the single source of truth

**When:** always — this is the frame everything else in this file hangs from.

**Do:** treat the database schema as the one and only list of what a model *has*. Active Record reads the schema at boot and defines every attribute accessor. A record is the single source of truth about a fact; every other representation of that fact (a badge, a flag, a count, a status) must be computed *from* it, never stored beside it.

**Not:** you will be tempted to declare a `FIELDS` constant, an `attr_accessor` for a column that already exists, a serializer schema that re-lists attributes, or a "summary" column that copies what other rows already say. Don't. **A stored copy is a second source of truth** and it will eventually disagree with the first.

**Why:** every duplicate list is a sync obligation. Campfire's `message.rb` is 44 lines and declares not a single field — the migration is the list. Count the edge cases this line absorbs for free: rename a column and there's exactly one place that knows it.

The five tools the model layer gives you — associations, validations, callbacks, scopes, enum/STI — each exist to absorb one class of placement bug. The rest of this file is those tools, the 37signals way.

---

## 2. The callback lifecycle and the `_commit` discipline

**When:** any time you hook the save lifecycle — and especially any time the hook touches the world outside the database (a job, a push, an email, a broadcast).

The lifecycle is a timeline, and `COMMIT` is a line on it:

```
 validations → before_save → before_create/update → INSERT/UPDATE → after_create/update → after_save → COMMIT → after_*_commit
 |________________________ inside the transaction (can still ROLL BACK) ________________________|        |__ durable, real __|
```

Everything with a plain name (`after_save`, `after_create`, `after_update`) fires *inside* the open transaction — the row exists provisionally and can still be rolled back. Everything with the `_commit` suffix fires after the transaction is durable. **`_commit` means after-durable.**

**Do:** for any consequence that crosses the database boundary — push notifications, jobs, broadcasts, emails — use the `_commit` flavor:

```ruby
after_create_commit -> { room.receive(self) }   # (Campfire) fires only once the row is permanently real
```

Fizzy reaches for the same suffix in the same situation: `after_create_commit :watch_card_by_creator` auto-watches a card only once the comment is durable. Two products, same suffix on the same line — this is doctrine.

**Not:** you will be tempted to write plain `after_create` because it looks identical and works in every test. Don't. If the transaction rolls back after the hook fired, the database quietly undoes the row but the phone already buzzed — you've notified fifty people about a message that no longer exists. That bug class is **the ghost row**, and the fix is exactly one suffix.

**When plain `after_save` IS correct:** work that stays *inside* the database — bumping a counter column, stamping a denormalized field, writing a child row that belongs to the same logical unit — *should* roll back with everything else if the save fails. Plain callbacks keep that work atomic with the row. The rule is not "always `_commit`"; it's: **match the callback to whether the consequence belongs to the transaction or to the durable outside world.**

| Consequence | Callback |
|---|---|
| Enqueue a job, send a push/email, broadcast to live screens | `after_*_commit` |
| Write/update sibling rows that must be atomic with this save | plain `after_save` / `after_create` |
| Stamp a default on the row itself before it's written | `before_create` / `before_save` (e.g. Campfire's `before_create -> { self.client_message_id ||= Random.uuid }`) |
| Sync an external-ish index that must never reference a rolled-back row | `after_create_commit` / `after_update_commit` / `after_destroy_commit` as a symmetric trio (Campfire's FTS index) |

---

## 3. Callback vs explicit method — whose fact is this?

**When:** a record's creation has consequences and you're deciding where the consequence code goes. This is the single highest-leverage decision in the model layer.

**Do:** ask one question of each consequence: **whose fact is this?**

- True for **every record that exists**, regardless of how it was born (bot, import, seed, interactive send) → it's a property of the record. **The model owns the consequence.** Make it a callback.
- True only because of **how this particular record came into being** (an interactive send, right now, with people watching) → it's a property of the call path. Make it a plain explicit method, called at each call site that wants it.

Campfire holds both answers one line apart, wired in opposite directions *on purpose*:

```ruby
class Message < ApplicationRecord
  after_create_commit -> { room.receive(self) }   # every message that exists marks others unread — record's fact, callback
end

module Message::Broadcasts                        # plain module: no included do, no callback registration
  def broadcast_create
    broadcast_append_to room, :messages, target: [ room, :messages ]
    ActionCable.server.broadcast("unread_rooms", { roomId: room.id })
  end
end

# call sites that SHOULD broadcast call it explicitly:
@message.broadcast_create                                            # interactive controller
room.messages.create!(body: text, creator: user).broadcast_create   # bot webhook reply
```

A seed run never calls `broadcast_create`, so it never shoves three years of history onto live screens — and nobody needed a flag to make that true.

**Not:** you will be tempted to bind everything to `after_create_commit` and then, when seeds start spraying broadcasts, bolt on `attr_accessor :skip_broadcast` and thread it through every call site. Don't. **The flag is the smell.** The moment you write `skip_broadcast`, you've admitted the consequence isn't a property of the record — you're pushing a call-site decision down into model state and reading it back out. If a consequence needs to know *who called*, it belongs to the caller.

**Why:** this question — not the "fat model, skinny controller" slogan — is what empties controllers. File each consequence where it's actually true and the controller has nothing left to orchestrate; it shrinks to "translate HTTP into a method call" on its own.

---

## 4. Compute before save, act after commit

**When:** a `_commit`-side effect needs to know **what changed**. Dirty flags (`title_changed?`, `column_id_changed?`) are live only *during* the save; by the time `after_*_commit` runs, Active Record has reset them — they answer `false`, every time.

**Do:** split the work across the lifecycle: stash the verdict in plain Ruby memory before the write, read it after commit. Fizzy's Card does exactly this with two cooperating callbacks:

```ruby
module Card::Broadcastable          # (Fizzy)
  extend ActiveSupport::Concern

  included do
    broadcasts_refreshes
    before_update :remember_if_preview_changed
  end

  private
    def remember_if_preview_changed
      @preview_changed ||= title_changed? || column_id_changed? || board_id_changed?
    end

    def preview_changed?
      @preview_changed
    end
end

module Card::Pinnable               # (Fizzy) the other side of the COMMIT line
  extend ActiveSupport::Concern

  included do
    has_many :pins, dependent: :destroy
    after_update_commit :broadcast_pin_updates, if: :preview_changed?
  end

  private
    def broadcast_pin_updates
      pins.find_each do |pin|
        pin.broadcast_replace_later_to [ pin.user, :pins_tray ], partial: "my/pins/pin"
      end
    end
end
```

`before_update` fires while the dirty flags still answer truthfully and freezes the verdict into `@preview_changed` — an instance variable the closing transaction can't reset. `after_update_commit ..., if: :preview_changed?` reads the stash, not the (now-dead) flags. The two callbacks are the two ends of a measurement that has to straddle the transaction boundary.

**Not:** you will be tempted to check the dirty flag *inside* the `_commit` hook — the guard is always false and the broadcast silently never fires. Or to reach for `saved_change_to_title?` — which works but couples the broadcast to one named attribute, and you'll forget to add the next one. Don't pick one side of the line; straddle it.

**Why:** the computation is only knowable before save; the broadcast is only safe after commit (otherwise you push a preview update for a save that rolls back — the ghost row in a different coat). One callback can't be in both places; two callbacks plus an ivar can.

---

## 5. Associations carry their options

**When:** declaring any `belongs_to` / `has_many` / `has_one`. The declaration line is where leverage hides — load options onto it instead of scattering them through call sites.

**Do:**

```ruby
belongs_to :room, touch: true                                       # save/destroy bumps room.updated_at — cache wiring in one token
belongs_to :creator, class_name: "User", default: -> { Current.user }  # the model owns the default
has_many :boosts, dependent: :destroy
```

- **`default: -> { Current.user }`** — the association supplies the creator; no controller threads `creator_id: current_user.id` through every call site and forgets it in the webhook. Both products use this *byte-for-byte identical* line on their core noun, and Fizzy pushes it further: `belongs_to :account, default: -> { board.account }` derives a non-user association from ambient context the same way. Doctrine.
- **`touch: true`** — wires a cache-freshness dependency through every create and destroy path in one token. (What the bumped `updated_at` buys you — recursive cache keys, `broadcasts_refreshes` — is `09-caching-performance.md` and `06-morphing-live-updates.md`. Declare it here; collect there.)
- **`class_name:`** — name the association after the *role* (`creator`, `closed_by`), point it at the class. The role name is the API; the class is an implementation detail.
- **`dependent:` — choose deliberately:**

| Variant | Behavior | Use when |
|---|---|---|
| `dependent: :destroy` | loads each child, runs its callbacks/destroy | children have their own consequences (e.g. a Pin that must broadcast its removal) |
| `dependent: :delete_all` / `:delete` | one SQL DELETE, no instantiation, no callbacks | children are pure data with nothing to clean up (Campfire: `has_many :memberships, dependent: :delete_all`, `has_one :webhook, dependent: :delete`) |

**Not:** you will be tempted to set defaults in controllers, to skip `touch:` and invalidate caches by hand, and to default every association to `dependent: :destroy` without asking whether the children have callbacks worth running. Each of those moves a fact off the declaration line and into N call sites.

**Why:** an option on the association fires on *every* path — webhook, console, seed, future controller — because it lives where the relationship lives. Count the edge cases the one token absorbs for free.

---

## 6. Association-extension blocks own the relationship's verbs

**When:** a relationship has its own grammar — grant, revoke, revise; not just "create a row."

**Do:** open a block on the `has_many` and define the verbs on the collection itself:

```ruby
has_many :memberships, dependent: :delete_all do    # (Campfire)
  def grant_to(users)
    room = proxy_association.owner
    Membership.insert_all(Array(users).collect { |user| { room_id: room.id, user_id: user.id, involvement: room.default_involvement } })
  end

  def revoke_from(users)
    destroy_by user: users
  end

  def revise(granted: [], revoked: [])
    transaction do
      grant_to(granted) if granted.present?
      revoke_from(revoked) if revoked.present?
    end
  end
end
```

`room.memberships.grant_to(users)` reads like a sentence and runs **one** `insert_all` instead of N saves. `proxy_association.owner` is the room, so the insert is stamped with *that room's* `default_involvement` — a Direct room and an Open room each get the right default for free (see §9: `default_involvement` is the STI seam). `revise` wraps grant-and-revoke in one transaction so every caller — controller, webhook, console script — gets atomicity without re-implementing it.

Fizzy's version of the same instinct is the transactional model verb: `Card#triage_into` wraps `resume; update!; track_event` in one `transaction do … end`, and *two* call paths (drag-and-drop, explicit triage button) call that one verb, so the logic lives exactly once.

**Not:** you will be tempted to loop in the controller — `users.each { room.memberships.create!(user_id: ..., involvement: "mentions") }`. Don't: N inserts; a hardcoded involvement that's silently wrong for Direct rooms; revoke as a separate untransactioned loop; and the same verbs re-typed slightly differently in the webhook and a console script, free to drift.

**Why:** the collection owning the grammar means every caller speaks the same verbs. It's also what lets orchestration PORO models (§11) stay one-liners: `FirstRun` writes `room.memberships.grant_to administrator` instead of re-implementing membership creation.

---

## 7. Scopes are chainable Relations, never arrays

**When:** any named query. The whole point of `scope` is that it returns an unexecuted `Relation` you can keep chaining — that property is non-negotiable.

**Do:** declare small composable scopes and snap them together:

```ruby
scope :visible, -> { where.not(involvement: :invisible) }   # (Campfire, Membership)
scope :unread,  -> { where.not(unread_at: nil) }
```

Composition is the payoff. Campfire's entire "who needs an unread badge?" decision is one chain ending in a bulk write — one SQL `UPDATE`, no rows loaded into Ruby, no loop:

```ruby
memberships.visible.disconnected.where.not(user: message.creator)
  .update_all(unread_at: message.created_at, updated_at: Time.current)
```

The same `visible.disconnected` building blocks compose into this UPDATE *and* into the push-notification query. That reuse only exists because each piece stayed a Relation.

**TTL-window scopes — the beginless/endless range idiom.** When a fact is a yes/no *over time* (presence, validity), write it as a range scope over a timestamp, with the threshold as one named constant:

```ruby
CONNECTION_TTL = 60.seconds                                              # (Campfire)
scope :connected,    -> { where(connected_at: CONNECTION_TTL.ago..) }    # beginless: from 60s ago to forever
scope :disconnected, -> { where(connected_at: [ nil, ...CONNECTION_TTL.ago ]) }  # array folds NEVER (nil) + STALE (endless range)

scope :active, -> { where(expires_at: Time.current...) }                 # (Fizzy, MagicLink) same idiom for validity
scope :stale,  -> { where(expires_at: ..Time.current) }
```

**The NULL-dropping trap:** the raw comparison you'll reach for — `where("connected_at < ?", 60.seconds.ago)` — **silently drops every row where the column is NULL**. Users who never connected vanish from `disconnected` and miss their notifications. The `[ nil, ...range ]` array form folds never-connected and gone-stale into one `where`. Always handle the NULL case explicitly when a timestamp can be absent.

**Scope-of-scopes — URL-token dispatch.** Let the controller speak intent and the model own the SQL by mapping a parameter onto named scopes:

```ruby
scope :reverse_chronologically, -> { order(created_at: :desc, id: :desc) }   # (Fizzy, Card)
scope :chronologically,         -> { order(created_at: :asc, id: :asc) }

scope :sorted_by, ->(sort) {
  case sort
  when "newest" then reverse_chronologically
  when "oldest" then chronologically
  else latest
  end
}
```

The controller writes `cards.sorted_by(params[:sort])`; `?sort=oldest` is the contract, the SQL never leaks upward. (The `case` here is fine — it dispatches *between named scopes* in one place, the opposite of the scattered `if kind ==` that §9 deletes.)

**The composable scope ladder — pagination from five tiny rungs.** Because every scope stays a Relation, pagination needs no gem and no offset arithmetic — just small scopes snapped into bigger ones. Campfire's entire message pagination is one concern:

```ruby
module Message::Pagination             # (Campfire)
  extend ActiveSupport::Concern

  PAGE_SIZE = 40

  included do
    scope :last_page,  -> { ordered.last(PAGE_SIZE) }
    scope :first_page, -> { ordered.first(PAGE_SIZE) }

    scope :before, ->(message) { where("created_at < ?", message.created_at) }
    scope :after,  ->(message) { where("created_at > ?", message.created_at) }

    scope :page_before, ->(message) { before(message).last_page }
    scope :page_after,  ->(message) { after(message).first_page }

    scope :page_created_since, ->(time) { where("created_at > ?", time).first_page }
    scope :page_updated_since, ->(time) { where("updated_at > ?", time).last_page }
  end

  class_methods do
    def page_around(message)
      page_before(message) + [ message ] + page_after(message)
    end

    def paged?
      count > PAGE_SIZE
    end
  end
end
```

Read the ladder bottom-up. `before`/`after` are bare time filters. `page_before` is `before` *plus* `last_page` — a rung built by chaining two existing rungs, never by re-typing their SQL. `page_around` is the top: a class method gluing `page_before + [ message ] + page_after` into the deep-link slice ("a page before it, the message itself, a page after it"). One constant, `PAGE_SIZE`, governs every rung, so the page size cannot drift between scopes.

`page_around` returns an array — and that's correct *here*, because it's terminal: the last step before render, where nothing further will chain. Build with Relations; collapse to an array only at the edge, on purpose, in one named place.

The ladder is what lets a single controller render path serve every way of opening a room — `page_around(message)` for a deep link, `last_page` for a plain open (the one-`#show` move is `03-controllers-routing.md`). And the two `_since` rungs are the wake-from-sleep catch-up diff: "messages created since this timestamp, messages updated since this timestamp," each answer already capped at one page (the turbo_stream response that consumes them is `05-turbo-frames-streams.md`).

**Not:** you will be tempted to write `def self.search(q)` or an instance method that returns `.select { ... }` — an array. Don't. The moment a query method returns an array it stops composing: nothing can chain `.last(100)` or an auth boundary onto it, `update_all` is unreachable, and you're filtering in Ruby what the database does in SQL. (The composition that matters most — chaining a scope onto the authorization shape — is `10-auth-security.md`.)

**Why:** scopes are query Lego. A Relation defers execution, so authorization, search, ordering, pagination, and bulk writes all snap onto one another; an array is a dead end.

---

## 8. Enums: one line, a whole vocabulary

**When:** a column holds one of a fixed set of words — a status, a tier, a role.

**Do:**

```ruby
enum :involvement, %w[ invisible nothing mentions everything ].index_by(&:itself), prefix: :involved_in   # (Campfire)
enum :status, %w[ drafted published ].index_by(&:itself)    # (Fizzy) — same string-backed form
enum :role, %i[ member administrator bot ]                  # (Campfire) — integer-backed, deliberate
```

One declaration generates a whole family, per value: a predicate (`membership.involved_in_everything?`), a bang-setter (`membership.involved_in_everything!`), and a class **scope** (`Membership.involved_in_everything`). They derive from one line, so they cannot drift.

- **String-backed (`%w[...].index_by(&:itself)`)** stores the human-readable word in the column — rename-safe, reorder-safe, legible in a raw DB query. Both products use this form for domain state; it is the house default.
- **Integer-backed (plain array)** is the deliberate exception for cold, ordinal, never-renamed values like `role`. Choose per column, on purpose.
- **`prefix:`** namespaces the family (`involved_in_everything?`) so multiple enums on one model can't collide.

The generated scopes become a query vocabulary that reads like English:

```ruby
relevant_subscriptions.merge(Membership.involved_in_everything)                                # (Campfire) the "everything" tier
relevant_subscriptions.merge(Membership.involved_in_mentions).where(user_id: mentionees.ids)   # the "mentions" tier
```

And the punchline: there is no code for *muted*. `invisible` and `nothing` simply have no `.merge` written for them, so those members are never in the set the pusher iterates. **Muted is the absence of a merge** — silence implemented by silence, and code that doesn't exist can't have a bug.

**Not:** you will be tempted to model mutually exclusive states as separate booleans — `muted`, `mentions_only`, `hidden`. Don't. **Three booleans encode eight typeable states for four real ones**; half are impossible-but-storable (`muted: true, mentions_only: true` means what?), every query becomes a `where(muted: false).or(...)` thicket, and nothing enforces exclusivity. One enum column holds one of the listed words — exhaustive and exclusive *by construction*. Equally: never hand-write `def everything?` or copy-paste `where(involvement: "everything")` across files — the enum already generated both, and hand copies drift the day someone renames a value.

---

## 9. STI: the difference lives in the subclass

**When:** records of one noun come in kinds that behave *almost* identically — a DM vs an open channel vs an invite-only room.

**Do:** one table, a `type` column, subclasses that override **only their one difference**. The base class holds everything common, including the default behavior:

```ruby
class Room < ApplicationRecord       # (Campfire) the base owns the default
  def default_involvement
    "mentions"
  end

  def open?    = is_a?(Rooms::Open)
  def closed?  = is_a?(Rooms::Closed)
  def direct?  = is_a?(Rooms::Direct)
end

class Rooms::Direct < Room           # entire behavioral diff: one method
  def default_involvement
    "everything"
  end
end

class Rooms::Closed < Room           # literally empty — "closed" IS the base behavior
end
```

The empty subclass is the lesson: it's **the default made silent**. The naive `elsif kind == "closed"` branch would only ever restate the default; the empty class says "this kind adds nothing" out loud and adds zero code.

**Predicates:** write `is_a?` checks against the class, never `kind == "direct"` comparisons against a column. The runtime already knows what it's holding; a stored string is a second copy that can drift from the object.

**Conversion:** to change a record's type, recast the Ruby object with `becomes!` so the *new* subclass's callbacks fire on save — never flip a column and then *remember* the downstream consequences by hand:

```ruby
@room = @room.becomes!(Rooms::Open)            # (Campfire) controller before_action recasts the instance

class Rooms::Open < Room
  after_save_commit :grant_access_to_all_users

  private
    def grant_access_to_all_users
      memberships.grant_to(User.active) if type_previously_changed?(to: "Rooms::Open")
    end
end
```

`type_previously_changed?(to: "Rooms::Open")` is free dirty-tracking: the grant fires only on the save that actually flipped the type — never re-fires on later edits, no manual "did we already grant?" flag.

**Not:** you will be tempted to add a `kind` string column and branch on it. Don't. The `if kind ==` is not contained — it metastasizes into the model, the controller, the view, and the pusher: four copies that must agree forever. Add a fourth kind and you go hunting for every branch and pray; miss one and the new type silently inherits the wrong behavior. **Every type-conditional is a polymorphism you haven't named yet.** The subclass writes the difference once, in the one file named after the difference, and every call site dispatches for free — you're not adding a class, you're deleting the other three copies of the branch.

---

## 10. Polymorphism at the model layer: template-method concerns

**When:** many models share one mechanism (an activity ledger, a tracking pipeline) but each kind needs its own twist — the situation that tempts a central `case` on type.

**Do:** put the mechanism in one concern that derives names from the class and exposes empty hooks; let each model override its own seams. Fizzy's event ledger:

```ruby
module Eventable                      # (Fizzy) the shared mechanism — a template-method loop, not a dispatcher
  extend ActiveSupport::Concern

  def track_event(action, creator: Current.user, board: self.board, **particulars)
    if should_track_event?
      board.events.create!(action: "#{eventable_prefix}_#{action}", creator:, board:, eventable: self, particulars:)
    end
  end

  def event_was_created(event)        # empty hook: what happens next belongs to the noun
  end

  private
    def should_track_event?           # template method: default answer, overridable per kind
      true
    end

    def eventable_prefix              # the class names itself — no case statement builds "card_created"
      self.class.name.demodulize.underscore
    end
end

module Card::Eventable                # (Fizzy) one noun fills in exactly its two seams
  def event_was_created(event)
    transaction do
      create_system_comment_for(event)
      touch_last_active_at unless was_just_published?
    end
  end

  private
    def should_track_event?
      published?                      # cards only track events once published
    end
end
```

Read what's *missing*: no `case self when Card ... when Comment ...` builds the action name — `eventable_prefix` asks the object its own class. No `if is_a?(Card) && published?` gate — `should_track_event?` is overridden on the card's own turf. Adding a new eventable noun is `include Eventable` plus, optionally, two overrides — never a new arm on a `case` the ledger must grow forever.

**Polymorphic forwarding deletes `is_a?` too.** When heterogeneous objects must all answer one question, give each its own one-line answer instead of interrogating the kind at the call site:

```ruby
class Card    < ApplicationRecord; def card = self; end          # (Fizzy) the Card IS its own card
class Event   < ApplicationRecord; delegate :card, to: :eventable; end
class Mention < ApplicationRecord; delegate :card, to: :source;    end
class Comment < ApplicationRecord; belongs_to :card; end
```

Now `source.card` works for every node in the graph with zero `if source.is_a?(Card)` anywhere.

**Not:** you will be tempted to centralize: one `EventTracker` with a `case eventable_type` that knows every model's rules. Don't — every new noun edits the central switch, and the switch's knowledge of each model drifts from the model. Ask the object; never interrogate a stored kind.

**Why:** same move as STI one level up — the type supplies the name and the behavior. The mechanism stays a fixed loop no matter how many kinds exist.

**Adapter-name dispatch — polymorphism over an entire SQL dialect.** When one model must speak two databases (Fizzy ships open-source on SQLite and hosted on MySQL), the conditional you'd reach for — `case connection.adapter_name` sprinkled through every query method — is the same metastasizing branch as `if kind ==`, one level down. Delete it the same way: let the adapter name pick a module, once, at class-load:

```ruby
class Search::Record < ApplicationRecord      # (Fizzy)
  include const_get(connection.adapter_name)  # "SQLite" → Search::Record::SQLite; "Trilogy" (MySQL) → Search::Record::Trilogy
end

module Search::Record::SQLite                 # the FTS5 dialect
  extend ActiveSupport::Concern

  included do
    scope :matching, ->(query, account_id) {
      joins("INNER JOIN search_records_fts ON search_records_fts.rowid = #{table_name}.id")
        .where("search_records_fts MATCH ?", query)
    }
  end
end

module Search::Record::Trilogy                # the MySQL dialect — the SAME scope name, its own SQL
  extend ActiveSupport::Concern

  included do
    scope :matching, ->(query, account_id) do
      full_query = "+account#{account_id} +(#{Search::Stemmer.stem(query)})"
      where("MATCH(#{table_name}.account_key, #{table_name}.content, #{table_name}.title) AGAINST(? IN BOOLEAN MODE)", full_query)
    end
  end
end
```

Read the include line as a sentence: *mix in the module named after whatever database I'm connected to.* Both modules define the same `scope :matching` — the shared scope name IS the contract — and each implements it in its own dialect (FTS5 rowid-join + `MATCH` vs `MATCH … AGAINST … IN BOOLEAN MODE`). The branch is resolved exactly once, at class-load, by which module got mixed in; every caller writes `matching(query, account_id)` and never asks which engine it's on. There is no `if adapter ==` anywhere in query code and no place to add one — the convention erased the conditional before it could spread.

**Not:** you will be tempted to branch on `connection.adapter_name` (or `Rails.env`) inside each query method, one arm per dialect. Don't. Every new query is a new place to remember the fork, and the day one method forgets the MySQL arm, the feature silently breaks on exactly one of your two builds.

**Why:** same template-method instinct, turned outward across a database engine: ask the connection what it is once, then dispatch through a name instead of interrogating a kind at every call site. Campfire absorbs the rolled-back row with `_commit`; Fizzy absorbs the whole SQL dialect with one `const_get`. (The full search feature this serves — the polymorphic multi-model index, the authorized by-id teleport — is `11-worked-features.md`.)

---

## 11. Truth without a table: PORO models

**When:** a model-shaped truth has no database rows behind it — a fixed catalog, or an orchestration that spans several tables.

**Do:** write a plain Ruby class in `app/models` that *quacks like* Active Record — borrow the resourceful vocabulary (`find_by_name`, `create!`) so callers can't tell the difference.

**The catalog:** a `Struct` value object plus an `index_by` lookup gives controllers `find_by_name` with zero schema and zero round-trips:

```ruby
class Sound                                                # (Campfire) in-memory catalog
  class Image < Struct.new(:asset_path, :width, :height)   # the value object
    def initialize(name:, width:, height:)
      super "sounds/#{name}", width, height
    end
  end

  def self.find_by_name(name)
    INDEX[name]                       # no table, no query — a hash lookup
  end

  def self.names
    INDEX.keys.sort
  end

  attr_reader :name, :asset_path, :image, :text

  def initialize(name:, text: nil, image: nil)
    @name = name
    @asset_path = "#{name}.mp3"
    if image
      @image = Image.new(**image)
    else
      @text = text
    end
  end

  BUILTIN = [
    new(name: "56k", image: { name: "56k.webp", width: 79, height: 33 }),
    new(name: "bell", text: "🔔"),
    new(name: "rimshot", text: "plays a rimshot"),
    # ...the rest of the catalog...
  ]

  INDEX = BUILTIN.index_by(&:name)    # the lookup find_by_name reads
end
```

**The orchestrator:** a PORO that borrows `create!` to wire several real tables behind one resourceful call:

```ruby
class FirstRun                        # (Campfire) no table; owns "what it means to set up this app"
  def self.create!(user_params)
    account = Account.create!(name: ACCOUNT_NAME)
    room    = Rooms::Open.new(name: FIRST_ROOM_NAME)
    administrator = room.creator = User.new(user_params.merge(role: :administrator))
    room.save!
    room.memberships.grant_to administrator
    administrator
  end
end
```

The controller calls `FirstRun.create!(user_params)` and reads like any other resourceful create, while three tables get wired behind the name. Note it speaks the association verb from §6 — `grant_to` — instead of re-implementing membership creation.

**Not:** you will be tempted to put the catalog in a YAML file with a loader service, or to smear the multi-table setup across a controller action, or to name the orchestrator `SetupService`. Don't. A model is defined by *owning a truth and behaving like a model*, not by having a table. Borrow the resourceful names; skip the service-object vocabulary.

---

## 12. State as row existence

**When:** modeling a binary state — set up / not set up, closed / open, spent / valid. The reflex is a boolean column. The 37signals move is usually: let the existence of the right rows *be* the state.

**Do — the gate:** derive global state from data that cannot lie:

```ruby
def ensure_user_exists
  redirect_to first_run_url if User.none?    # (Campfire) "fresh install" = no users exist
end
# its mirror, guarding setup from running twice:
redirect_to root_url if Account.any?
```

No `setup_complete` flag. A flag can lie — delete every user and it still says "done" — but `User.none?` asks the truth directly. The data *is* the state machine.

**Do — the satellite row:** for per-record state with metadata, a one-row satellite beats nullable columns. Fizzy's card closing:

```ruby
module Card::Closeable               # (Fizzy)
  extend ActiveSupport::Concern

  included do
    has_one :closure, dependent: :destroy

    scope :closed, -> { joins(:closure) }              # closed iff a closure row joins
    scope :open,   -> { where.missing(:closure) }      # open iff no closure row exists

    scope :recently_closed_first, -> { closed.order(closures: { created_at: :desc }) }
    scope :closed_at_window, ->(window) { closed.where(closures: { created_at: window }) }
    scope :closed_by, ->(users) { closed.where(closures: { user_id: Array(users) }) }
  end

  def closed?   = closure.present?
  def open?     = !closed?
  def closed_by = closure&.user
  def closed_at = closure&.created_at
end

class Closure < ApplicationRecord    # (Fizzy) the ENTIRE storage subsystem for closing
  belongs_to :account, default: -> { card.account }
  belongs_to :card, touch: true
  belongs_to :user, optional: true
end
```

The satellite carries its own metadata as ordinary columns, so "who closed it" and "when" cost nothing extra. Because the row's existence is the state, **destroying the row is the reset**: close is `create_closure!`, reopen is `closure&.destroy` — nothing to un-set. Query with `joins` / `where.missing`; no NULL-vs-false ambiguity exists.

**Do — consume means destroy:** for one-time credentials, a spent credential isn't a flagged row; it's an absent one:

```ruby
scope :active, -> { where(expires_at: Time.current...) }   # (Fizzy, MagicLink) the DB never returns a stale code
scope :stale,  -> { where(expires_at: ..Time.current) }

class << self
  def consume(code)
    active.find_by(code: Code.sanitize(code))&.consume
  end

  def cleanup
    stale.delete_all
  end
end

def consume
  destroy      # spent = gone; replay is impossible because there is no row to find
  self         # returned so the caller can still read it
end
```

No `used` boolean to set, no "is this spent?" check to write; `stale.delete_all` just sweeps what the range scope already ignores. (The full login flow this powers is `10-auth-security.md`.)

**Not:** you will be tempted to add `closed:boolean, closed_at:datetime, closed_by_id:bigint` to the main table — a three-column `update!` on close, a three-column null-out on reopen you must never forget, and every *next* state (golden, archived, not-now) widening the table by three more. Don't. Keep the noun skinny; let each state be its own skinny satellite.

---

## 13. Derive, don't store — applied to columns

**When:** any time you're about to add a column (or table) for a fact that existing data already implies. **Derive, don't store**: replace the stored fact with a *function* of data you already have.

**Read-state — one nullable timestamp serves three surfaces.** The entire unread feature is one column, where presence means unread-since-then and absence means caught up — the null *is* the data:

```ruby
scope :unread, -> { where.not(unread_at: nil) }    # (Campfire, Membership)

def read
  update!(unread_at: nil)
end

def unread?
  unread_at.present?
end
```

Three surfaces derive from it, none stored: the bulk mark-unread is the §7 `update_all` chain; the sidebar dot is a CSS class driven by the same column (`"unread": local_assigns[:unread]`); the OS push badge is computed fresh at notification time — `badge: user.memberships.unread.count`. The badge is never stored, so it can never say 3 while the room is empty. Note also the elegant write-combination: opening a room nulls `unread_at` *in the same `update_all`* that sets `connected_at` — opening *is* reading, no separate `/read` endpoint.

**Not:** a `read_receipts` table (a row per user per message, N+1s forever) plus the `unread_count` integer you bolt on to make it cheap — a counter maintained in two places that drifts the first time a write half-fails. **Flags lie**; functions of data don't.

**Presence — a question about time.** "Online" is not a boolean; it's whether `connected_at` falls inside the §7 TTL window (`CONNECTION_TTL.ago..`). A flag sticks at `true` forever when a laptop lid slams without a clean disconnect, then needs a sweeper cron and a `last_seen_at` to half-fix it. The window self-heals: stop touching the timestamp and you fade to disconnected on your own. Keep the in-memory predicate on the *same constant* so Ruby and SQL can never disagree:

```ruby
def connected?
  connected_at? && connected_at >= CONNECTION_TTL.ago
end
```

**Mentions — derive the User, don't store the name.** An @mention is not a parsed `@token` string. It's an ActionText attachable — a signed global id embedded in the rich-text body, rehydrated to a real `User` on the way out. Extraction is a grep over attachables, not a regex over text:

```ruby
def mentioned_users                                  # (Campfire, Message::Mentionee)
  if body.body
    body.body.attachables.grep(User).uniq
  else
    []
  end
end

module User::Mentionable                             # what makes a User embeddable in rich text
  include ActionText::Attachable

  def to_attachable_partial_path
    "users/mention"
  end

  def to_trix_content_attachment_partial_path
    "users/mention"
  end

  def attachable_plain_text_representation(caption)
    "@#{name}"
  end
end
```

The mention round-trips losslessly: stored as a secure sgid, derived back into the live `User` (a rename shows the new name everywhere), rendered as `@name` for push bodies. The string version — `body.scan(/@(\w+)/)` then `User.where(name: ...)` — breaks on duplicate names, can't survive a rename, can't render an avatar, and forces a re-parse at every consumer.

**The boundary of the rule:** derivation doesn't mean "never store a computed value" — it means **never make the stored value the authority**. A counter you bump by hand is a second source of truth; a cache fragment keyed on `updated_at` is a function with a memo (that distinction is `09-caching-performance.md`'s subject). And sometimes the derivable thing is one you'd swear needs storage: Fizzy has no `position` column on cards — intra-column order is *computed* (`order(last_active_at: :desc, id: :desc)` plus a goldness join), which deletes the entire renumber-on-every-drop ranking subsystem.

---

## 14. Concerns: the three-region grammar

**When:** a model accretes traits — searchable, mentionable, closeable, broadcastable — and the file is becoming a junk drawer; or a trait needs to install wiring (callbacks, scopes, associations) onto its host.

**Why a plain Ruby module isn't enough — the two walls:**
1. A plain module adds instance methods gracefully, but has no graceful way to add **class-level macros** to its host — `after_create_commit` and `scope` are class methods of the host, so you end up hand-writing the `self.included(base)` hook: `def self.included(base); base.after_create_commit :create_in_index; end`.
2. Plain modules give no help with **include order** when one trait's macros depend on another's — they run in the order you typed them and break silently on reorder.

`ActiveSupport::Concern` deletes both, and hands you **three regions with precise, different semantics**. Learning concerns is learning what goes in which region:

| Region | Semantics | What goes there |
|---|---|---|
| `included do ... end` | runs **in the context of the host class** | host-changing macros: callbacks, scopes, associations, `before_action`. **`included do` is the wiring harness.** |
| module body | plain instance methods on the host | the trait's behavior |
| `class_methods do` / `module ClassMethods` | class methods on the host | the trait's **named constructor**, co-located with what it constructs |

The canonical specimen — a complete, production full-text search feature in ~25 lines, all three jobs visible:

```ruby
module Message::Searchable             # (Campfire)
  extend ActiveSupport::Concern

  included do                          # region 1: the wiring harness — changes Message itself
    after_create_commit  :create_in_index
    after_update_commit  :update_in_index
    after_destroy_commit :remove_from_index

    scope :search, ->(query) { joins("join message_search_index idx on messages.id = idx.rowid").where("idx.body match ?", query).ordered }
  end

  private                              # region 2: plain instance behavior
    def create_in_index
      execute_sql_with_binds "insert into message_search_index(rowid, body) values (?, ?)", id, plain_text_body
    end

    def update_in_index
      execute_sql_with_binds "update message_search_index set body = ? where rowid = ?", plain_text_body, id
    end

    def remove_from_index
      execute_sql_with_binds "delete from message_search_index where rowid = ?", id
    end

    def execute_sql_with_binds(*statement)
      self.class.connection.execute self.class.sanitize_sql(statement)
    end
end
```

Three details are doctrine: the callbacks are the `_commit` trio (the index never references a rolled-back row — §2); the trio is *symmetric* (create/update/destroy each get a matching index write, so the index can't drift from the table); and `search` is a `scope`, so it composes with the auth boundary and a limit in one line (`10-auth-security.md`).

**The include line IS the spec.** Each trait lives at `app/models/message/<trait>.rb`, and the model's first line is its table of contents:

```ruby
class Message < ApplicationRecord
  include Attachment, Broadcasts, Mentionee, Pagination, Searchable    # (Campfire — message.rb stays 44 lines)

class User < ApplicationRecord
  include Avatar, Bannable, Bot, Mentionable, Role, Transferable
```

Fizzy's `Card` runs the same move at scale — a single `include` of *twenty-four* traits, while the class file stays under 100 lines. Before reading a method body you know the entire surface area of the noun. The wiring is at a distance, but it isn't action-at-a-distance: the concerns are *named after their traits and listed on line one*, so "how does search work?" is answered by opening one ~25-line file, not by grepping for callbacks.

**Co-location is the safety property — mint/verify can't drift.** When a trait has two halves that must agree on a value, the concern keeps them a few lines apart:

```ruby
module User::Avatar                    # (Campfire)
  extend ActiveSupport::Concern

  included do
    has_one_attached :avatar
  end

  class_methods do
    def from_avatar_token(sid)
      find_signed!(sid, purpose: :avatar)        # verify
    end
  end

  def avatar_token
    signed_id(purpose: :avatar)                  # mint — same purpose:, same eyeful
  end
end
```

Mint (instance) and verify (class constructor) share the identical `purpose: :avatar` in one frame — you physically cannot rename one side and forget the other. Same shape with `purpose: :transfer, expires_in: 4.hours` for transfer links. (Why a signed id beats a tokens table at all is the derive-don't-store of §13; the security framing is `10-auth-security.md`.)

The same constructor-next-to-trait logic puts `create_bot!` inside `User::Bot`'s `ClassMethods` — next to `bot_key` and the webhook delivery methods it produces users for — never marooned in `user.rb` or a `UserFactory`.

**Not:** you will be tempted to (a) keep opening the model file and adding one more method — that's the 300-line junk drawer where "how does search work?" means scrolling; (b) extract a `MessageService.update_index(message)` and sprinkle calls into every create/update/destroy path — now the trait is a service plus a fan of call sites that drift, and forgetting one leaves the index quietly stale; (c) write a plain module with a hand-rolled `self.included` hook. Don't. The complexity isn't hidden by concerns — it's *placed*, and the placement carries information.

**Mechanically, forever:** host-changing macros → `included do`; instance behavior → module body; named constructor → `class_methods do`. (This grammar also works on controllers — a concern whose `included do` registers a `before_action` installs an ambient guard on every endpoint just by being listed; that move belongs to `10-auth-security.md`.)

---

## 15. Red flags → fixes

| Red flag in `app/models` (or a diff) | The fix | Section |
|---|---|---|
| Plain `after_create` firing a job/push/broadcast | `after_create_commit` — `_commit` means after-durable; kills the ghost row | §2 |
| `attr_accessor :skip_broadcast` (or any skip-flag threaded into a callback) | The consequence belongs to the call path — make it an explicit method at the call sites | §3 |
| Dirty-flag check (`title_changed?`) inside an `after_*_commit` | Stash the verdict in a `before_*` callback ivar; read it after commit with `if:` | §4 |
| `creator_id: current_user.id` threaded through controllers | `belongs_to :creator, class_name: "User", default: -> { Current.user }` | §5 |
| Controller loop of `collection.create!(...)` for a relationship verb | Association-extension block: `grant_to` / `revoke_from` / `revise` with `insert_all` + transaction | §6 |
| `def self.something` returning an array; `.select { }` filtering in Ruby | `scope` returning a Relation; compose into `update_all` / auth / pagination | §7 |
| `where("timestamp < ?", t)` on a nullable column | `where(col: [ nil, ...t ])` — the raw comparison silently drops NULLs | §7 |
| Hand-rolled `LIMIT/OFFSET` math or a pagination gem for a simple slice | Composable scope ladder: tiny scopes snapped into bigger ones (`page_before` = `before` + `last_page`; `page_around` glues the deep-link slice) | §7 |
| Two/three booleans encoding one mutually exclusive state | One enum (string-backed `index_by(&:itself)` by default, `prefix:` to namespace) | §8 |
| Hand-written `where(status: "published")` or `def published?` beside an enum | Use the generated scope/predicate family; never duplicate it | §8 |
| `if kind == "x"` branches on a type column, in any layer | STI subclass overriding the one seam; empty subclass for the default kind; `is_a?` predicates | §9 |
| Column flip + manual downstream bookkeeping to convert a type | `becomes!(NewType)` + `type_previously_changed?(to:)` guard on the new subclass's callback | §9 |
| Central `case obj.class.name` / `case eventable_type` dispatcher | Template-method concern: class-derived names, overridable hooks; `delegate` for polymorphic forwarding | §10 |
| `case connection.adapter_name` / dialect `if` inside query methods | `include const_get(connection.adapter_name)` — dialect modules sharing one scope contract, resolved once at class-load | §10 |
| `SetupService`, YAML-catalog-plus-loader, multi-table setup in a controller | PORO model borrowing resourceful verbs (`create!`, `find_by_name`) | §11 |
| `setup_complete` / `closed:boolean` + `closed_at` + `closed_by_id` columns | Row existence as state: `User.none?` gates; satellite row + `joins`/`where.missing`; consume = `destroy` | §12 |
| `unread_count` counter, `online` boolean, stored `@name` mention strings | Derive: nullable timestamp, TTL window scope, ActionText attachables grep | §13 |
| 300-line model; `Service` object + fan of call sites; hand-rolled `self.included(base)` | Concern with the three-region grammar; the include line IS the spec | §14 |

The throughline, in this file's slice: **Rails stays small because each layer trusts a convention at its boundary** — and the model layer is where most of those conventions live. Before you add a column, a flag, a branch, or a service object, **count the edge cases this line absorbs for free** for the conventional move instead. The right declaration usually deletes the subsystem you were about to build.
