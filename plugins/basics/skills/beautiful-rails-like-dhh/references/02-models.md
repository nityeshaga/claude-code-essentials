# Active Record the 37signals Way

For anything in `app/models` — a model, callback, scope, enum, state flag, or a file getting long.

Cross-refs: auth shape → `10-auth-security.md`; jobs/`_later` → `08-jobs-background-work.md`; cache keys/`touch:` → `09-caching-performance.md`; broadcast/morph → `06-morphing-live-updates.md`. This file owns *what the model declares*.

---

## 1. The model is the single source of truth

The schema is the one list of what a model *has*. Active Record reads it at boot and defines every accessor. A record is the single source of truth about a fact; every other representation (badge, flag, count, status) is computed *from* it, never stored beside it.

Don't declare a `FIELDS` constant, an `attr_accessor` for an existing column, or a "summary" column copying other rows. A stored copy is a second source of truth that will eventually disagree with the first. Campfire's `message.rb` is 44 lines and declares zero fields — the migration is the list; rename a column and exactly one place knows it.

The five model-layer tools — associations, validations, callbacks, scopes, enum/STI — each absorb one class of placement bug. The rest of this file is those tools.

---

## 2. The callback lifecycle and the `_commit` discipline

When you hook the save lifecycle — especially when the hook touches the world outside the database (job, push, email, broadcast).

```
 validations → before_save → before_create/update → INSERT/UPDATE → after_create/update → after_save → COMMIT → after_*_commit
 |____________________ inside the transaction (can still ROLL BACK) ____________________|        |__ durable __|
```

Plain-named callbacks fire *inside* the open transaction — the row can still roll back. `_commit`-suffixed callbacks fire after the transaction is durable. **`_commit` means after-durable.**

For any consequence crossing the database boundary — push, job, broadcast, email — use `_commit`:

```ruby
after_create_commit -> { room.receive(self) }   # (Campfire) fires only once the row is permanently real
```

Fizzy: `after_create_commit :watch_card_by_creator`. Two products, same suffix, same situation — doctrine.

If you write plain `after_create` and the transaction rolls back after the hook fired, the row is undone but the phone already buzzed — fifty people notified about a message that no longer exists. That's **the ghost row**; the fix is one suffix.

**Plain `after_save` IS correct** for work that stays *inside* the database and *should* roll back with the save — bumping a counter column, stamping a denormalized field, writing a child row in the same logical unit. The rule: match the callback to whether the consequence belongs to the transaction or to the durable outside world.

| Consequence | Callback |
|---|---|
| Enqueue a job, send push/email, broadcast to live screens | `after_*_commit` |
| Write/update sibling rows that must be atomic with this save | plain `after_save` / `after_create` |
| Stamp a default on the row before write | `before_create` / `before_save` (Campfire: `before_create -> { self.client_message_id ||= Random.uuid }`) |
| Sync an external index that must never reference a rolled-back row | `after_create_commit` / `after_update_commit` / `after_destroy_commit` symmetric trio |

---

## 3. Callback vs explicit method — whose fact is this?

When a record's creation has consequences and you're deciding where the consequence code goes — the highest-leverage decision in the model layer. Ask: **whose fact is this?**

- True for **every record that exists**, however born (bot, import, seed, interactive) → property of the record. The model owns it: a callback.
- True only because of **how this record came into being** (interactive send, right now, people watching) → property of the call path. A plain explicit method, called at each call site that wants it.

Campfire holds both answers one line apart, wired opposite directions on purpose:

```ruby
class Message < ApplicationRecord
  after_create_commit -> { room.receive(self) }   # every message marks others unread — record's fact, callback
end

module Message::Broadcasts                        # plain module: no callback registration
  def broadcast_create
    broadcast_append_to room, :messages, target: [ room, :messages ]
    ActionCable.server.broadcast("unread_rooms", { roomId: room.id })
  end
end

@message.broadcast_create                                            # interactive controller calls it explicitly
room.messages.create!(body: text, creator: user).broadcast_create   # bot webhook reply
```

