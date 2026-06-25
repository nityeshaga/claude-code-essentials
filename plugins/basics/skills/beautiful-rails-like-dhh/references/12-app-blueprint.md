# The App Blueprint — Starting and Structuring a 37signals-Shaped Repo

Read when starting a new Rails app, deciding where a class belongs, choosing the stack, orienting in an unfamiliar codebase, or feeling the pull toward a service object, a gem, or a build step.

This file is the map — how an app hangs together and what to refuse. Each mechanic is owned by a layer file: models `02`, controllers/routing `03`, views `04`, Turbo `05`/`06`, Stimulus `07`, jobs `08`. Worldview is `01-doctrine.md`; the stack-vs-SPA argument is `00-frontend-first-principles.md`.

---

## 1. The architectural refusals

When you're about to create a class named for *code organization* rather than a *domain noun* (`MessageCreator`, `SignupForm`, `RecentCardsQuery`, `UserPresenter`, `app/services/`): refuse the layer. A 37signals app has exactly the directories `rails new` made; the domain lives in rich models composed from concerns, with helpers serving views. Neither Campfire nor Fizzy has `app/services`, `app/forms`, `app/queries`, or `app/presenters`. That convergence is doctrine.

| The class you're about to create | The vanilla move |
|---|---|
| Service object (`MessageCreator`, `BanUserService`) | The model owns the consequence: a model verb (`room.receive(message)`) or a concern callback — `02` |
| Form object (`SignupForm`) | A model verb wrapping the transaction; or a PORO that is a *real domain noun* in `app/models` (below) |
| Query object (`RecentMessagesQuery`) | A scope or association-extension block — `02` |
| Presenter / decorator (Draper) | A helper with domain vocabulary, or a model method if it's the model's fact — `04` |
| Policy object (Pundit) | Security is the shape of data access: load every record *through* `Current.user` so the unauthorized version is an IDOR you can't type — `01` P3 |
| Interactor / `.call` command | A verb pretending to be a thing — find the noun (next section) |

A service layer is a second boundary with *no* conventions: every service invents its own signature, return type, and error style, and none get callbacks, validations, scopes, or `dom_id` for free. The first one legitimizes the directory; within a year the models are anemic structs and the domain lives in a parallel un-Railsy framework you maintain. The layer is the bug.

**The honest nuance, from their STYLE.md:** "when justified, it is fine to use services or form objects, but don't treat those as special artifacts," e.g. `Signup.new(email_address:).create_identity`. `Signup` is a noun a user recognizes, lives in `app/models/signup.rb`, reads like a model. Banned is the *artifact* — the `app/services` dir, the `ApplicationService` base class, the `.call` convention. A PORO model is vanilla Rails (`02`, "Truth without a table"); a service layer is a framework fork.

---

## 2. Find the noun or the trait

When the refusal leaves you holding logic that needs a home, it's always one of two shapes.

**Verb-shaped** (`BanUser`, `CloseCard`, `ResetPassword`) → **find the noun.** Every custom action is CRUD on a hidden noun: banning is creating a `Ban`, closing a card is a `Closure` (Fizzy), resetting is a `PasswordReset`. The noun gets a (often tiny) model, a `resource` route, a two-line controller — `03`.

```ruby
# The urge: a BanUserService, or `post :ban` on UsersController
# The move: the noun was Ban all along             (Campfire)
resources :users, only: :show do
  scope module: "users" do
    resource :ban, only: %i[ create destroy ]
  end
end
```

**Capability-shaped** (`searchable`, `broadcastable`, `has an avatar`) → **find the trait.** The capability becomes a concern at `app/models/<noun>/<trait>.rb`; the include line grows by one word and IS the spec — `02`.

```ruby
class Message < ApplicationRecord
  include Attachment, Broadcasts, Mentionee, Pagination, Searchable   # (Campfire)
```

