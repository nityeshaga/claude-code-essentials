# 10 — Auth & Security: Security Is the Shape of Your Data Access

Read this when you are implementing or reviewing authentication, authorization, login flows (especially passwordless), tokens, bans, bots/API keys, or doing a security review of any Rails code.

**Contents**

1. [The two-statement bug — why guards fail](#1-the-two-statement-bug)
2. [Authorization by association — the IDOR you cannot type](#2-authorization-by-association)
3. [The deliberate bang split — 404 vs redirect](#3-the-deliberate-bang-split)
4. [Secure-by-default, opt-out-by-name](#4-secure-by-default-opt-out-by-name)
5. [The OR-chain — auth strategy priority as one line](#5-the-or-chain)
6. [CSRF scoped to the threat](#6-csrf-scoped-to-the-threat)
7. [One predicate guards every write](#7-one-predicate-guards-every-write)
8. [Ambient self-registering gates](#8-ambient-self-registering-gates)
9. [Capability by subtraction](#9-capability-by-subtraction)
10. [Fail closed at the network edge](#10-fail-closed-at-the-network-edge)
11. [Signed-id capabilities — the credential IS the URL](#11-signed-id-capabilities)
12. [Passwordless login with no tokens table](#12-passwordless-login-with-no-tokens-table)
13. [The ban arc — a durable fact about a network address](#13-the-ban-arc)
14. [Red flags → fixes](#14-red-flags--fixes)

The governing idea of this entire file: **authorization is strongest when it isn't a guard you remember to add but the very query you write.** At every layer below, the move is the same — make the unsafe version unwriteable or unobservable, so security requires no vigilance. Defense by vigilance scales like vigilance: badly.

---

## 1. The two-statement bug

**When:** Any controller action that loads a record the user is only sometimes allowed to touch.

**Not — the version you will write first:**

```ruby
def index
  @room = Room.find(params[:room_id])                          # 1. load
  head :forbidden unless @room.users.include?(Current.user)    # 2. then guard
  @messages = @room.messages.last(100)
end
```

Two statements. The first loads the record. The second is the *entire security model of the application*, and it is a line someone has to remember to type. It works, it passes tests, you move on. Then a teammate adds a sub-resource controller and copies only the first line — because the second line isn't load-bearing for making the feature *work*; it only matters when an attacker shows up:

```ruby
def create
  @message = Message.find(params[:message_id])   # no second line
  @message.boosts.create!(boost_params)
end
```

Now any logged-in user can act on any record by guessing an id — an IDOR (Insecure Direct Object Reference) — introduced by writing *correct* code that forgot an invisible second step. The unsafe version is *shorter* than the safe one, and shorter code is the code that gets copied. Every new controller is a fresh chance to forget.

**Why this section exists:** "the codebase is secure as long as no one forgets a line across forty controllers and three years" is not a security model — it's a hope. Everything below removes the line that could be forgotten.

---

## 2. Authorization by association

**When:** Always. This is the default way to load any record in any controller.

**Do:** Load every record *through* the current user, so the only way to find it is through a relationship that already encodes the permission:

```ruby
# (Campfire) the single association that IS the visibility rule, on User:
has_many :reachable_messages, through: :rooms, source: :messages

# every sub-resource controller loads its subject through it:
def set_message
  @message = Current.user.reachable_messages.find(params[:message_id])
end
```

Read it as a sentence: *of the messages reachable by the current user, find this one.* If the record belongs to something the user isn't in, it is not in the association, so `find` raises `RecordNotFound` → 404. Not a 403 ("forbidden" leaks that the row exists) — just "no such thing, from where you're standing." A record the user can't see *does not exist from their vantage point*.

The room-scoped version (Campfire), packaged as a concern every room controller includes:

```ruby
module RoomScoped
  extend ActiveSupport::Concern

  included do
    before_action :set_room
  end

  private
    def set_room
      @membership = Current.user.memberships.find_by!(room_id: params[:room_id])
      @room = @membership.room
    end
end
```

No `Room.find` followed by a permission check — the room is reached through `Current.user.memberships`, and `find_by!` 404s a room the user has no membership in. Bonus: `@membership` is captured for free because the views need it anyway — the auth lookup and the data load are one query.

Fizzy, an unrelated product, mints the byte-for-byte same shape: `has_many :accessible_cards, through: :boards, source: :cards` on User, and `Current.user.accessible_cards.find_by!(number: params[:card_id])` in its `CardScoped` concern. Two products converging on the identical line is doctrine, not idiom.

**The composition payoff — auth as the left half of every chain.** Because the association is a chainable Relation (not a precomputed array), the auth boundary drops onto everything downstream:

```ruby
# (Campfire) full-text search, authorized by construction:
@messages = Current.user.reachable_messages.search(query).last(100)

# (Fizzy) same shape, different product:
Current.user.accessible_cards.mentioning(@query, user: Current.user)
```

You never write "filter the results by permission." The permission is the left half of the chain; a user physically cannot search a room they're not in. The same line authorizes boosts, search, exports, counts — every sub-resource that hangs off the noun.

**Not:** You will be tempted to write `Message.find(params[:id])` plus an `if` guard, or to bolt on Pundit/CanCanCan policy objects — don't. A policy object is still a second statement; the global finder is still there to copy.

**Why:** This is **the IDOR you cannot type**. There is no `Message.find` in the codebase to copy into the next controller — the global, unscoped lookup that *was* the bug isn't discouraged; it's *absent*. The whole class of "forgot the permission check in the new controller" can't occur, because the only available verb already starts at the user. Count the edge cases this line absorbs for free: every future controller, every future feature chained onto the relation, every search-results leak — absorbed by one association written once.

---

## 3. The deliberate bang split

**When:** Choosing how a through-the-user load should *fail*.

**Do:** Same shape — load through the user — with two failure manners chosen by context:

| Context | Form | Failure behavior |
|---|---|---|
| Sub-resources, API-ish endpoints, anything programmatic | `find_by!` / `find` | Hard 404 — a missing row is a real error |
| Human top-level navigation (stale bookmark, deleted room) | `find_by` + redirect | Gentle bounce with an alert, not a crash |
| "Where was I?" restoration | `find_by(...) \|\| default` | Silent fallback |

```ruby
# (Campfire) human navigation — find_by, no bang, friendly bounce:
def set_room
  if room = Current.user.rooms.find_by(id: params[:room_id] || params[:id])
    @room = room
  else
    redirect_to root_url, alert: "Room not found or inaccessible"
  end
end

# (Campfire) cookie-restored state — fall back, never crash:
def last_room_visited
  Current.user.rooms.find_by(id: cookies[:last_room]) || default_room
end
```

**Not:** Don't use one failure mode everywhere. The naive `Room.find` gives you exactly one behavior (a 500/404 on a missing-or-forbidden row) and no choice about it.

**Why:** A user clicking a stale link deserves a redirect; a forged sub-resource id deserves a 404; a stale cookie deserves a default. All three still load through the user — the bang is the only thing that varies, and varying it is a *decision*, made once per context.

---

## 4. Secure-by-default, opt-out-by-name

**When:** Setting up authentication for any app — this is the request-layer twin of §2. A new controller action must not be public until someone remembers to guard it; that's the forgettable-line problem one level up.

**Do:** Install the guards in `included do` on a concern the base controller includes, and expose *named macros* for the exceptions:

```ruby
# (Campfire) app/controllers/concerns/authentication.rb
module Authentication
  extend ActiveSupport::Concern

  included do
    before_action :require_authentication
    before_action :deny_bots
    protect_from_forgery with: :exception, unless: -> { authenticated_by.bot_key? }
  end

  class_methods do
    def allow_unauthenticated_access(**options)
      skip_before_action :require_authentication, **options
    end

    def allow_bot_access(**options)
      skip_before_action :deny_bots, **options
    end
  end
end
```

Every controller, by inheriting from the base, requires a session *and* denies bots. To open a door you call a macro that reads as intent — `allow_unauthenticated_access` on the login page, `allow_bot_access` on the bot webhook endpoint. Fizzy ships the same vocabulary over the same closed-by-default `before_action :require_authentication` — house doctrine, both products.

**The enumeration property:** you can list every public action in the app by grepping for the two verbs. The attack surface is *enumerable*, because each opening is a named declaration, not the absence of a forgotten line:

```bash
grep -rn "allow_unauthenticated_access\|allow_bot_access" app/controllers/
```

**Not:** You will be tempted to leave actions open and add `before_action :authenticate!` per controller as needed — don't. And don't worry that `skip_before_action` is "the same forgettable line in reverse" — it isn't, because of the failure *direction*.

**Why:** The direction of the failure is the whole game. Forgetting to *add* a guard fails open (a leak). Forgetting to *call* `allow_unauthenticated_access` fails closed — your new public page demands a login until you notice. Secure-by-default means every mistake errs toward locked, not leaking.

---

## 5. The OR-chain

**When:** An app accepts more than one way to authenticate (session cookie, API/bot key, …).

**Do:** Write the strategy priority as one OR-chain — the line *is* the priority order:

```ruby
# (Campfire)
def require_authentication
  restore_authentication || bot_authentication || request_authentication
end

def restore_authentication
  if session = find_session_by_cookie
    resume_session session
  end
end

def bot_authentication
  if params[:bot_key].present? && bot = User.authenticate_bot(params[:bot_key].strip)
    Current.user = bot
    set_authenticated_by(:bot_key)
  end
end

def request_authentication
  session[:return_to_after_authenticating] = request.url
  redirect_to new_session_url
end
```

Try the session cookie; else try a bot key; else stash the return URL and bounce to login. Each strategy returns truthy on success, so short-circuit evaluation *is* the dispatcher. The last arm is the fallback that always "succeeds" by redirecting.

**Not:** Don't build a strategy registry, an authentication middleware stack, or a `case` over an `auth_type` param. Three private methods and one `||` chain is the entire multi-strategy system.

**Why:** The priority order is readable at a glance, new strategies are one more `||` arm, and there is no configuration to drift from the code.

---

## 6. CSRF scoped to the threat

**When:** Some clients authenticate without cookies (bot keys, API tokens).

**Do:** Make forgery protection conditional on *how this request authenticated*:

```ruby
# (Campfire) inside the Authentication concern's included do:
protect_from_forgery with: :exception, unless: -> { authenticated_by.bot_key? }
```

**Not:** Don't blanket-disable CSRF for an entire controller (`skip_forgery_protection`) because one client is a bot, and don't force key-authenticated clients through token gymnastics.

**Why:** CSRF is an attack on *ambient cookie credentials* — a forged form submits and the browser helpfully attaches the cookie. A client that authenticated by key in the request itself carries no ambient credential; there is no forgery surface to protect. Scope the guard to the threat that actually exists. The condition keys off the authentication *method* of this request, not off the controller or the user — a human in a browser on the same endpoint keeps full protection.

---

## 7. One predicate guards every write

**When:** Deciding who may mutate (edit/update/destroy) records.

**Do:** Collapse write authorization into one small predicate on the user, and wire it as one `before_action`:

```ruby
# (Campfire) app/models/user/role.rb
module User::Role
  extend ActiveSupport::Concern

  included do
    enum :role, %i[ member administrator bot ]   # generates administrator?, bot?, member?
  end

  def can_administer?(record = nil)
    administrator? || self == record&.creator || record&.new_record?
  end
end
```

*You can administer a record if you're an admin, or you made it, or it's brand new.* One sentence, reused at ~16 call sites across the app, wired into each mutating controller as a single guard:

```ruby
before_action :ensure_can_administer, only: %i[ edit update destroy ]

def ensure_can_administer
  head :forbidden unless Current.user.can_administer?(@message)
end
```

**The exception is a subclass.** Direct-message rooms have a different rule — *everyone* in a DM can administer it. Don't sprinkle `if room.direct?` into the shared guard; override the guard in the controller subclass that *is* the exception:

```ruby
# (Campfire) Rooms::DirectsController — all users in a direct room can administer it
def ensure_can_administer
  true
end
```

The base controllers never learn that direct rooms exist.

**Not:** You will be tempted to copy-paste a creator check (`if @record.user == current_user || current_user.admin?`) into each mutating action, where it quietly drifts — or to reach for a permissions gem with per-model policy classes. Don't. One predicate; subclass overrides for genuine exceptions.

**Why:** A rule written once cannot drift sixteen ways. A rule's exception living in the class that is the exception means the conditional disappears with the branch (see `03-controllers-routing.md` for controller-subclassing mechanics).

---

## 8. Ambient self-registering gates

**When:** A security check must apply to *every* endpoint (ban enforcement, IP blocking, request screening) — anything where "the controller that forgot to opt in" would be a hole.

**Do:** Make the concern register its own `before_action` in `included do`, and include it once at the top of the tree. **`included do` is the wiring harness** — listing the concern IS the enforcement:

```ruby
# (Campfire) app/controllers/concerns/block_banned_requests.rb
module BlockBannedRequests
  extend ActiveSupport::Concern

  included do
    before_action :reject_banned_ip, unless: :safe_request?
  end

  private
    def reject_banned_ip
      head :too_many_requests if Ban.banned?(request.remote_ip)
    end

    def safe_request?
      request.get? || request.head?
    end
end
```

```ruby
# (Campfire) ApplicationController — one word in the include line guards every endpoint:
include AllowBrowser, Authentication, Authorization, BlockBannedRequests,
        SetCurrentRequest, SetPlatform, TrackedRoomVisit, VersionHeaders
```

The instant the concern is listed, every controller in the app is gated — no per-controller `before_action`, no list of "protected" endpoints to keep in sync, no controller that can forget to guard itself. **The include line IS the spec.**

Two craftsman details to copy:

- `unless: :safe_request?` — GET and HEAD pass; only mutating verbs (POST/PUT/PATCH/DELETE) are blocked. A banned machine can still *read*; it can't *act*.
- The response is `head :too_many_requests` — a 429, not a 403. It leaks nothing about *why*: to an attacker it reads as ordinary rate-limiting, not a targeted ban they could probe around.

**Not:** Don't sprinkle `before_action :reject_banned_ip` into individual controllers, and don't put the check in a Rack middleware where it loses access to your models and conventions for no benefit.

**Why:** There is no per-action vigilance because there is no per-action *anything* — the gate is wired once, structurally. Security becomes ambient.

---

## 9. Capability by subtraction

**When:** Granting a restricted actor (bot, API client, kiosk user) access to a slice of the app.

**Do:** Model the restricted actor as a regular user minus everything, then un-deny exactly the doors it needs. A bot (Campfire) is just a `User` with `role: :bot` (the same enum from §7) — denied everywhere by the ambient `before_action :deny_bots` (§4), with `allow_bot_access` reopening one action:

```ruby
# the bot messages endpoint — the ONE door:
class Messages::ByBotsController < ApplicationController
  allow_bot_access only: :create
  # ...
end
```

**Not:** You will be tempted to build a parallel permission set — a `BotPermission` model, a scopes column, a capability matrix. Don't. That's fifteen grants that drift from the human permission system. Subtraction is one denial removed.

**Why:** **Capability by subtraction** means the restricted actor's reachable surface is, like §4's public surface, *enumerable by grep* — every open door is a named `allow_bot_access`. Forgetting one fails closed: the bot gets denied, someone notices, nothing leaked. And because the bot is a `User`, it flows through `Current.user`, associations, and authorization-by-association with zero special cases — the polymorphism does the work the permission matrix would have done.

---

## 10. Fail closed at the network edge

**When:** Any code that decides whether outbound network access is safe — URL preview fetchers, webhook callers, anything that takes a user-influenced address (SSRF territory).

**Do:** Resolve every uncertainty toward "dangerous." If you can't *prove* an address is safe, refuse it:

```ruby
# (Campfire) lib/ — the SSRF guard for outbound fetches
def private_ip?(ip)
  IPAddr.new(ip).then do |ipaddr|
    ipaddr.private? || ipaddr.loopback? || ipaddr.link_local? ||
      ipaddr.ipv4_mapped? || ipaddr.ipv4_compat? || LOCAL_IP.include?(ipaddr)
  end
rescue IPAddr::InvalidAddressError
  true
end
```

Read the `rescue`. An address so malformed that `IPAddr` can't parse it returns `true` — *treat it as private, i.e. dangerous*. **Invalid means dangerous.**

**Not:** The instinct is `rescue => false` ("couldn't tell, let it through") — that is precisely the SSRF hole. Don't write a guard whose error path is more permissive than its success path.

**Why:** Fail-closed is secure-by-default echoed one layer down: every uncertainty resolves toward locked. The same instinct shows up in `Ban`'s validation (Campfire): an unparseable IP gets a validation *error* — banning is scoped to real, valid public addresses, and garbage input is rejected rather than half-trusted.

---

## 11. Signed-id capabilities

**When:** You need a shareable, expiring credential — a transfer link, an avatar URL servable without a session, a "log in on this other device" QR code, an unsubscribe link.

**Do:** Don't mint a tokens table. The credential is a **signed id** — Rails signs the record's id with a purpose and an expiry baked into the signature itself, and the URL carries it. Mint and verify live *co-located on the same concern*, so the contract is one screen:

```ruby
# (Campfire AND Fizzy — identical file in both products)
module User::Transferable
  extend ActiveSupport::Concern

  TRANSFER_LINK_EXPIRY_DURATION = 4.hours

  class_methods do
    def find_by_transfer_id(id)
      find_signed(id, purpose: :transfer)
    end
  end

  def transfer_id
    signed_id(purpose: :transfer, expires_in: TRANSFER_LINK_EXPIRY_DURATION)
  end
end
```

```ruby
# (Campfire) avatars — same shape, different purpose, hard-failing verify:
module User::Avatar
  class_methods do
    def from_avatar_token(sid)
      find_signed!(sid, purpose: :avatar)
    end
  end

  def avatar_token
    signed_id(purpose: :avatar)
  end
end
```

What you get for free:

- **No tokens table, no sweeper.** `expires_in:` is baked into the signature; an expired credential simply fails verification. There is no row to expire and no job to clean it (derive, don't store — the credential's validity is *derived* from cryptography and the clock, not stored as state).
- **No cross-purpose replay.** `purpose: :transfer` can't be presented where `purpose: :avatar` is expected — the verify names its purpose, and a mismatch fails. A leaked avatar URL cannot become a login.
- **Tamper-evidence.** A modified byte fails verification. The client holds an opaque claim the server minted and will re-verify — the same trust model as the session cookie itself.
- **The bang split (§3) applies:** `find_signed` returns nil for human-facing flows that should bounce gracefully; `find_signed!` raises for programmatic ones.

The session cookie is the same pattern (Fizzy): `cookies.signed.permanent[:session_token] = { value: session.signed_id, httponly: true, same_site: :lax }`, restored with `Session.find_signed(cookies.signed[:session_token])`. The credential IS the signed id, everywhere.

**Not:** You will be tempted to `create_table :tokens` with `code`, `purpose`, `expires_at`, `used` — plus the sweeper job and the uniqueness validation. Don't, *unless* the credential must be revocable one-at-a-time or short enough to type by hand (see §12 — a six-digit emailed code is the legitimate exception, and even then the table tracks no lifecycle).

**Why:** Count the edge cases the signed id absorbs for free: expiry without a sweeper, replay-across-purposes without a `purpose` column, tampering without a comparison, revocation-by-rotation via the app secret. An entire CRUD lifecycle, deleted.

---

## 12. Passwordless login with no tokens table

**When:** Building email-code / magic-link login. (Fizzy is the worked example throughout — Campfire is invite-only and has no passwordless flow.)

The naive schema breeds: a `login_tokens` table with `code`, `expires_at`, `used`, `consumed_at`, plus a `pending_logins` table for the browser that's mid-sign-in, plus a sweeper, plus a redeem-then-save race that can burn a valid code. Every one of those weights is optional. The whole feature is one small table with *no lifecycle columns*, one cookie, and CRUD.

### 12a. Consume means destroy

**Do:** A redeemable credential is spent by being *deleted*. "Already used" is the row's absence, not a column:

```ruby
# (Fizzy) the whole MagicLink model:
class MagicLink < ApplicationRecord
  CODE_LENGTH = 6
  EXPIRATION_TIME = 15.minutes

  belongs_to :identity

  scope :active, -> { where(expires_at: Time.current...) }
  scope :stale,  -> { where(expires_at: ..Time.current) }

  before_validation :generate_code, on: :create
  before_validation :set_expiration, on: :create

  validates :code, uniqueness: true, presence: true

  class << self
    def consume(code)
      active.find_by(code: Code.sanitize(code))&.consume
    end

    def cleanup
      stale.delete_all
    end
  end

  def consume
    destroy
    self
  end
end
```

`consume` destroys the row and returns `self` — the in-memory object survives (Active Record doesn't blank attributes on `destroy`), so the caller can still read `magic_link.identity` for the half-second it needs to mint the session. The double-redeem bug is gone *by construction*: the second redeem finds nothing, because `consume` looks up through `active.find_by` and the row no longer exists. Wrong code, expired code, already-used code — all the same outcome: `nil`.

**Expiry is read-time, cleanup is housekeeping.** The `active`/`stale` scopes are beginless/endless ranges — `Time.current...` means "from now onward," `..Time.current` means "up to now." A code is expired the moment the wall clock passes `expires_at`, with nothing written. `cleanup`'s `delete_all` reclaims disk; correctness *never* depended on it running, because `consume` only ever queries `active`. An expired code that's never swept is still un-redeemable. **Flags lie** — ask the clock instead.

**Not:** No `used` boolean (a flag you must flip at exactly the right instant, with a rollback race that burns valid codes), no `consumed_at`, no status enum, no sweeper-as-correctness.

### 12b. Pending-login state is a signed cookie, not a table

Between "user submitted their email" and "user typed the code back," something must remember *which email this browser is signing in as* — otherwise a code mailed to one email could be redeemed by a browser that claimed a different one.

**Do:** Put that one transient fact in a signed, `httponly`, self-expiring cookie on the browser doing the logging in:

```ruby
# (Fizzy)
def set_pending_authentication_token(magic_link)
  cookies[:pending_authentication_token] = {
    value: pending_authentication_token_verifier.generate(
      magic_link.identity.email_address, expires_at: magic_link.expires_at),
    httponly: true,
    same_site: :lax,
    expires: magic_link.expires_at
  }
end

def email_address_pending_authentication
  pending_authentication_token_verifier.verified(pending_authentication_token)
end

def pending_authentication_token_verifier
  Rails.application.message_verifier(:pending_authentication)
end
```

Signed (a forged byte fails `.verified` → `nil`, same as no cookie), `httponly` (page JS can't read it), and carrying the *same* `expires_at` as the magic link — set both as the verifier's expiry and the cookie's `expires:` — so the pending state dies on exactly the clock the code does. This is not "trusting client state": it's a tamper-evident claim the server minted and re-verifies, the same trust model as every Rails session cookie.

**Then enforce the binding at redeem with one constant-time compare:**

```ruby
# (Fizzy) magic links controller
def authenticate(magic_link)
  if ActiveSupport::SecurityUtils.secure_compare(
       email_address_pending_authentication || "", magic_link.identity.email_address)
    sign_in magic_link
  else
    email_address_mismatch
  end
end
```

The email sealed in *this* browser's cookie must equal the email on the *consumed* link. A victim's code typed into an attacker's browser fails the compare — the attacker's cookie says they're mid-login as themselves. `secure_compare` is constant-time, so the check leaks nothing through timing.

**Not:** No `pending_logins` table — a row born per login attempt, with its own cleanup and its own ownership check. The browser holds its own pending state, cryptographically sealed and time-bombed.

### 12c. Anti-enumeration by structural identity

A login form that behaves differently for known vs unknown emails is a free user directory: script a thousand guesses, watch which responses differ, harvest the customer list.

**Do:** Make the unknown-email path *construct the same object* the known path does — unsaved — and flow it through the *same* response code:

```ruby
# (Fizzy) SessionsController
def create
  if identity = Identity.find_by(email_address: email_address)
    sign_in identity
  elsif Account.accepting_signups?
    sign_up
  else
    redirect_to_fake_session_magic_link email_address
  end
end
```

```ruby
# (Fizzy) the fabrication — note: .new, never saved
def redirect_to_fake_session_magic_link(email_address, **options)
  fake_magic_link = MagicLink.new(
    identity: Identity.new(email_address: email_address),
    code: SecureRandom.base32(6),
    expires_at: MagicLink::EXPIRATION_TIME.from_now
  )

  redirect_to_session_magic_link fake_magic_link, **options
end
```

An unsaved `MagicLink.new` wrapping an unsaved `Identity.new`, with a real random code and a real-looking expiry — everything the downstream redirect reads, *nothing written to the database*. It flows into the exact same `redirect_to_session_magic_link` a genuine login uses: same pending cookie set, same redirect to the "enter your code" screen, same JSON branch. No email is mailed (no saved link, so no mailer fires) — but the attacker can't observe that. The unknown-email response is byte-identical to the known one because it *is* the same response.

**Not:** You will be tempted to fix enumeration with a matched branch — `render :ok if user_unknown` styled to look like the real page. Don't. Two hand-matched branches drift: a refactor adds a header or a flash to the real path, and the fake path falls one detectable byte out of sync. **Indistinguishability is guaranteed by shared code, not by matched branches.** There is no separate "user not found" rendering for an attacker to detect, because the codebase declines to ever build one.

(The same fail-closed instinct guards the other direction: Fizzy's `after_action :ensure_development_magic_link_not_leaked` *raises* outside development if a magic-link code ever appears in the flash — the response refuses to exist rather than leak.)

### 12d. Login is CRUD

**Do:** No `LoginController#authenticate`, no `/verify_code`. Two resources; login is their REST lifecycle:

```ruby
# (Fizzy) routes
resource :session do
  scope module: :sessions do
    resource :magic_link
  end
end
```

`magic_link#show` renders "enter your code"; `magic_link#create` redeems it:

```ruby
# (Fizzy) Sessions::MagicLinksController
def create
  if magic_link = MagicLink.consume(code)
    authenticate magic_link
  else
    invalid_code
  end
end
```

And minting the session is CRUD on the other noun:

```ruby
def start_new_session_for(identity)
  identity.sessions.create!(user_agent: request.user_agent, ip_address: request.remote_ip).tap do |session|
    set_current_session session
  end
end
```

Request a code = create a magic link. Redeem = create-by-consuming it. Log in = `sessions.create!`. Log out = destroy the session. **Verb-as-noun** — "log in" found its noun (see `03-controllers-routing.md` for the general rule). The controller is five lines because every hard part lives in the model: consume-means-destroy is `MagicLink#consume`, expiry is the `active` scope, the browser binding is the cookie.

**The audit:** after a successful login, count what persists — **one `Session` row**. The credential was destroyed on consume; the pending state was a cookie, now cleared; the unknown-email defense wrote zero rows. The double-redeem, the burned-code race, the orphaned pending row, the cross-browser mix-up, and the enumeration oracle are all absorbed by decisions that weren't about those edge cases at all.

---

## 13. The ban arc

**When:** Banning/blocking abusive users — or any feature where a punitive fact must outlive the things that prove it.

The naive version: flip `status: "banned"` on the user row, delete their messages in-request, sprinkle `redirect_if_banned` into controllers. Three holes: the live session keeps posting (the flag only bites on the *next* login, on controllers that remembered the check); the attacker re-registers a fresh account from the same machine in thirty seconds (the flag describes the *account*, not the *machine*); and the in-request `messages.each(&:destroy)` times out half-done with no transaction.

**Do — four pieces, and the order is the correctness:**

**1. Banning is creating a Ban (verb-as-noun).** `resource :ban, only: %i[ create destroy ]`; the controller is a stub — `@user.ban; redirect_to @user` — guarded by the same `ensure_can_administer` from §7. The controller doesn't know what banning entails.

**2. A ban is a durable fact about a NETWORK ADDRESS, not a flag on an account.** The fat-model transaction, read as an ordered checklist:

```ruby
# (Campfire) User::Bannable
def ban
  transaction do
    create_bans_from_sessions    # ① snapshot the evidence
    apply_ban                    # ② enforce
    banned!                      # ③ mark the account — LAST
  end
end

private
  def create_bans_from_sessions
    sessions.pluck(:ip_address).compact_blank.uniq.each do |ip|
      bans.create!(ip_address: ip)        # ① IPs frozen into durable Ban rows
    end
  end

  def apply_ban
    close_remote_connections               # ② kick live websockets
    sessions.delete_all                    # ③ the IPs lived HERE — now gone
    remove_banned_content_later            # ④ slow fan-out → job (see 08-jobs-background-work.md)
  end
```

**Transaction order IS the correctness.** The IPs live on the session rows; `sessions.delete_all` destroys them. Reorder — purge first, harvest second — and you harvest nothing: a ban with no teeth. `create_bans_from_sessions` runs first, copying each distinct session IP into a permanent `Ban` row *before* the purge; the Ban row is the durable shadow of a fact about to be destroyed. A ban must outlive the session (deleted at step ③) and the account (maybe deleted later) — so the durable fact is lifted out of the disposable rows and frozen. The transaction makes snapshot + purge + status one atomic act: never sessions-deleted-but-IPs-unrecorded, never IPs-recorded-but-account-still-active. The status flip is the *last* line: the account is marked banned only once the evidence is frozen and the doors are shut.

**3. Content removal is deferred, enqueued on commit.** `remove_banned_content_later` is a one-line `perform_later` wrapper; the job is a thunk delegating back to a model verb. Correctness-critical work (snapshot, purge, flip) stays in-band inside the transaction; the unbounded fan-out leaves the request. Because `perform_later` enqueues on commit, a rolled-back ban never spawns a destruction job — `_commit` means after-durable. (Altitude mechanics: `08-jobs-background-work.md`.)

**4. Enforcement is the ambient gate from §8.** `Ban.banned?(request.remote_ip)` — one indexed `exists?`:

```ruby
# (Campfire)
def self.banned?(ip_address)
  exists?(ip_address: ip_address)
end
```

The enforcement reads from the durable rows the transaction froze — the session is long gone; the Ban row answers. Installed app-wide by the one word `BlockBannedRequests` in the include line; mutations-only via `unless: :safe_request?`; answering 429 so it reads as rate-limiting, not a targeted ban.

**Unban is the inverse CRUD:** `bans.delete_all` then `active!`, also in a transaction — destroy the noun's rows, restore the status. No special-cased reversal path.

**Not:** Don't flip a flag and call it a ban; don't delete content in-request; don't scatter per-controller checks; don't write the unban as bespoke cleanup logic.

**Why:** Honest threat model: an IP ban is a speed bump, not a cryptographic lock — it kills the trivial re-entry (same machine, new account) that constitutes most casual abuse; determined VPN evasion is a different threat model. Count what the design absorbs: the ordering absorbs "the ban with no teeth," the transaction absorbs "the contradictory half-state," `perform_later`-on-commit absorbs "the timeout" and "the job for a rolled-back ban," and the one-word include absorbs "the controller that forgot to guard itself."

---

## 14. Red flags → fixes

Scan any diff for the left column; each is a hole with a named fix above.

| Red flag | Fix | § |
|---|---|---|
| `Model.find(params[:id])` near (or missing) a permission check | Load through `Current.user`'s associations | 2 |
| Permission filtering *after* a query (`results.select { user can see }`) | Auth as the left half of the chain — scope first, query second | 2 |
| A 403 for a record the user shouldn't know exists | 404 via through-the-user `find`/`find_by!` | 2, 3 |
| One failure mode for both API and human navigation | The bang split: `find_by!` hard, `find_by` + redirect soft, `\|\| default` for restoration | 3 |
| New actions public until someone guards them | `before_action :require_authentication` in `included do`; named opt-out macros | 4 |
| Can't answer "which endpoints are public?" without reading every controller | Grep the opt-out verbs — the attack surface must be enumerable | 4 |
| Auth strategy dispatch via config/registry/`case` | The OR-chain in priority order | 5 |
| `skip_forgery_protection` on a whole controller for one bot client | `protect_from_forgery unless: -> { authenticated_by.bot_key? }` | 6 |
| Creator/admin checks copy-pasted per action | One `can_administer?` predicate; one `before_action`; subclass override for exceptions | 7 |
| `if record.special_kind?` inside a shared guard | Override the guard in the subclass that IS the exception | 7 |
| Per-controller wiring of an app-wide check | Self-registering concern: `before_action` in `included do`, included once | 8 |
| A blocked response that explains itself (403 + reason) | `head :too_many_requests` — leak nothing | 8 |
| A permission matrix / parallel grants for a bot or API actor | Capability by subtraction: deny everywhere, `allow_*` one door | 9 |
| `rescue => false` in a safety predicate | Fail closed: invalid means dangerous, `rescue => true` | 10 |
| A tokens table with `purpose`/`expires_at`/`used` + sweeper | `signed_id(purpose:, expires_in:)` + `find_signed(!)` co-located on a concern | 11 |
| A `used`/`consumed_at` column on a redeemable credential | Consume means destroy — spent IS the row's absence | 12a |
| Expiry as a status flipped by a scheduled job | Beginless/endless range scopes — expiry is read-time; cleanup is housekeeping, never correctness | 12a |
| A `pending_logins` (or similar in-flight-state) table | Signed httponly self-expiring cookie; `secure_compare` binding at redeem | 12b |
| Different responses for known vs unknown emails — or two hand-matched branches | Fabricate the unsaved object, flow it through the SAME path | 12c |
| `LoginController#authenticate` / `/verify` custom actions | `resource :magic_link` under `resource :session`; login = `sessions.create!` | 12d |
| Ban/suspend as a flag on the account row | A durable row about the network address, snapshotted BEFORE its source is deleted | 13 |
| Multi-step state change without a transaction, or with the status flipped first | Ordered checklist in one transaction; evidence first, status last | 13 |
| Slow fan-out inside the security-critical request | Defer to a job enqueued on commit | 13 |

One sentence to carry out of this file: at every layer, the safe path must also be the *only ergonomic path* — load through the user, default closed, name the exceptions, destroy the spent credential, freeze the durable fact before deleting its source — so that security survives a growing codebase and a tired developer, because nothing was left to vigilance.