A seed run never calls `broadcast_create`, so it never shoves history onto live screens — no flag needed.

The smell: binding everything to `after_create_commit`, then bolting on `attr_accessor :skip_broadcast` and threading it through call sites. The moment you write `skip_broadcast` you've admitted the consequence isn't a property of the record. If a consequence needs to know *who called*, it belongs to the caller.

This question — not "fat model, skinny controller" — is what empties controllers: file each consequence where it's true and the controller shrinks to "translate HTTP into a method call."

---

## 4. Compute before save, act after commit

When a `_commit`-side effect needs to know **what changed**. Dirty flags (`title_changed?`) are live only *during* save; by `after_*_commit` they're reset and answer `false`.

Split the work across the lifecycle: stash the verdict in plain Ruby memory before the write, read it after commit. Fizzy's Card uses two cooperating callbacks:

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

`before_update` freezes the verdict into `@preview_changed` while the flags are still truthful; the closing transaction can't reset an ivar. `after_update_commit ..., if: :preview_changed?` reads the stash. Two callbacks straddle the transaction boundary.

Don't check the dirty flag *inside* the `_commit` hook — the guard is always false, the broadcast never fires. `saved_change_to_title?` works but couples the broadcast to one named attribute you'll forget to extend. The computation is only knowable before save; the broadcast only safe after commit. One callback can't be both places; two plus an ivar can.

---

## 5. Associations carry their options

When declaring any `belongs_to` / `has_many` / `has_one`. Load options onto the declaration line instead of scattering them through call sites.

```ruby
belongs_to :room, touch: true                                          # save/destroy bumps room.updated_at
belongs_to :creator, class_name: "User", default: -> { Current.user }  # the model owns the default
has_many :boosts, dependent: :destroy
```

- **`default: -> { Current.user }`** — the association supplies the creator; no controller threads `creator_id:` through every call site and forgets it in the webhook. Both products use this byte-for-byte on their core noun; Fizzy extends it: `belongs_to :account, default: -> { board.account }`. Doctrine.
- **`touch: true`** — wires cache-freshness through every create/destroy path in one token (the payoff is collected in `09-caching-performance.md` / `06-morphing-live-updates.md`).
- **`class_name:`** — name the association after the *role* (`creator`, `closed_by`), point it at the class. The role is the API; the class is an implementation detail.
- **`dependent:` — choose deliberately:**

| Variant | Behavior | Use when |
|---|---|---|
| `:destroy` | loads each child, runs its callbacks | children have their own consequences (a Pin that broadcasts its removal) |
| `:delete_all` / `:delete` | one SQL DELETE, no callbacks | children are pure data (Campfire: `has_many :memberships, dependent: :delete_all`) |

An option on the association fires on *every* path — webhook, console, seed, future controller — because it lives where the relationship lives. Don't default every association to `:destroy` without asking whether the children have callbacks worth running.

---

## 6. Association-extension blocks own the relationship's verbs

When a relationship has its own grammar — grant, revoke, revise; not just "create a row." Open a block on the `has_many` and define the verbs on the collection:

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

`room.memberships.grant_to(users)` reads like a sentence and runs **one** `insert_all` instead of N saves. `proxy_association.owner` is the room, so the insert is stamped with *that room's* `default_involvement` (the STI seam, §9). `revise` wraps grant+revoke in one transaction so every caller gets atomicity for free.

Fizzy's same instinct: `Card#triage_into` wraps `resume; update!; track_event` in one transaction, and two call paths (drag-and-drop, triage button) call that one verb.

The alternative — `users.each { room.memberships.create!(...) }` in the controller — is N inserts, a hardcoded involvement silently wrong for Direct rooms, and the same verbs re-typed in the webhook free to drift. Collection-owned grammar means every caller speaks the same verbs, and lets orchestration POROs (§11) stay one-liners.

---

## 7. Scopes are chainable Relations, never arrays

A `scope` returns an unexecuted `Relation` you can keep chaining — non-negotiable. Declare small composable scopes and snap them together:

