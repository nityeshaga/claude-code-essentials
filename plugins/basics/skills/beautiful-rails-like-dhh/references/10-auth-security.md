# 10 — Auth & Security: Security Is the Shape of Your Data Access

Read when implementing or reviewing auth, authorization, login (esp. passwordless), tokens, bans, bots/API keys, or any Rails security review.

**Governing idea:** authorization is strongest when it isn't a guard you remember to add but the very query you write. At every layer, make the unsafe version unwriteable or unobservable, so security needs no vigilance. The unsafe version is usually *shorter* — and shorter code is what gets copied into the next controller.

If you want the fast path, jump to [§14 Red flags → fixes](#14-red-flags--fixes) — every pattern below collapses to one row there.

---

## 1. The two-statement bug

A load-then-guard action splits security into two lines, and the second is forgettable:

```ruby
@room = Room.find(params[:room_id])                       # load
head :forbidden unless @room.users.include?(Current.user) # the entire security model — easy to omit
```

The next controller copies the load and drops the guard → IDOR. "Secure as long as nobody forgets a line across 40 controllers" is a hope, not a model. Everything below removes the forgettable line.

---

## 2. Authorization by association — the default

Load every record *through* the current user, so the only available finder already encodes the permission:

```ruby
has_many :reachable_messages, through: :rooms, source: :messages   # on User

def set_message
  @message = Current.user.reachable_messages.find(params[:message_id])
end
```

A record outside the association isn't found → `RecordNotFound` → 404 (not 403 — 403 leaks that the row exists). The room-scoped form (a concern every room controller includes):

```ruby
def set_room
  @membership = Current.user.memberships.find_by!(room_id: params[:room_id])
  @room = @membership.room
end
```

Because the association is a chainable Relation, the auth boundary rides the whole chain — `Current.user.reachable_messages.search(query)` is authorized by construction. You never "filter results by permission"; the permission is the left half of the chain. There is no global `Message.find` in the codebase to copy, so the forgot-the-check class can't occur.

Don't reach for Pundit/CanCanCan — a policy object is still a second statement.

---

## 3. The deliberate bang split

Same shape (load through the user); pick the failure manner by context:

| Context | Form | Failure |
|---|---|---|
| Sub-resources / programmatic | `find_by!` / `find` | Hard 404 |
| Human top-level nav (stale link) | `find_by` + redirect | Friendly bounce w/ alert |
| "Where was I?" restoration | `find_by(...) \|\| default` | Silent fallback |

```ruby
def set_room
  if room = Current.user.rooms.find_by(id: params[:room_id] || params[:id])
    @room = room
  else
    redirect_to root_url, alert: "Room not found or inaccessible"
  end
end
```

The bang is the only thing that varies, and varying it is a per-context decision.

---

## 4. Secure-by-default, opt-out-by-name

Install guards in `included do` on a concern the base controller includes; expose named macros for exceptions:

```ruby
module Authentication
  extend ActiveSupport::Concern
  included do
    before_action :require_authentication
    before_action :deny_bots
    protect_from_forgery with: :exception, unless: -> { authenticated_by.bot_key? }
  end
  class_methods do
    def allow_unauthenticated_access(**o) = skip_before_action(:require_authentication, **o)
    def allow_bot_access(**o)            = skip_before_action(:deny_bots, **o)
  end
end
```

Every controller requires a session and denies bots by inheritance. Open a door with a macro that reads as intent. The attack surface is then **enumerable by grep**:

```bash
grep -rn "allow_unauthenticated_access\|allow_bot_access" app/controllers/
```

The direction of failure is the point: forgetting to *add* a guard fails open (leak); forgetting to *call* the opt-out macro fails closed (your new page demands login until you notice).

---

## 5. The OR-chain

Multiple auth strategies = one OR-chain; the line *is* the priority order:

```ruby
def require_authentication
  restore_authentication || bot_authentication || request_authentication
end
```

Each strategy returns truthy on success, so short-circuit evaluation is the dispatcher; the last arm is the redirect-to-login fallback. No registry, no middleware stack, no `case` over an `auth_type`.

---

## 6. CSRF scoped to the threat

Make forgery protection conditional on *how this request authenticated*:

```ruby
protect_from_forgery with: :exception, unless: -> { authenticated_by.bot_key? }
```

CSRF attacks ambient cookie credentials. A request that authenticated by key carries no ambient credential, so there's no forgery surface — exempt only those, not the whole controller. A human in a browser on the same endpoint keeps full protection.

---

## 7. One predicate guards every write

Collapse write authorization into one predicate, wired as one `before_action`:

```ruby
module User::Role
  extend ActiveSupport::Concern
  included { enum :role, %i[ member administrator bot ] }
  def can_administer?(record = nil)
    administrator? || self == record&.creator || record&.new_record?
  end
end

before_action :ensure_can_administer, only: %i[ edit update destroy ]
def ensure_can_administer
  head :forbidden unless Current.user.can_administer?(@message)
end
```

One sentence, reused at every mutating call site. **Genuine exceptions live in a subclass, not an `if`** — e.g. DM rooms where everyone can administer:

```ruby
# Rooms::DirectsController
def ensure_can_administer = true
```

The base controllers never learn direct rooms exist. Don't copy-paste a creator check per action (it drifts) or reach for a per-model policy gem.

---

## 8. Ambient self-registering gates

For a check that must apply to *every* endpoint (ban/IP/request screening), let the concern register its own `before_action` in `included do`, and include it once at the top:

```ruby
module BlockBannedRequests
  extend ActiveSupport::Concern
  included { before_action :reject_banned_ip, unless: :safe_request? }
  private
    def reject_banned_ip = head(:too_many_requests) if Ban.banned?(request.remote_ip)
    def safe_request?     = request.get? || request.head?
end

# ApplicationController — listing the concern IS the enforcement:
include AllowBrowser, Authentication, Authorization, BlockBannedRequests, ...
```

Two details to copy:
- `unless: :safe_request?` — GET/HEAD pass; only mutating verbs are blocked. A banned machine can read, not act.
- `head :too_many_requests` (429, not 403) — reads as ordinary rate-limiting, leaks nothing about a targeted ban.

Don't sprinkle the `before_action` per controller, or bury it in Rack middleware (loses model/convention access for no gain).

---

## 9. Capability by subtraction

Model a restricted actor (bot, API client) as a regular user denied everywhere, then un-deny exactly the doors it needs. A bot is a `User` with `role: :bot`, denied by the ambient `deny_bots` (§4):

```ruby
class Messages::ByBotsController < ApplicationController
  allow_bot_access only: :create
end
```

The bot's reachable surface is enumerable by grep (every `allow_bot_access`), forgetting one fails closed, and because it's a `User` it flows through `Current.user` and authorization-by-association with zero special cases. Don't build a parallel `BotPermission` / scopes column / capability matrix.

---

## 10. Fail closed at the network edge

For any outbound-fetch decision (SSRF territory), resolve every uncertainty toward "dangerous":

```ruby
def private_ip?(ip)
  IPAddr.new(ip).then do |a|
    a.private? || a.loopback? || a.link_local? || a.ipv4_mapped? || a.ipv4_compat? || LOCAL_IP.include?(a)
  end
rescue IPAddr::InvalidAddressError
  true   # unparseable ⇒ treat as private/dangerous
end
```

The instinct `rescue => false` ("couldn't tell, let it through") is the SSRF hole. Never write a guard whose error path is more permissive than its success path. (Same instinct: `Ban` validation rejects an unparseable IP rather than half-trusting it.)

---

## 11. Signed-id capabilities — the credential IS the URL

For a shareable, expiring credential (transfer link, session-less avatar URL, login QR, unsubscribe link), don't mint a tokens table. Rails signs the record id with a purpose and expiry baked into the signature; mint and verify sit co-located on one concern:

```ruby
module User::Transferable
  extend ActiveSupport::Concern
  TRANSFER_LINK_EXPIRY_DURATION = 4.hours
  class_methods do
    def find_by_transfer_id(id) = find_signed(id, purpose: :transfer)
  end
  def transfer_id = signed_id(purpose: :transfer, expires_in: TRANSFER_LINK_EXPIRY_DURATION)
end
```

What you get free:
- **No tokens table, no sweeper** — `expires_in:` is in the signature; an expired credential just fails verification (derive, don't store).
- **No cross-purpose replay** — a `:avatar` id can't be presented where `:transfer` is expected; a leaked avatar URL can't become a login.
- **Tamper-evidence** — a modified byte fails. Same trust model as the session cookie (`cookies.signed.permanent[:session_token] = { value: session.signed_id, httponly: true, same_site: :lax }`).
- **The bang split (§3) applies** — `find_signed` (nil for human flows) vs `find_signed!` (raise for programmatic).

Build a real tokens table only when the credential must be revocable one-at-a-time or typed by hand (see §12's six-digit code — and even then it tracks no lifecycle).

---

## 12. Passwordless login with no tokens table

The naive schema breeds: a `login_tokens` table with `used`/`consumed_at`, a `pending_logins` table, a sweeper, and a redeem-then-save race. Every weight is optional. (Fizzy is the worked example.)

**12a. Consume means destroy.** A redeemable credential is spent by being deleted; "already used" is the row's absence, not a column:

```ruby
class MagicLink < ApplicationRecord
  CODE_LENGTH = 6
  EXPIRATION_TIME = 15.minutes
  belongs_to :identity
  scope :active, -> { where(expires_at: Time.current...) }
  scope :stale,  -> { where(expires_at: ..Time.current) }
  validates :code, uniqueness: true, presence: true

  def self.consume(code) = active.find_by(code: Code.sanitize(code))&.consume
  def self.cleanup       = stale.delete_all
  def consume
    destroy   # AR doesn't blank attrs on destroy, so caller can still read self.identity
    self
  end
end
```

Double-redeem is gone by construction (the second lookup finds nothing). Expiry is read-time via the beginless/endless range scopes — a code is dead the moment the clock passes `expires_at`, with nothing written; `cleanup` only reclaims disk and correctness never depends on it. No `used` boolean, no status enum, no sweeper-as-correctness.

**12b. Pending-login state is a signed cookie, not a table.** Between "submitted email" and "typed the code," remember *which email this browser is signing in as* in a signed, httponly, self-expiring cookie:

```ruby
def set_pending_authentication_token(magic_link)
  cookies[:pending_authentication_token] = {
    value: pending_authentication_token_verifier.generate(
      magic_link.identity.email_address, expires_at: magic_link.expires_at),
    httponly: true, same_site: :lax, expires: magic_link.expires_at
  }
end
```

Enforce the binding at redeem with one constant-time compare — the email sealed in *this* browser's cookie must equal the email on the consumed link:

```ruby
def authenticate(magic_link)
  if ActiveSupport::SecurityUtils.secure_compare(
       email_address_pending_authentication || "", magic_link.identity.email_address)
    sign_in magic_link
  else
    email_address_mismatch
  end
end
```

A victim's code typed into an attacker's browser fails the compare. No `pending_logins` table.

**12c. Anti-enumeration by structural identity.** A form that responds differently to known vs unknown emails is a free user directory. Make the unknown path *construct the same object* (unsaved) and flow it through the *same* response:

```ruby
def redirect_to_fake_session_magic_link(email_address, **options)
  fake = MagicLink.new(
    identity: Identity.new(email_address: email_address),
    code: SecureRandom.base32(6),
    expires_at: MagicLink::EXPIRATION_TIME.from_now)   # .new, never saved
  redirect_to_session_magic_link fake, **options
end
```

Same pending cookie, same redirect, same JSON branch — no mailer fires (nothing saved) but the attacker can't observe that, because the response *is* the same code path. Indistinguishability comes from shared code, never from two hand-matched branches (which drift). (Fizzy also raises outside development if a magic-link code ever leaks into the flash.)

**12d. Login is CRUD.** No `LoginController#authenticate`, no `/verify`. Two resources, REST lifecycle:

```ruby
resource :session do
  scope module: :sessions { resource :magic_link }
end

# Sessions::MagicLinksController
def create
  if magic_link = MagicLink.consume(code) then authenticate magic_link else invalid_code end
end
```

Request a code = create a magic link; redeem = create-by-consuming; log in = `sessions.create!`; log out = destroy the session. The controller stays five lines because every hard part lives in the model. **The audit:** after a successful login, exactly one `Session` row persists — credential destroyed, pending state was a cookie, unknown-email defense wrote zero rows.

---

## 13. The ban arc — a durable fact about a network address

Naive ban (flip `status: "banned"`, delete content in-request, per-controller checks) has three holes: the live session keeps posting, the attacker re-registers from the same machine (the flag describes the *account*, not the *machine*), and the in-request content purge times out half-done.

**Do — four pieces; the order IS the correctness:**

```ruby
# User::Bannable
def ban
  transaction do
    create_bans_from_sessions    # ① snapshot the evidence
    apply_ban                    # ② enforce
    banned!                      # ③ mark the account — LAST
  end
end
private
  def create_bans_from_sessions
    sessions.pluck(:ip_address).compact_blank.uniq.each { |ip| bans.create!(ip_address: ip) }
  end
  def apply_ban
    close_remote_connections     # kick live websockets
    sessions.delete_all          # the IPs lived HERE — now gone
    remove_banned_content_later  # slow fan-out → job, enqueued on commit
  end
```

The IPs live on the session rows, so they must be frozen into durable `Ban` rows *before* `sessions.delete_all` destroys them — reorder and you harvest nothing. The transaction makes snapshot+purge+flip atomic (never IPs-unrecorded, never account-still-active). The status flip is last. Content removal defers via `perform_later` (enqueued on commit, so a rolled-back ban spawns no job).

Enforcement is the ambient gate from §8, reading the durable rows:

```ruby
def self.banned?(ip_address) = exists?(ip_address: ip_address)
```

**Unban is inverse CRUD:** `bans.delete_all` then `active!`, also in a transaction. Honest threat model: an IP ban is a speed bump that kills trivial same-machine re-entry, not a cryptographic lock against VPN evasion.

---

## 14. Red flags → fixes

Scan any diff for the left column; each is a hole with a named fix above.

| Red flag | Fix | § |
|---|---|---|
| `Model.find(params[:id])` near (or missing) a permission check | Load through `Current.user`'s associations | 2 |
| Permission filtering *after* a query (`results.select { ... }`) | Auth as the left half of the chain — scope first, query second | 2 |
| A 403 for a record the user shouldn't know exists | 404 via through-the-user `find`/`find_by!` | 2, 3 |
| One failure mode for both API and human navigation | The bang split: `find_by!` hard, `find_by`+redirect soft, `\|\| default` restore | 3 |
| New actions public until someone guards them | `require_authentication` in `included do`; named opt-out macros | 4 |
| Can't answer "which endpoints are public?" without reading every controller | Grep the opt-out verbs — attack surface must be enumerable | 4 |
| Auth strategy dispatch via config/registry/`case` | The OR-chain in priority order | 5 |
| `skip_forgery_protection` on a whole controller for one bot client | `protect_from_forgery unless: -> { authenticated_by.bot_key? }` | 6 |
| Creator/admin checks copy-pasted per action | One `can_administer?` predicate; one `before_action`; subclass override | 7 |
| `if record.special_kind?` inside a shared guard | Override the guard in the subclass that IS the exception | 7 |
| Per-controller wiring of an app-wide check | Self-registering concern: `before_action` in `included do`, included once | 8 |
| A blocked response that explains itself (403 + reason) | `head :too_many_requests` — leak nothing | 8 |
| A permission matrix / parallel grants for a bot or API actor | Capability by subtraction: deny everywhere, `allow_*` one door | 9 |
| `rescue => false` in a safety predicate | Fail closed: invalid means dangerous, `rescue => true` | 10 |
| A tokens table with `purpose`/`expires_at`/`used` + sweeper | `signed_id(purpose:, expires_in:)` + `find_signed(!)` co-located | 11 |
| A `used`/`consumed_at` column on a redeemable credential | Consume means destroy — spent IS the row's absence | 12a |
| Expiry as a status flipped by a scheduled job | Range scopes — expiry is read-time; cleanup is housekeeping | 12a |
| A `pending_logins` (or similar in-flight-state) table | Signed httponly self-expiring cookie; `secure_compare` at redeem | 12b |
| Different responses for known vs unknown emails — or two hand-matched branches | Fabricate the unsaved object, flow it through the SAME path | 12c |
| `LoginController#authenticate` / `/verify` custom actions | `resource :magic_link` under `resource :session`; login = `sessions.create!` | 12d |
| Ban/suspend as a flag on the account row | A durable row about the network address, snapshotted BEFORE its source is deleted | 13 |
| Multi-step state change without a transaction, or status flipped first | Ordered checklist in one transaction; evidence first, status last | 13 |
| Slow fan-out inside the security-critical request | Defer to a job enqueued on commit | 13 |

One sentence to carry out: at every layer the safe path must also be the *only ergonomic path* — load through the user, default closed, name the exceptions, destroy the spent credential, freeze the durable fact before deleting its source — so security survives a growing codebase and a tired developer.