Noun and trait are the only two homes Rails has conventions for, and conventions absorb the edge cases. Don't dump the logic in the controller "for now" — a fact about a Message is true no matter who created it; controller copies drift.

---

## 3. Vanilla-Rails maximalism: exhaust the framework first

When something smells like "there's probably a gem for this" (tokens, expiring links, image resizing, value vocabularies, URL helpers with behavior), assume Rails already ships it. Most agents use a tenth of its surface. Check these built-ins first.

**Signed ids — the tokens table you never create:**

```ruby
token = user.signed_id(purpose: :password_reset, expires_in: 15.minutes)
user  = User.find_signed!(params[:token], purpose: :password_reset)
# raises if expired, tampered, or generated for a different purpose — nothing stored, nothing to sweep
```

**Message verifiers — sign any value, not just records:**

```ruby
verifier = Rails.application.message_verifier(:room_invite)   # (Campfire-style)
code     = verifier.generate(room.id, expires_in: 1.week)
room_id  = verifier.verified(params[:code])   # nil if invalid — no exception to rescue
```

**Enum — a whole vocabulary in one line** (predicates, scopes, bang-setters; `02`):

```ruby
enum :involvement, %w[ invisible nothing mentions everything ].index_by(&:itself), default: :mentions   # (Campfire)
```

**Direct routes — a URL helper that carries behavior:**

```ruby
direct :fresh_user_avatar do |user, options|                  # (Campfire)
  route_for :user_avatar, user, v: user.updated_at.to_fs(:number), **options
end
# fresh_user_avatar_path(user) busts CDN/browser caches automatically — updated_at changes when the avatar does
```

**ActiveStorage variants — the image pipeline you don't build:**

```ruby
has_one_attached :avatar do |attachable|
  attachable.variant :thumb, resize_to_limit: [ 128, 128 ]
end
# <%= image_tag user.avatar.variant(:thumb) %> — no resize lambda, no imgproxy
```

Also waiting in the framework: `ActiveSupport::CurrentAttributes` (§7), `Rails.cache` + `touch:` chains, `has_secure_password`, `generates_token_for`, controller rate limiting, `params.expect`/strong params, ActionMailer previews, fixtures as the seed system.

Don't reach for Devise, JWT gems, friendly_id, or a pagination gem on day one — each wraps something Rails does in fewer lines than the gem's config, and is a moving part (version, CVE feed, DSL, upgrade to sequence). Campfire hand-rolls sessions in one concern; both products paginate with plain scopes.

---

## 4. When a gem IS justified

Add a gem only when it sits in one of these categories — which is what Campfire's and Fizzy's Gemfiles actually contain:

| Category | Examples | Why it clears the bar |
|---|---|---|
| Crypto you must not hand-roll | `bcrypt` | Getting it wrong is a security incident |
| Protocol / format codecs | `web-push`, `rqrcode`, `image_processing` | A wire format or spec with hostile inputs |
| Infrastructure adapters | `kamal`, `thruster`, DB drivers, `redis` | Talks to systems outside your process |
| The Hotwire/Rails family | `turbo-rails`, `stimulus-rails`, `importmap-rails`, `propshaft`, `solid_queue` | First-party; it IS the framework |

Never add a gem that *organizes your code* — interactors, decorators, authorization DSLs, soft-delete frameworks, admin panels, view-components, pagination DSLs. The test: *does this gem do something outside Ruby's reach (crypto, codecs, other processes), or does it tell me how to arrange Ruby I could arrange myself?* The first removes risk; the second removes Rails.

---

## 5. The one-person-framework stack

At `rails new` time, pick the stack where every choice *deletes a moving part*. This is what Campfire ships to paying customers.