```ruby
scope :visible, -> { where.not(involvement: :invisible) }   # (Campfire, Membership)
scope :unread,  -> { where.not(unread_at: nil) }
```

Composition is the payoff. The entire "who needs an unread badge?" decision is one chain ending in a bulk write — one SQL `UPDATE`, no rows loaded, no loop:

```ruby
memberships.visible.disconnected.where.not(user: message.creator)
  .update_all(unread_at: message.created_at, updated_at: Time.current)
```

The same `visible.disconnected` blocks compose into this UPDATE *and* the push-notification query — reuse that only exists because each piece stayed a Relation.

**TTL-window scopes — the beginless/endless range idiom.** When a fact is yes/no *over time*, write a range scope over a timestamp with the threshold as one named constant:

```ruby
CONNECTION_TTL = 60.seconds                                              # (Campfire)
scope :connected,    -> { where(connected_at: CONNECTION_TTL.ago..) }    # from 60s ago to forever
scope :disconnected, -> { where(connected_at: [ nil, ...CONNECTION_TTL.ago ]) }  # array folds NULL + STALE
scope :active, -> { where(expires_at: Time.current...) }                 # (Fizzy, MagicLink) validity
```

**The NULL-dropping trap:** `where("connected_at < ?", 60.seconds.ago)` **silently drops every NULL row** — users who never connected vanish and miss notifications. The `[ nil, ...range ]` array form folds never-connected and gone-stale into one `where`. Always handle the NULL case explicitly when a timestamp can be absent.

**Scope-of-scopes — URL-token dispatch.** Let the controller speak intent and the model own the SQL:

```ruby
scope :reverse_chronologically, -> { order(created_at: :desc, id: :desc) }   # (Fizzy, Card)
scope :sorted_by, ->(sort) {
  case sort
  when "newest" then reverse_chronologically
  when "oldest" then chronologically
  else latest
  end
}
```

`cards.sorted_by(params[:sort])`; `?sort=oldest` is the contract, the SQL never leaks up. (This `case` is fine — it dispatches *between named scopes* in one place, opposite the scattered `if kind ==` §9 deletes.)

**The composable scope ladder — pagination from tiny rungs.** Because every scope stays a Relation, pagination needs no gem and no offset math:

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

Read bottom-up: `before`/`after` are bare time filters; `page_before` chains `before` + `last_page` (never re-typing SQL); `page_around` glues the deep-link slice. One `PAGE_SIZE` governs every rung, so page size can't drift. `page_around` returns an array — correct *here* because it's terminal, the last step before render. Build with Relations; collapse to an array only at the edge, on purpose, in one named place. The two `_since` rungs are the wake-from-sleep catch-up diff, each already capped at one page.

The moment a query method returns an array (`def self.search` with `.select { }`) it stops composing: nothing can chain `.last(100)` or an auth boundary, `update_all` is unreachable, and you're filtering in Ruby what the DB does in SQL. (Chaining a scope onto the authorization shape is `10-auth-security.md`.)

---

## 8. Enums: one line, a whole vocabulary

When a column holds one of a fixed set of words — a status, tier, role.

```ruby
enum :involvement, %w[ invisible nothing mentions everything ].index_by(&:itself), prefix: :involved_in   # (Campfire)
enum :status, %w[ drafted published ].index_by(&:itself)    # (Fizzy) string-backed
enum :role, %i[ member administrator bot ]                  # (Campfire) integer-backed, deliberate
```

One declaration generates a family per value: a predicate (`involved_in_everything?`), a bang-setter (`involved_in_everything!`), and a class scope (`Membership.involved_in_everything`). They derive from one line, so they can't drift.

- **String-backed (`%w[...].index_by(&:itself)`)** stores the human word — rename-safe, reorder-safe, legible in raw queries. The house default for domain state.
- **Integer-backed (plain array)** is the deliberate exception for cold, ordinal, never-renamed values like `role`.
- **`prefix:`** namespaces the family so multiple enums on one model can't collide.

The generated scopes read like English:

