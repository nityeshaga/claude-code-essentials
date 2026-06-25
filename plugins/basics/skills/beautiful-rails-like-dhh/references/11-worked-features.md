# Worked Features: Five Complete Builds

Read this when building a feature end-to-end. These five walkthroughs teach **composition** — the order you build in, and how each layer's convention hands off to the next. The mechanics live in the owning reference files; here, each step shows only load-bearing code. After each build, read the ledger: the subsystems *not built* are the point.

The closing checklist generalizes all five to any feature.

**Contents:** 1. Real-time chat send · 2. Full-text search · 3. Ban a user · 4. Drag-and-drop Kanban · 5. Passwordless login · Anatomy of a 37signals feature

---

## 1. Real-time chat send (Campfire) — optimistic, multi-screen

**Feature:** a user hits Enter; the message appears instantly on their screen and every other member's, with unread badges and push for the absent — and the sender never sees a duplicate.

**Naive shape (don't):** fat controller looping members to mark unread and pushing inline (blocks on N flaky calls); plain `after_create` fan-out firing inside the transaction (rollback → ghost row: phones notified of a message that doesn't exist); two renderers that drift; a hand-written temp-id reconciliation pass; an `online` boolean that lies when a lid closes.

**The build:**

1. **Model — declare the consequence on the noun.** The include line IS the spec, plus two load-bearing lines:

```ruby
class Message < ApplicationRecord
  include Attachment, Broadcasts, Mentionee, Pagination, Searchable

  belongs_to :room, touch: true
  belongs_to :creator, class_name: "User", default: -> { Current.user }

  before_create -> { self.client_message_id ||= Random.uuid }
  after_create_commit -> { room.receive(self) }

  def to_key = [ client_message_id ]
end
```

`after_create_commit` — `_commit` means after-durable — makes persistence the trigger; the controller never learns the fan-out exists. `to_key` is step 5's payoff; place it now.