| Agent default | 37signals choice | The moving part deleted |
|---|---|---|
| Postgres on a managed service | **SQLite in production** | The DB *server*: no second host, no pool tuning, no network hop. Backups are file copies (or Litestream). |
| Elasticsearch | **SQLite FTS5** (Campfire) / sharded MySQL full-text (Fizzy at scale) | The search cluster. FTS5 lives in the data file, syncs via callbacks. |
| Redis + Sidekiq | **Solid Queue** — DB-backed jobs (Fizzy) | Redis. Jobs are rows in your DB, inspectable with SQL, transactional with your writes. |
| Redis cache | **Solid Cache** | Redis, again. |
| webpack / esbuild / Vite + node | **Import maps + Propshaft** | Node, `node_modules`, build step, transpiler, watcher. JS ships as the ES modules you wrote. |
| Sass / Tailwind | **Plain CSS** — nesting, custom properties, `:has()`, container queries | The preprocessor and its config. |
| Devise | **A hand-rolled sessions concern** (~one screen) | A DSL larger than the problem. A `Session` model, a signed cookie, one concern (§7). |

Don't dismiss SQLite-in-production as a toy and "upgrade" preemptively. Campfire is real-time chat with websockets, push, attachments, and full-text search on this exact stack. SQLite's single-writer model only bites at write volumes most products never see; WAL mode handles enormous read concurrency. Choose the bigger stack when you have the bigger numbers. Every deleted part is something you'd otherwise provision, monitor, secure, upgrade, and debug at 3am.

---

## 6. The directory shape: three trees that are one tree

The directory listing restates the include lines; the controller folders restate the routes. From Campfire:

```
app/
  models/
    message.rb                  # include Attachment, Broadcasts, Mentionee, Pagination, Searchable
    message/
      attachment.rb             # module Message::Attachment   ← one file per word in the include line
      broadcasts.rb
      mentionee.rb  pagination.rb  searchable.rb
    user.rb                     # include Avatar, Bannable, Bot, Mentionable, Role, Transferable
    user/  avatar.rb  bannable.rb  bot.rb  ...
    rooms/                      # STI subclasses: Rooms::Open, Rooms::Closed, Rooms::Direct
      open.rb  closed.rb  direct.rb
    concerns/                   # ONLY cross-model traits (a Searchable shared by several nouns)
    current.rb                  # ActiveSupport::CurrentAttributes (§7)
  controllers/
    rooms_controller.rb  messages_controller.rb
    users/  bans_controller.rb  # Users::BansController ← created by scope module: "users"
    messages/  boosts_controller.rb
    concerns/  authentication.rb
  jobs/
    room/  push_message_job.rb   # two-line thunk delegating to a model verb (08)
  helpers/  views/
lib/                            # work that escapes the Rails executor — see 08
```

- **`app/models/<noun>/<trait>.rb` mirrors the include line.** `include Attachment` inside `Message` resolves to `Message::Attachment` in `message/attachment.rb`. Reading the include line and `ls app/models/message/` give the same list. Use `app/models/concerns/` *only* when several nouns share a trait; default to the namespaced folder.
- **Controller folders mirror the route tree via `scope module:`.** `resources :users { scope module: "users" { resource :ban } }` → URL `/users/:user_id/ban`, class `Users::BansController`, file `app/controllers/users/bans_controller.rb`. The URL is the path.
- **Jobs are thunks named for the model verb they trigger** — `Room::PushMessageJob` performs `room.push_message_now(...)`; the logic is in the model (`08`).
- **`lib/` is for code that must run outside the Rails executor** — long-lived processes, web-push pools, anything that'd deadlock holding an executor permit. Domain logic stays in `app/models`; `lib/` is the escape hatch, not the junk drawer (`08`).

Rails' constant resolution *enforces* the model mirror and `scope module:` *enforces* the controller mirror, so drift is impossible and learning any one tree teaches all three.

---

## 7. Current attributes: ambient request state, set once

When many layers need to know *who is acting* (and *which account* in multi-tenant apps), define a `Current` singleton and set it in exactly one place — a controller concern's `before_action`.