```ruby
relevant_subscriptions.merge(Membership.involved_in_everything)                                # the "everything" tier
relevant_subscriptions.merge(Membership.involved_in_mentions).where(user_id: mentionees.ids)   # the "mentions" tier
```

The punchline: there is no code for *muted*. `invisible` and `nothing` simply have no `.merge`, so those members are never in the pusher's set. **Muted is the absence of a merge** — code that doesn't exist can't have a bug.

Don't model mutually exclusive states as separate booleans (`muted`, `mentions_only`, `hidden`): three booleans encode eight typeable states for four real ones, half impossible-but-storable, and every query becomes a `where(muted: false).or(...)` thicket. One enum column is exhaustive and exclusive by construction. And never hand-write `def everything?` or copy `where(involvement: "everything")` — the enum generated both; hand copies drift on rename.

---

## 9. STI: the difference lives in the subclass

When records of one noun come in kinds that behave *almost* identically — a DM vs an open channel vs an invite-only room. One table, a `type` column, subclasses that override **only their one difference**:

```ruby
class Room < ApplicationRecord       # (Campfire) the base owns the default
  def default_involvement = "mentions"
  def open?    = is_a?(Rooms::Open)
  def closed?  = is_a?(Rooms::Closed)
  def direct?  = is_a?(Rooms::Direct)
end

class Rooms::Direct < Room           # entire behavioral diff: one method
  def default_involvement = "everything"
end

class Rooms::Closed < Room           # literally empty — "closed" IS the base behavior
end
```

The empty subclass is the default made silent: the naive `elsif kind == "closed"` would only restate the default; the empty class says "this kind adds nothing" and adds zero code.

**Predicates:** write `is_a?` against the class, never `kind == "direct"` against a column. The runtime already knows what it holds; a stored string is a second copy that drifts.

**Conversion:** recast the Ruby object with `becomes!` so the *new* subclass's callbacks fire — never flip a column and remember the consequences by hand:

```ruby
@room = @room.becomes!(Rooms::Open)            # controller before_action recasts the instance

class Rooms::Open < Room
  after_save_commit :grant_access_to_all_users
  private
    def grant_access_to_all_users
      memberships.grant_to(User.active) if type_previously_changed?(to: "Rooms::Open")
    end
end
```

`type_previously_changed?(to:)` is free dirty-tracking: the grant fires only on the save that flipped the type, never re-fires, no manual "did we already grant?" flag.

A `kind` string column metastasizes the `if kind ==` into the model, controller, view, and pusher: four copies that must agree forever. **Every type-conditional is a polymorphism you haven't named yet.** The subclass writes the difference once, in the file named after it; you're not adding a class, you're deleting three copies of the branch.

---

## 10. Polymorphism at the model layer: template-method concerns

When many models share one mechanism (an activity ledger, a tracking pipeline) but each kind needs its own twist — the situation that tempts a central `case` on type. Put the mechanism in one concern that derives names from the class and exposes empty hooks:

```ruby
module Eventable                      # (Fizzy) a template-method loop, not a dispatcher
  extend ActiveSupport::Concern
  def track_event(action, creator: Current.user, board: self.board, **particulars)
    if should_track_event?
      board.events.create!(action: "#{eventable_prefix}_#{action}", creator:, board:, eventable: self, particulars:)
    end
  end
  def event_was_created(event)        # empty hook: what happens next belongs to the noun
  end
  private
    def should_track_event? = true    # template method: overridable default
    def eventable_prefix              # the class names itself — no case builds "card_created"
      self.class.name.demodulize.underscore
    end
end

module Card::Eventable                # one noun fills exactly its two seams
  def event_was_created(event)
    transaction do
      create_system_comment_for(event)
      touch_last_active_at unless was_just_published?
    end
  end
  private
    def should_track_event? = published?   # cards only track events once published
end
```

No `case self when Card` builds the action name — `eventable_prefix` asks the object its class. No `if is_a?(Card)` gate — `should_track_event?` is overridden on the card's turf. Adding a noun is `include Eventable` plus optional overrides, never a new arm on a `case` the ledger must grow forever.