2. **Controller — three real lines.** Persist; persistence declares the consequence; broadcast the call-path fact explicitly (an interactive send broadcasts; an import wouldn't — *whose fact is this?*):

```ruby
def create
  set_room
  @message = @room.messages.create_with_attachment!(message_params)
  @message.broadcast_create
end
```

3. **Fan-out — split by the sync/async line.** Cheap-and-durable in-band as one bulk UPDATE; slow fan-out crosses into a job:

```ruby
def receive(message)
  unread_memberships(message)   # in-band: one update_all
  push_later(message)            # out-of-band: Room::PushMessageJob.perform_later(self, message)
end

def unread_memberships(message)
  memberships.visible.disconnected.where.not(user: message.creator)
    .update_all(unread_at: message.created_at, updated_at: Time.current)
end
```

No loop, no N+1. `disconnected` is **derive, don't store** — presence is a time-window scope, not a flag:

```ruby
CONNECTION_TTL = 60.seconds
scope :connected,    -> { where(connected_at: CONNECTION_TTL.ago..) }
scope :disconnected, -> { where(connected_at: [ nil, ...CONNECTION_TTL.ago ]) }
```

Notification prefs are an enum family, not hand-written `where`s: `enum :involvement, %w[ invisible nothing mentions everything ].index_by(&:itself), prefix: :involved_in` generates the scope, predicate, and bang-setter from one line.

4. **Broadcast — one renderer, three paths.** `broadcast_create` calls `broadcast_append_to room, :messages, target: [room, :messages]`. The view subscribes to the same channel and renders the same partial:

```erb
<%= render partial: "messages/message", collection: @messages, cached: true %>
<%= turbo_stream_from @room, :messages %>
```

Initial load, HTTP reply, and WebSocket frame all render `messages/_message`. **The wire carries HTML, not data** — no JSON schema, no client template, no drift.

5. **Optimistic de-dupe — by identity, not reconciliation.** The Stimulus composer generates a `clientMessageId`, draws a placeholder `<div id="message_<uuid>">`, submits it in a hidden field. The server persists it (`before_create`), and because `to_key` returns `[client_message_id]`, every `dom_id(message)` yields the *same id the placeholder has*. Turbo's append-onto-existing-id replaces instead of duplicating. The de-dupe falls out of shared DOM identity.

6. **Client polish on the lifecycle event, not the model.** Autoscroll/sound ride Turbo's published event via one declarative action — `"turbo:before-stream-render@document->messages#beforeStreamRender"` — wrapping `event.detail.render`. The model never learns a UI exists.

**The ledger.** Touched: one model (+ concerns), one 3-line controller action, one partial, one Stimulus controller. NOT built: no reconciliation pass, no temp-id swap, no second renderer, no JSON contract, no serializer, no per-member notify loop, no `online` flag with heartbeat sweeper.

---

## 2. Full-text search (Campfire + Fizzy) — indexed, stemmed, authorized, paginated

**Feature:** a user types "deploy" and gets every matching message — stemmed, only from rooms they belong to, capped, rendered like every other message — from an index that stays in sync forever.

**Naive shape (don't):** `LIKE "%q%"` (full scan, no stemming, and never matches because `has_rich_text :body` stores text in `action_text_rich_texts`); a `searchable_text` column you keep fresh forever; index sync via plain `after_create` (rolled-back message → ghost in index → nightly reconciliation cron); `Message.search(q)` then *remembering* `.where(room_id: ...)` (one caller forgets, rooms leak); a bespoke `search_result` partial that drifts.

**The build:**

1. **Index — a second representation for searching.** One schema line: `create_virtual_table "message_search_index", "fts5", ["body", "tokenize=porter"]` (porter collapses deploy/deploys/deploying). It's a projection, not a domain noun — do NOT wrap it in an AR model.

2. **Sync — a concern with three symmetric `_commit` callbacks.** The feature is one word on the include line (`Searchable`) pointing at one self-contained file:

```ruby
module Message::Searchable
  extend ActiveSupport::Concern

  included do
    after_create_commit  :create_in_index
    after_update_commit  :update_in_index
    after_destroy_commit :remove_from_index

    scope :search, ->(query) { joins("join message_search_index idx on messages.id = idx.rowid").where("idx.body match ?", query).ordered }
  end

  private
    def create_in_index
      execute_sql_with_binds "insert into message_search_index(rowid, body) values (?, ?)", id, plain_text_body
    end
    # update_in_index / remove_from_index mirror it; all funnel through sanitize_sql
end
```

One callback per way the text can change. `_commit` keeps rolled-back rows out — no sweeper needed for correctness.

3. **Text — derive the searchable representation at index-write time:**

```ruby
def plain_text_body
  body.to_plain_text.presence || attachment&.filename&.to_s || ""
end
```

"Indexed text" and "current text" are the same expression at the same instant; the filename fallback makes a caption-less `q3-deploy-plan.png` findable; `""` keeps FTS from choking on nil.

4. **Query — compose authorization onto the search, never filter after it.** The scope returns a chainable Relation:

```ruby
@messages = Current.user.reachable_messages.search(query).last(100)
# has_many :reachable_messages, through: :rooms, source: :messages
```

Authorization is the *shape* of the query — **the IDOR you cannot type**: a foreign room is filtered by the JOIN before `match` runs, and there's no global `Message.search` to leak through. Because `search` is a Relation, `.last(100)` compiles to `ORDER BY … LIMIT`. Scrub input before FTS: `params[:q]&.gsub(/[^[:word:]]/, " ")` — users must not drive FTS5 operator syntax.

5. **Render — `render @messages` resolves to `messages/_message`.** One renderer; a search hit is byte-identical to the message in its room.

6. **Recent searches — the one real noun gets the one real table.** Performing a search is `create` on a `Search` (**verb-as-noun**); the list self-maintains:

```ruby
class Search < ApplicationRecord
  belongs_to :user
  after_create :trim_recent_searches
  scope :ordered, -> { order(updated_at: :desc) }

  def self.record(query) = find_or_create_by(query: query).touch

  private
    def trim_recent_searches
      user.searches.excluding(user.searches.ordered.limit(10)).destroy_all
    end
end
```

`find_or_create_by(...).touch` gives de-dupe + recency free; the self-trim needs no cron.

7. **(Fizzy) Two databases, no `if adapter`.** Let the adapter name pick the strategy at class-load: `include const_get(connection.adapter_name)` — each module defines the same `scope :matching` in its own dialect (FTS5 join vs `MATCH … AGAINST`); no query code branches. Fizzy's index is also `belongs_to :searchable, polymorphic: true` (one index spans cards and comments).

**The ledger.** Touched: one `create_virtual_table` line, one ~28-line concern, one derived method, a two-line controller, one tiny `Search` model. NOT built: no search service, no sync worker, no reconciliation cron, no `searchable_text` column, no permission filter, no result template, no `SearchIndexEntry` model, no `if adapter` branches.

---

## 3. Ban a user (Campfire) — durable enforcement

**Feature:** an admin clicks Ban; the user is logged out everywhere, their content removed, and their *machine* — not just the account — locked out of every mutating request, durably, even after re-registration.

**Naive shape (don't):** `user.update!(status: "banned")` (attacker re-registers from the same laptop in thirty seconds); a `redirect_if_banned` `before_action` you sprinkle in by memory (bites on next login, ignores the live session); `user.messages.each(&:destroy)` inline (thousands of broadcasts; the click times out half-done); no transaction (failure leaves sessions deleted but no evidence recorded).

**The build:**

1. **Route + controller — banning is creating a Ban.** **Find the noun**; no custom `post :ban`:

```ruby
resource :ban, only: %i[ create destroy ]
```

```ruby
class Users::BansController < ApplicationController
  before_action :ensure_can_administer   # head :forbidden unless Current.user.can_administer?
  before_action :set_user

  def create  = (@user.ban;   redirect_to @user)
  def destroy = (@user.unban; redirect_to @user)
end
```

The controller doesn't know what banning entails — the model took the weight.

2. **Model verb — an ordered, atomic checklist where the order IS the correctness:**

```ruby
def ban
  transaction do
    create_bans_from_sessions   # ① snapshot the evidence
    apply_ban                   # ② enforce
    banned!                     # ③ mark the account, last
  end
end

private
  def create_bans_from_sessions
    sessions.pluck(:ip_address).compact_blank.uniq.each { |ip| bans.create!(ip_address: ip) }
  end

  def apply_ban
    close_remote_connections    # kick live websockets
    sessions.delete_all         # …AFTER the IPs on those rows are frozen into Ban rows
    remove_banned_content_later # defer the unbounded fan-out
  end
```

**Snapshot durable state before you delete its source** — reverse ① and the ban is a flag with no teeth; the `Ban` row must outlive both session and account because re-registration is the attack. The transaction makes snapshot+purge+flip one atomic act. `banned!` comes from `enum :status, %i[ active deactivated banned ], default: :active` and flips *last*. `unban` is the inverse: `transaction { bans.delete_all; active! }`.

3. **Altitude — the slow part leaves the request.** `remove_banned_content_later` enqueues `RemoveBannedContentJob`, a thunk delegating to `user.remove_banned_content`. `perform_later` enqueues on commit, so a rolled-back ban never spawns a destruction job.

4. **Enforcement — an ambient guard nobody opts into:**

```ruby
module BlockBannedRequests
  extend ActiveSupport::Concern
  included do
    before_action :reject_banned_ip, unless: :safe_request?
  end

  private
    def reject_banned_ip
      head :too_many_requests if Ban.banned?(request.remote_ip)  # exists?(ip_address:), indexed
    end

    def safe_request? = request.get? || request.head?
end
```

Included once, in `ApplicationController` — one word installs the gate on every controller. **Secure-by-default**: no per-controller list to keep in sync. Two deliberate details: only mutating verbs are blocked (a banned machine reads, can't act), and the reply is 429 not 403 (reads as rate-limiting, leaks nothing). Honest scope: an IP ban is a speed bump that kills casual re-entry, not a cryptographic wall.

**The ledger.** Touched: a two-line controller, one concern with a five-line transaction, a three-line job, a `Ban` model with one indexed `exists?`, one word in an include list. NOT built: no custom `ban` route verb, no status-flag-only ban, no per-controller guard list, no in-request destroy loop, no half-state recovery code.

---

## 4. Drag-and-drop Kanban (Fizzy)

**Feature:** a user drags a card between columns (including Done, Not Now, back to triage); it lands instantly under their cursor, the server records the move atomically, every screen reconciles without flicker.

**Naive shape (don't):** a `position` integer renumbered with paired `update_all`s per drop (corruption on half-failure, then a drift-sweeping cron); one controller with `case params[:destination]` (a junction box growing a `when` per target); the client computing an insertion index from pixels (two ideas of order); a destructive `turbo_stream.replace` that rips the node mid-animation; JS building URLs from memorized route shapes.

**The build:**

1. **Order — derive it; there is no position column.** Order is one scope: `scope :latest, -> { order last_active_at: :desc, id: :desc }`. A drop bumps activity; the next render re-sorts. **Derive, don't store** deletes the entire renumbering subsystem. Pinning is derived from a satellite row's *existence*: `left_outer_joins(:goldness).prepend_order("card_goldnesses.id IS NULL")`. (The exception proving the rule — reordering whole columns IS genuine user intent, so Fizzy stores that; see `02-models.md`.)

2. **Routes — the routing table owns the case-on-destination.** Each kind of drop is its own noun:

```ruby
namespace :columns do
  resources :cards do
    scope module: :cards do
      namespace :drops do
        resource :not_now    # → postpone
        resource :stream     # → back to triage
        resource :closure    # → close
        resource :column     # → triage_into
      end
    end
  end
end
```

The naive controller's branch is split into the URL space, decided before any Ruby runs. A new drop target is a new route + file, never a new `when`.

3. **Controllers — 3–7 lines each, naming one model verb:**

```ruby
class Columns::Cards::Drops::ColumnsController < ApplicationController
  include CardScoped   # card loaded through Current.user's boards → foreign card 404s before create

  def create
    @column = @card.board.columns.find(params[:column_id])
    @card.triage_into(@column)
  end
end
```

Closure is `@card.close`; not-now is `@card.postpone`. No `case`; `CardScoped` makes the load the authorization.

4. **Model verbs — one rich transactional verb, multiple entry points:**

```ruby
def triage_into(column)
  raise "Column must belong to the card board" unless board == column.board
  transaction do
    resume
    update! column: column
    track_event "triaged", particulars: { column: column.name }
  end
end
```

Drag path and click-a-button path both call `triage_into`; `postpone` is shared with the auto-postpone job. The guard, resume, and event live once — entry points can't drift.

5. **The URL carries the contract.** The server renders each column with a finished drop URL containing one hole — `drop_url: columns_card_drops_closure_path("__id__")` — as `data-drag-and-drop-url`. One generic drag controller fills the hole and POSTs empty:

```javascript
const url = container.dataset.dragAndDropUrl.replaceAll("__id__", item.dataset.id)
return post(url, { body, headers: { Accept: "text/vnd.turbo-stream.html" } })
```

The client never knows whether a drop closes, postpones, or moves — the route IS the meaning. Change what "Done" does and you change a route, zero JS. **Config over forks**: one domain-agnostic Stimulus controller driven by `data-*`.

6. **Optimistic move, morph reconciliation.** The client moves the node *before* POSTing; the reply morphs instead of replacing: `turbo_stream.replace(dom_id(@column), partial: "boards/show/column", method: :morph, ...)`. **Morph is reconciliation, not replacement** — when the guess matched truth, morph finds nothing to change; placement, focus, and in-flight transitions survive.

7. **Constrain the guess to the server's sort axis.** The server stamps one bit — `data[:drag_and_drop_top] = true if card.golden? && !card.closed? && !card.postponed?` — and the client's only decision is before-or-after the golden band. **The DOM attribute IS the state**: the client honors the single SQL axis, so optimistic placement *cannot* disagree with truth.

**The ledger.** Touched: four routes, four 3–7-line controllers, three model verbs, four column partials passing `drop_url`, one generic Stimulus controller. NOT built: no position column, no renumbering `update_all` pair, no drift-sweeping cron, no `case destination` junction box, no JSON move payload, no client-side route knowledge, no hand-written reconciliation.

---

## 5. Passwordless login (Fizzy) — no tokens table

**Feature:** a user types their email, gets a six-digit code, types it back, and is signed in — replay-safe, enumeration-resistant, browser-bound — with exactly one row (the Session) persisting afterward.

**Naive shape (don't):** a `login_tokens` table with `used`/`consumed_at` (flags flipped at exactly the right instant, plus a burned-code race); an `expires_at` enforced by a sweeper (whose lateness is a security hole); a `pending_logins` table (a second entity with its own lifecycle); a form that says "code sent" vs "no such user" (a free user directory); a `LoginController` with custom `verify_code` actions.

**The build:**

1. **The credential — consume means destroy.** The `MagicLink` model carries no `used`, no `consumed_at`, no status:

```ruby
class MagicLink < ApplicationRecord
  CODE_LENGTH = 6
  EXPIRATION_TIME = 15.minutes
  belongs_to :identity

  scope :active, -> { where(expires_at: Time.current...) }
  scope :stale,  -> { where(expires_at: ..Time.current) }

  before_validation :generate_code, :set_expiration, on: :create
  validates :code, uniqueness: true, presence: true

  def self.consume(code) = active.find_by(code: Code.sanitize(code))&.consume
  def self.cleanup = stale.delete_all    # disk housekeeping, never correctness

  def consume
    destroy
    self
  end
end
```

"Spent" is the row's *absence* — the double-redeem guard is structural. `consume` returns `self` because AR keeps attributes in memory after `destroy`, so the caller still reads `.identity`. Expiry is a read-time range comparison, not a status to sweep — an un-swept expired code is still un-redeemable because `consume` only queries `active`. **Flags lie; ask the clock.**

2. **Pending-login state — a signed cookie, not a table.** The one fact between "code mailed" and "code typed" lives in a signed, `httponly`, self-expiring cookie:

```ruby
def set_pending_authentication_token(magic_link)
  cookies[:pending_authentication_token] = {
    value: pending_authentication_token_verifier.generate(magic_link.identity.email_address, expires_at: magic_link.expires_at),
    httponly: true, same_site: :lax, expires: magic_link.expires_at
  }
end
```

You trust your own signature (one altered byte verifies to `nil`), not the client. It dies on the same clock as the code. No row, no sweeper, no second table.

3. **Binding — one constant-time compare at redeem.** A code mailed to one email must not sign in a browser that claimed another:

```ruby
def authenticate(magic_link)
  if ActiveSupport::SecurityUtils.secure_compare(email_address_pending_authentication || "", magic_link.identity.email_address)
    sign_in magic_link
  else
    email_address_mismatch
  end
end
```

The email sealed in this browser's cookie against the email on the consumed link; `secure_compare` leaks nothing through timing.

4. **Anti-enumeration — structural, not a guard clause.** Make the unknown path *construct the same object* and run the same code — an **unsaved** fabrication:

```ruby
def redirect_to_fake_session_magic_link(email_address, **options)
  fake_magic_link = MagicLink.new(                         # .new, never .create
    identity: Identity.new(email_address: email_address),  # nothing written, nothing mailed
    code: SecureRandom.base32(6),
    expires_at: MagicLink::EXPIRATION_TIME.from_now
  )
  redirect_to_session_magic_link fake_magic_link, **options   # the SAME path real logins take
end
```

Same screen, same cookie, same timing — indistinguishability guaranteed by shared code. There is no "user not found" rendering because the codebase declines to build one.

5. **Flow — CRUD on two nouns, no auth machinery.** `resource :magic_link` nested under `resource :session`: requesting a code is `create` on the session's magic link; redeeming is the magic-link controller's `create`:

```ruby
def create
  if magic_link = MagicLink.consume(code)
    authenticate magic_link
  else
    invalid_code   # wrong, expired, already used — all "not found"
  end
end
```

Logging in is `create` on the other noun: `identity.sessions.create!(user_agent: request.user_agent, ip_address: request.remote_ip)`. Logging out is its `destroy`. Two resources, standard verbs, five-line controllers — every hard part lives in the model.

**The ledger.** Touched: one 43-line `MagicLink` model, one cookie helper concern, two five-line controllers, two `resource` routes. Rows persisting after a successful login: **one** (the Session). NOT built: no tokens table with `used`/`consumed_at`, no expiry sweeper, no `pending_logins` table, no enumeration oracle, no `/verify` action, no redeem-then-save race.

---

## Anatomy of a 37signals feature

Run this for ANY new feature. Each step is a question; the five examples above are five answers.

1. **Find the noun.** The feature arrives as a verb — send, search, ban, drop, log in. Ask what hidden noun it's CRUD on (`Message`, `Search`, `Ban`, `Closure`, `MagicLink`/`Session`). If one gesture can mean several things, each meaning is its own noun and the routing table owns the branch. A model may have verbs; a controller may not.
2. **Decide whose fact each consequence is.** Is it a consequence of the *record existing* (mark unread, sync the index, snapshot the IPs) → a model callback, `_commit` if it reaches outside the database; or of *how it was created* (interactive send broadcasts; import doesn't) → an explicit method at the call site. Reaching for a `skip_x` flag means you put a call-path fact on the record.
3. **Derive every fact you can; store only genuine intent.** Order ← a timestamp; presence ← a TTL window; "spent" ← a destroyed row; pinned ← a satellite row's existence; pending-login ← a signed cookie. **A stored copy is a second source of truth**; every derived fact deletes a staleness bug class and usually a sweeper.
4. **Make the data access carry the authorization.** Load through `Current.user`'s associations (`reachable_messages`, `accessible_cards`, `CardScoped`) so the unauthorized request is unwriteable, not caught. Cross-cutting enforcement is one ambient concern included once at the top of the controller tree.
5. **Pick altitudes.** Draw the sync/async line: cheap-and-must-be-atomic stays in-band (one bulk `update_all`, an ordered transaction); slow or unbounded fan-out crosses into a `_later` job that's a two-line thunk back to a model verb. Order inside the transaction is part of the spec — snapshot before you purge.
6. **One partial + `dom_id`.** Write exactly one renderer for the noun and address it by `dom_id` everywhere — first load, HTTP reply, broadcast, search hit. The wire carries HTML. If the client draws optimistically, make client and server agree on identity up front (`to_key` / honoring the one sort axis) so reconciliation is structural, not written.
7. **Let conventions compose; keep JS generic.** The client is a thin, domain-agnostic mechanism configured by server-stamped `data-*`; the URL carries the contract; replies morph rather than replace. Behavior bolts onto published lifecycle events, never onto the model.
8. **Audit by the ledger.** Before shipping, count what you did NOT build — the reconciliation pass, the sync worker, the sweeper cron, the position column, the tokens table, the `case` junction box, the second renderer. If the naive subsystems still exist in your diff, a convention got re-implemented by hand.