```ruby
# app/models/current.rb
class Current < ActiveSupport::CurrentAttributes
  attribute :user
  attribute :request_id, :user_agent, :ip_address
  delegate :account, to: :user, allow_nil: true
end
```

```ruby
# app/controllers/concerns/authentication.rb            (Campfire-shaped)
module Authentication
  extend ActiveSupport::Concern
  included do
    before_action :authenticate
  end

  class_methods do
    # secure-by-default, opt-out-by-name: a controller must NAME its public surface
    def allow_unauthenticated_access(**options)
      skip_before_action :authenticate, **options
    end
  end

  private
    def authenticate
      if session = find_session_by_cookie
        Current.user = session.user
      else
        redirect_to new_session_url
      end
    end

    def find_session_by_cookie
      Session.find_by(id: cookies.signed[:session_token])
    end
end
```

Once set, the request breathes it — the payoff is deleted parameters everywhere:

```ruby
class Message < ApplicationRecord
  belongs_to :creator, class_name: "User", default: -> { Current.user }   # (Campfire)
end

@message = @room.messages.create!(message_params)   # creator filled in by the default
```

Fizzy runs all multi-tenancy this way: middleware sets `Current.account` from the URL slug, every model carries `account_id`, and jobs serialize/restore `Current.account` across the queue boundary (`08`).

Keep `Current` to identity and request facts only (`user`, `account`, `request_id`, `user_agent`, `ip_address`) — written in one concern, *read* by models (defaults, scopes) but never written by them. The executor resets it between requests/jobs so it can't leak, but only if it stays small. The alternative — threading `user:` through every signature — bloats a hundred seams to carry a constant.

---

## 8. STYLE.md — 37signals' written law, distilled