**Polymorphic forwarding deletes `is_a?` too.** Give each object its own one-line answer:

```ruby
class Card    < ApplicationRecord; def card = self; end          # (Fizzy) the Card IS its own card
class Event   < ApplicationRecord; delegate :card, to: :eventable; end
class Mention < ApplicationRecord; delegate :card, to: :source;    end
class Comment < ApplicationRecord; belongs_to :card; end
```

Now `source.card` works for every node with zero `if source.is_a?(Card)`.

**Adapter-name dispatch — polymorphism over a SQL dialect.** When one model speaks two databases (Fizzy ships SQLite open-source, MySQL hosted), don't sprinkle `case connection.adapter_name` through every query method. Let the adapter name pick a module once, at class-load:

```ruby
class Search::Record < ApplicationRecord      # (Fizzy)
  include const_get(connection.adapter_name)  # "SQLite" → ::SQLite; "Trilogy" → ::Trilogy
end

module Search::Record::SQLite                 # FTS5 dialect
  extend ActiveSupport::Concern
  included do
    scope :matching, ->(query, account_id) {
      joins("INNER JOIN search_records_fts ON search_records_fts.rowid = #{table_name}.id")
        .where("search_records_fts MATCH ?", query)
    }
  end
end

module Search::Record::Trilogy                # MySQL dialect — SAME scope name, its own SQL
  extend ActiveSupport::Concern
  included do
    scope :matching, ->(query, account_id) do
      full_query = "+account#{account_id} +(#{Search::Stemmer.stem(query)})"
      where("MATCH(#{table_name}.account_key, #{table_name}.content, #{table_name}.title) AGAINST(? IN BOOLEAN MODE)", full_query)
    end
  end
end
```

*Mix in the module named after whatever database I'm connected to.* Both define `scope :matching` — the shared name IS the contract — each in its own dialect. The branch resolves once at class-load; every caller writes `matching(query, account_id)`, never asks which engine. There's no `if adapter ==` and no place to add one. Branch on `adapter_name` inside each method instead and the day one method forgets the MySQL arm, the feature silently breaks on exactly one of your two builds.

Same template-method instinct, turned outward: ask the connection what it is once, then dispatch through a name. (The full search feature is `11-worked-features.md`.)

---

## 11. Truth without a table: PORO models

When a model-shaped truth has no rows behind it — a fixed catalog, or an orchestration spanning several tables. Write a plain Ruby class in `app/models` that *quacks like* Active Record — borrow the resourceful vocabulary (`find_by_name`, `create!`) so callers can't tell.

**The catalog:** a `Struct` value object plus `index_by` gives `find_by_name` with zero schema and zero round-trips:

```ruby
class Sound                                                # (Campfire) in-memory catalog
  class Image < Struct.new(:asset_path, :width, :height)
    def initialize(name:, width:, height:)
      super "sounds/#{name}", width, height
    end
  end
  def self.find_by_name(name) = INDEX[name]                # a hash lookup, no query
  def self.names = INDEX.keys.sort
  attr_reader :name, :asset_path, :image, :text
  def initialize(name:, text: nil, image: nil)
    @name = name
    @asset_path = "#{name}.mp3"
    image ? @image = Image.new(**image) : @text = text
  end
  BUILTIN = [
    new(name: "56k", image: { name: "56k.webp", width: 79, height: 33 }),
    new(name: "bell", text: "🔔"),
    # ...the rest...
  ]
  INDEX = BUILTIN.index_by(&:name)
end
```

**The orchestrator:** a PORO borrowing `create!` to wire several real tables behind one resourceful call:

```ruby
class FirstRun                        # (Campfire) no table; owns "what it means to set up this app"
  def self.create!(user_params)
    account = Account.create!(name: ACCOUNT_NAME)
    room    = Rooms::Open.new(name: FIRST_ROOM_NAME)
    administrator = room.creator = User.new(user_params.merge(role: :administrator))
    room.save!
    room.memberships.grant_to administrator   # speaks the §6 association verb
    administrator
  end
end
```

The controller calls `FirstRun.create!(user_params)` and reads like any resourceful create. A model is defined by *owning a truth and behaving like a model*, not by having a table. Don't reach for a YAML-plus-loader catalog, a multi-table setup smeared across a controller, or a `SetupService` name — borrow the resourceful names, skip the service-object vocabulary.

---

## 12. State as row existence

When modeling a binary state — set up / not, closed / open, spent / valid. The reflex is a boolean column; the 37signals move is usually: let the existence of the right rows *be* the state.

**The gate** — derive global state from data that can't lie:

```ruby
def ensure_user_exists
  redirect_to first_run_url if User.none?    # (Campfire) "fresh install" = no users exist
end
redirect_to root_url if Account.any?         # mirror, guards setup from running twice
```

No `setup_complete` flag. A flag can lie (delete every user and it still says "done"); `User.none?` asks the truth. The data *is* the state machine.

**The satellite row** — for per-record state with metadata, a one-row satellite beats nullable columns:

```ruby
module Card::Closeable               # (Fizzy)
  extend ActiveSupport::Concern
  included do
    has_one :closure, dependent: :destroy
    scope :closed, -> { joins(:closure) }              # closed iff a closure row joins
    scope :open,   -> { where.missing(:closure) }      # open iff no closure row exists
    scope :recently_closed_first, -> { closed.order(closures: { created_at: :desc }) }
    scope :closed_by, ->(users) { closed.where(closures: { user_id: Array(users) }) }
  end
  def closed?   = closure.present?
  def open?     = !closed?
  def closed_by = closure&.user
  def closed_at = closure&.created_at
end

class Closure < ApplicationRecord    # the ENTIRE storage subsystem for closing
  belongs_to :account, default: -> { card.account }
  belongs_to :card, touch: true
  belongs_to :user, optional: true
end
```

The satellite carries its own metadata as ordinary columns, so "who/when" cost nothing. Because the row's existence is the state, **destroying the row is the reset**: close is `create_closure!`, reopen is `closure&.destroy` — nothing to un-set, no NULL-vs-false ambiguity.

**Consume means destroy** — for one-time credentials, a spent credential is an absent one:

```ruby
scope :active, -> { where(expires_at: Time.current...) }   # (Fizzy, MagicLink)
scope :stale,  -> { where(expires_at: ..Time.current) }
class << self
  def consume(code) = active.find_by(code: Code.sanitize(code))&.consume
  def cleanup       = stale.delete_all
end
def consume
  destroy   # spent = gone; replay impossible — no row to find
  self      # returned so the caller can still read it
end
```

No `used` boolean to set or check; `stale.delete_all` sweeps what the range scope already ignores. Don't add `closed:boolean, closed_at, closed_by_id` to the main table — a three-column update on close, a three-column null-out on reopen you must never forget, and every next state widening the table by three more. Keep the noun skinny; let each state be its own satellite. (The full login flow is `10-auth-security.md`.)

---

## 13. Derive, don't store — applied to columns

When about to add a column for a fact existing data already implies. Replace the stored fact with a *function* of data you have.

**Read-state — one nullable timestamp serves three surfaces.** Presence means unread-since, absence means caught up — the null *is* the data:

```ruby
scope :unread, -> { where.not(unread_at: nil) }    # (Campfire, Membership)
def read    = update!(unread_at: nil)
def unread? = unread_at.present?
```

Three surfaces derive, none stored: the bulk mark-unread is the §7 `update_all` chain; the sidebar dot is a CSS class on the same column; the OS push badge is computed fresh — `badge: user.memberships.unread.count`, so it can never say 3 while the room is empty. Opening a room nulls `unread_at` *in the same `update_all`* that sets `connected_at` — opening *is* reading, no separate `/read` endpoint. The alternative — a `read_receipts` table (N+1s forever) plus an `unread_count` integer bolted on — is a counter maintained in two places that drifts the first time a write half-fails.