37signals ships a STYLE.md inside their repos (Fizzy's is canonical). The standard: "We care about how code reads, how code looks, and how code makes you feel when you read it." The one instruction that is pure doctrine for an agent: **when writing new code, find similar code elsewhere in the app and imitate it** — prior art over invention.

**Law 1 — Expanded conditionals over guard clauses.** Default to a visible `if/else`, not scattered `return-unless`:

```ruby
# Bad
def todos_for_new_group
  ids = params.require(:todolist)[:todo_ids]
  return [] unless ids
  @bucket.recordings.todos.find(ids.split(","))
end
# Good
def todos_for_new_group
  if ids = params.require(:todolist)[:todo_ids]
    @bucket.recordings.todos.find(ids.split(","))
  else
    []
  end
end
```

Two sanctioned exceptions: a guard *right at the top*, or when the main body is non-trivial:

```ruby
def after_recorded_as_commit(recording)
  return if recording.parent.was_created?
  if recording.was_created?
    broadcast_new_column(recording)
  else
    broadcast_column_change(recording)
  end
end
```

**Law 2 — Method ordering:** `class` methods first, then `public` with `initialize` at top, then `private`.

**Law 3 — Invocation order:** order methods vertically by *when they're called*, so top-to-bottom reading replays execution.

**Law 4 — Bang discipline:** use `!` *only* when a non-bang twin exists (`save`/`save!`). Never to flag "destructive."

**Law 5 — Visibility-modifier layout:** no blank line under `private`, indent the methods beneath it:

```ruby
class SomeClass
  def some_method
  end

  private
    def some_private_method
    end
end
```

Exception: a module that is *entirely* private marks `private` at the top, adds a blank line, does not indent.

**Law 6 — CRUD controllers.** When an action doesn't map to a CRUD verb, introduce a resource — never a custom action:

```ruby
# Bad: resources :cards do; post :close; post :reopen; end
# Good:                                             (Fizzy)
resources :cards do
  resource :closure
end
```

**Law 7 — Thin controllers, rich models, no connecting artifacts.** Controllers directly invoke the domain; complex behavior gets an intention-revealing model API:

```ruby
class Cards::CommentsController < ApplicationController
  def create
    @comment = @card.comments.create!(comment_params)
  end
end

class Cards::GoldnessesController < ApplicationController     # (Fizzy)
  def create
    @card.gild
  end
end
```

**Law 8 — Shallow jobs, `_later`/`_now` suffixes.** Jobs delegate to models; an enqueuing method ends `_later`, its synchronous twin `_now`:

```ruby
module Event::Relaying                                          # (Fizzy)
  extend ActiveSupport::Concern
  included do
    after_create_commit :relay_later
  end

  def relay_later
    Event::RelayJob.perform_later(self)
  end

  def relay_now
  end
end

class Event::RelayJob < ApplicationJob
  def perform(event)
    event.relay_now
  end
end
```

Note `after_create_commit` (never plain `after_create` — `_commit` means after-durable, or you relay the ghost row). Full job doctrine in `08`.

---

## 9. Underdo: what to refuse to build

When scoping a product or milestone, build five features that work perfectly over twenty that mostly work. The smaller surface IS the advantage: every feature you don't build is support you don't answer, bugs you don't fix, UI the user doesn't wade through. Campfire ships a product companies pay Slack per-seat for, with roughly a dozen models.

| The thing you're about to build | What to do instead |
|---|---|
| Admin framework / panel gem | `rails console` is the admin. If operators need UI, add one or two owner-scoped resourceful controllers for the actual operations. |
| A settings page | Pick the good default and hardcode it. Add the setting when real users diverge — Campfire's rooms get *one* involvement enum. |
| A premature API (`/api/v1`, serializers, tokens) | The HTML controllers ARE the API. Campfire's bots POST to the same endpoints humans use — a bot is a User with a bot role. |
| A roles-and-permissions matrix | One `role` enum (`member / administrator / bot`) + data-access shape (P3). Add granularity when a real workflow demands it. |
| Soft delete / paranoia framework | `destroy` means destroy; `dependent: :destroy` cascades; backups handle regret. If "archived" is a real state, it's a noun (an `Archival` row), not a flag. |
| A feature-flag system | Deploy small changes often; branch in git, not in production state. |

Don't build these up front for "we'll need it eventually" — each is a second product hiding inside yours, and each is easy to add later in the rare case eventually arrives. The asymmetry: a feature costs its build time once and its existence forever. A small app stays holdable in one head, which is the precondition for everything else here.

---

## 10. The feature build order

Build in this order, asking one question per step. The order front-loads expensive-to-reverse decisions (schema, nouns) and back-loads cheap ones (polish); each step's output is the next step's input.

1. **Model + migration.** *What is the noun, and whose fact is this?* Find the smallest honest schema: derive, don't store (`02`); before adding a table, ask whether an existing join row can carry the fact — Campfire rides presence (`connected_at`), read-state (one nullable `unread_at`), and involvement (one enum) on the `Membership` join row.
2. **Routes.** *Did I find the noun?* If you're typing `post :something`, you didn't. Nest under the parent, use `scope module:` so the controller lands where the URL says (`03`).
3. **Controller.** *Am I about to write an `if`?* The action is ~two lines: load through `Current.user`, call one model verb. Logic here belongs one level down.
4. **View.** *Will every path render this exact partial?* One partial per noun, root addressed by `dom_id` — first load, edit, broadcast, and search result must all paint with the same renderer or they drift (`04`).
5. **Turbo.** *Replace or refresh?* For multiplayer pages, the morphing pair — `turbo_stream_from` + `broadcasts_refreshes` riding the `touch:` chain (`06`). For append feeds, targeted streams: subscribe, broadcast the same partial to the `dom_id` (`05`).
6. **Polish.** *What's still manual?* Stimulus now, only as generic `data-*`-configured controllers (`07`). Fragment caching keyed on the record. Preload scopes for new N+1s.

A feature this way is typically six small files — and steps 5–6 are often *zero* new files, because the `touch:`, `dom_id`, and one partial from steps 1–4 are exactly what Turbo composes. Don't start at step 6: UI-first inverts the dependency graph, inventing client state, wire formats, and endpoints for a frontend that doesn't know the truth yet.

---

## 11. The ten-minute orientation: an unfamiliar codebase

Dropped into a Rails codebase you've never seen, resist scrolling the biggest file. Three moves orient you:

```
  1. ls app/models          →  the NOUNS    (what the domain is)
        message.rb, room.rb, user.rb, membership.rb, ban.rb ...
  2. read the include lines →  the SPEC     (what each noun can do)
        include Attachment, Broadcasts, Mentionee, Pagination, Searchable
        └────────── each is a file in app/models/<noun>/ ──────────┘
  3. read routes.rb         →  the VERBS    (every state change, as CRUD)
        resources :rooms do resources :messages end
        resource  :ban, only: %i[ create destroy ]
```

- **Move 1:** the domain lives in `app/models`; controllers are plumbing. Read the nouns first and the verbs make sense.
- **Move 2:** the include line is the table of contents. `include Avatar, Bannable, Bot, Mentionable, Role, Transferable` tells you the shape in two seconds; each word is a file. Want to know how search works? Open `message/searchable.rb` — twenty-odd self-contained lines.
- **Move 3:** `routes.rb` is the sitemap of every state change. Notice the verbs that are nouns (`resource :ban`, `resource :closure`) — each a tiny controller and usually a tiny model.

Two reading habits:
- **The missing subsystem is the lesson.** No presence sweeper, no read-receipts table, no "live update pipeline" — don't hunt for where it's hidden. Presence is a timestamp vs a 60-second window; read-state is one nullable column; live update and HTTP response are the same partial over two transports. Each absent subsystem is a convention absorbing it.
- **A suspiciously short line is doing the other nine-tenths.** `belongs_to :room, touch: true` is one token absorbing an entire stale-cache bug class.

---

## 12. Red flags → fixes

| Red flag | The fix |
|---|---|
| `app/services/`, `app/forms/`, `app/queries/`, `app/presenters/` | Refuse the layer; find the noun or the trait (§1–2) |
| A class named `SomethingService`/`Manager`, or with `.call` | A verb pretending to be a thing — noun gets a model, model gets a verb |
| A PORO "special artifact" with its own base class | Fine as a plain domain noun in `app/models` (the `Signup` exception); kill the layer ceremony |
| Reaching for a tokens table + expiry sweeper | `signed_id(purpose:, expires_in:)` / `find_signed!` |
| Adding Devise / soft-delete / pagination / admin gem | Hand-roll the concern, destroy means destroy, write the scope, use the console (§3–4, §9) |
| `package.json` in a Rails app | Import maps + Propshaft; no node, no build step (§5) |
| Postgres + Redis + Sidekiq for a small product "to be safe" | SQLite + Solid Queue + Solid Cache until real numbers demand otherwise (§5) |
| A trait in `app/models/concerns/` used by exactly one model | Move to `app/models/<noun>/<trait>.rb` (§6) |
| Flat `user_bans_controller.rb` | `scope module: "users"` → `app/controllers/users/bans_controller.rb` (§6) |
| `current_user` threaded as a parameter through model methods | `Current.user` set once in the auth concern (§7) |
| `Current` accumulating carts, flags, toggles | `Current` holds identity + request facts only, written in one place |
| A `post :close` / `post :archive` custom action | `resource :closure` / `resource :archival` — Law 6 (§8, `03`) |
| A job with real logic in `perform` | Two-line thunk delegating to a model `_now`; enqueue via `_later` (§8, `08`) |
| Settings page / admin framework / `/api/v1` in the first milestone | Refuse; hardcode the default, console is the admin, HTML controllers are the API (§9) |
| Building the interactive UI before the model exists | Run the build order forward (§10) |
| Orienting by scrolling the biggest file | `ls app/models` → include lines → `routes.rb` (§11) |