**Presence — a question about time.** "Online" isn't a boolean; it's whether `connected_at` falls inside the §7 TTL window. A flag sticks at `true` when a lid slams without a clean disconnect, then needs a sweeper cron and `last_seen_at` to half-fix. The window self-heals: stop touching the timestamp and you fade out. Keep the in-memory predicate on the *same constant*:

```ruby
def connected? = connected_at? && connected_at >= CONNECTION_TTL.ago
```

**Mentions — derive the User, don't store the name.** An @mention isn't a parsed `@token` string; it's an ActionText attachable — a signed global id in the rich-text body, rehydrated to a real `User`. Extraction is a grep over attachables, not a regex:

```ruby
def mentioned_users                                  # (Campfire, Message::Mentionee)
  body.body ? body.body.attachables.grep(User).uniq : []
end

module User::Mentionable
  include ActionText::Attachable
  def to_attachable_partial_path = "users/mention"
  def to_trix_content_attachment_partial_path = "users/mention"
  def attachable_plain_text_representation(caption) = "@#{name}"
end
```

The mention round-trips losslessly: stored as a secure sgid, derived back into the live `User` (a rename shows everywhere), rendered `@name` for push bodies. The string version (`body.scan(/@(\w+)/)`) breaks on duplicate names, can't survive a rename, can't render an avatar.

**The boundary:** derivation doesn't mean "never store a computed value" — it means **never make the stored value the authority**. A counter you bump by hand is a second source of truth; a cache fragment keyed on `updated_at` is a function with a memo (`09-caching-performance.md`). And sometimes the derivable thing surprises you: Fizzy has no `position` column on cards — order is *computed* (`order(last_active_at: :desc, id: :desc)` plus a goldness join), deleting the whole renumber-on-every-drop subsystem.

---

## 14. Concerns: the three-region grammar

When a model accretes traits — searchable, mentionable, closeable — and becomes a junk drawer; or a trait needs to install wiring (callbacks, scopes, associations) onto its host.

A plain module adds instance methods but has no graceful way to add **class-level macros** (`after_create_commit`, `scope`) — you end up hand-writing `self.included(base)`. And plain modules give no help with **include order** when one trait's macros depend on another's. `ActiveSupport::Concern` deletes both and hands you three regions with precise, different semantics:

| Region | Semantics | What goes there |
|---|---|---|
| `included do ... end` | runs **in the host class context** | host-changing macros: callbacks, scopes, associations, `before_action`. The wiring harness. |
| module body | plain instance methods on the host | the trait's behavior |
| `class_methods do` | class methods on the host | the trait's **named constructor**, co-located with what it constructs |

A complete full-text search feature in ~25 lines, all three jobs visible:

```ruby
module Message::Searchable             # (Campfire)
  extend ActiveSupport::Concern
  included do                          # region 1: wiring harness — changes Message itself
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

Three doctrines: the callbacks are the `_commit` trio (index never references a rolled-back row — §2); the trio is *symmetric* (create/update/destroy each get a matching write, so the index can't drift); `search` is a `scope`, so it composes with the auth boundary and a limit.

**The include line IS the spec.** Each trait lives at `app/models/message/<trait>.rb`, and the model's first line is its table of contents:

```ruby
class Message < ApplicationRecord
  include Attachment, Broadcasts, Mentionee, Pagination, Searchable    # (Campfire — message.rb stays 44 lines)
class User < ApplicationRecord
  include Avatar, Bannable, Bot, Mentionable, Role, Transferable
```

Fizzy's `Card` includes *twenty-four* traits while staying under 100 lines. The wiring is at a distance but not action-at-a-distance: the concerns are named after their traits and listed on line one, so "how does search work?" is one ~25-line file, not a grep for callbacks.

**Co-location is the safety property — mint/verify can't drift.** When a trait has two halves that must agree on a value, the concern keeps them a few lines apart:

```ruby
module User::Avatar                    # (Campfire)
  extend ActiveSupport::Concern
  included do
    has_one_attached :avatar
  end
  class_methods do
    def from_avatar_token(sid) = find_signed!(sid, purpose: :avatar)   # verify
  end
  def avatar_token = signed_id(purpose: :avatar)                       # mint — same purpose:
end
```

Mint (instance) and verify (class constructor) share the identical `purpose: :avatar` in one frame — you physically cannot rename one side and forget the other. Same shape with `purpose: :transfer, expires_in: 4.hours`. The same logic puts `create_bot!` inside `User::Bot`'s `ClassMethods`, next to the methods it produces users for — never marooned in `user.rb` or a `UserFactory`.

The traps: (a) keep adding one more method to the model file — the 300-line junk drawer; (b) extract a `MessageService.update_index` and sprinkle calls into every create/update/destroy path — a service plus a fan of call sites that drift, and forgetting one leaves the index stale; (c) a plain module with a hand-rolled `self.included`. The complexity isn't hidden by concerns — it's *placed*, and the placement carries information.

Mechanically, forever: host-changing macros → `included do`; instance behavior → module body; named constructor → `class_methods do`.

---

## 15. Red flags → fixes

| Red flag in `app/models` | The fix | § |
|---|---|---|
| Plain `after_create` firing a job/push/broadcast | `after_create_commit` — kills the ghost row | 2 |
| `attr_accessor :skip_broadcast` threaded into a callback | The consequence belongs to the call path — explicit method at the call sites | 3 |
| Dirty-flag check (`title_changed?`) inside an `after_*_commit` | Stash the verdict in a `before_*` ivar; read it after commit with `if:` | 4 |
| `creator_id: current_user.id` threaded through controllers | `belongs_to :creator, default: -> { Current.user }` | 5 |
| Controller loop of `collection.create!(...)` for a relationship verb | Association-extension block: `grant_to`/`revise` with `insert_all` + transaction | 6 |
| `def self.x` returning an array; `.select { }` filtering in Ruby | `scope` returning a Relation; compose into `update_all`/auth/pagination | 7 |
| `where("ts < ?", t)` on a nullable column | `where(col: [ nil, ...t ])` — raw comparison silently drops NULLs | 7 |
| Hand-rolled LIMIT/OFFSET or a pagination gem for a simple slice | Composable scope ladder (`page_before` = `before` + `last_page`) | 7 |
| Two/three booleans encoding one mutually exclusive state | One enum (string-backed `index_by(&:itself)`, `prefix:` to namespace) | 8 |
| Hand-written `where(status: "published")` beside an enum | Use the generated scope/predicate family | 8 |
| `if kind == "x"` branches on a type column, any layer | STI subclass overriding the one seam; empty subclass for default; `is_a?` predicates | 9 |
| Column flip + manual downstream bookkeeping to convert a type | `becomes!(NewType)` + `type_previously_changed?(to:)` guard | 9 |
| Central `case obj.class.name` / `case eventable_type` dispatcher | Template-method concern: class-derived names, overridable hooks; `delegate` for forwarding | 10 |
| `case connection.adapter_name` inside query methods | `include const_get(connection.adapter_name)` — dialect modules sharing one scope contract | 10 |
| `SetupService`, YAML-catalog-plus-loader, multi-table setup in a controller | PORO model borrowing resourceful verbs (`create!`, `find_by_name`) | 11 |
| `setup_complete` / `closed:boolean` + `closed_at` + `closed_by_id` columns | Row existence as state: `User.none?` gate; satellite row; consume = `destroy` | 12 |
| `unread_count` counter, `online` boolean, stored `@name` mention strings | Derive: nullable timestamp, TTL window scope, ActionText attachables grep | 13 |
| 300-line model; `Service` + fan of call sites; hand-rolled `self.included` | Concern with the three-region grammar; the include line IS the spec | 14 |

The throughline: **Rails stays small because each layer trusts a convention at its boundary** — and the model layer is where most live. Before you add a column, flag, branch, or service object, **count the edge cases the conventional line absorbs for free**. The right declaration usually deletes the subsystem you were about to build.