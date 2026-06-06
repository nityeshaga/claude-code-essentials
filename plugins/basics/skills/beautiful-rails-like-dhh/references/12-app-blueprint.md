# The App Blueprint — Starting and Structuring a 37signals-Shaped Repo

Read this when you are starting a new Rails app, deciding where a new class belongs, choosing the stack, orienting in an unfamiliar codebase, or feeling the pull toward a service object, a gem, or a build step.

## Contents

1. [The architectural refusals](#1-the-architectural-refusals)
2. [What to do with the urge: find the noun or the trait](#2-what-to-do-with-the-urge-find-the-noun-or-the-trait)
3. [Vanilla-Rails maximalism: exhaust the framework first](#3-vanilla-rails-maximalism-exhaust-the-framework-first)
4. [When a gem IS justified](#4-when-a-gem-is-justified)
5. [The one-person-framework stack](#5-the-one-person-framework-stack)
6. [The directory shape: three trees that are one tree](#6-the-directory-shape-three-trees-that-are-one-tree)
7. [Current attributes: ambient request state, set once](#7-current-attributes-ambient-request-state-set-once)
8. [STYLE.md — 37signals' written law, distilled](#8-stylemd--37signals-written-law-distilled)
9. [Underdo: what to refuse to build](#9-underdo-what-to-refuse-to-build)
10. [The feature build order](#10-the-feature-build-order)
11. [The ten-minute orientation: an unfamiliar codebase](#11-the-ten-minute-orientation-an-unfamiliar-codebase)
12. [Red flags → fixes](#12-red-flags--fixes)

Scope: this file is the map — how an app hangs together and what to refuse. Every mechanic it names is owned by a layer file: models in `02-models.md`, controllers/routing in `03-controllers-routing.md`, views in `04-views-helpers.md`, Turbo in `05-turbo-frames-streams.md` and `06-morphing-live-updates.md`, Stimulus in `07-stimulus-widgets.md`, jobs in `08-jobs-background-work.md`. The worldview is `01-doctrine.md`; the stack-vs-SPA argument is `00-frontend-first-principles.md`.

---

## 1. The architectural refusals

**When:** any time you are about to create a class whose name describes *code organization* rather than a *domain noun* — `MessageCreator`, `SignupForm`, `RecentCardsQuery`, `UserPresenter`, `app/services/` itself.

**Do:** refuse the layer. A 37signals app has exactly the directories `rails new` made, and the domain lives in rich models, composed from concerns, with helpers serving the views. Both Campfire and Fizzy ship whole products this way — there is no `app/services`, no `app/forms`, no `app/queries`, no `app/presenters` in either codebase. That convergence is doctrine.

| The class you're about to create | What the urge is telling you | The vanilla move |
|---|---|---|
| Service object (`MessageCreator`, `BanUserService`) | A consequence with no home | The model owns the consequence: a model verb (`room.receive(message)`) or a callback inside a concern — see `02-models.md` |
| Form object (`SignupForm`) | A transaction spanning several models | A model verb that wraps the transaction; or a PORO that is a *real domain noun* living in `app/models` (see below) |
| Query object (`RecentMessagesQuery`) | A query too gnarly for one line | A scope, or an association-extension block — see `02-models.md` |
| Presenter / decorator (`UserPresenter`, Draper) | View logic with no home | A helper with a domain vocabulary, or a model method if it's the model's fact — see `04-views-helpers.md` |
| Policy object (Pundit-style) | Authorization sprawl | Security is the shape of your data access: load every record *through* `Current.user` so the unauthorized version is the IDOR you cannot type — see `01-doctrine.md` P3 |
| Interactor / operation / command with `.call` | A verb pretending to be a thing | Find the noun (next section) |

**Not:** you will be tempted to add "just one" service object because *this* workflow feels too big for a model — don't. The first service object legitimizes the directory, the directory attracts every subsequent workflow, and within a year the models are anemic structs and the actual domain logic lives in a parallel un-Railsy framework you now maintain. The layer is the bug.

**Why:** Rails stays small because each layer trusts a convention at its boundary. A service layer is a second boundary with *no* conventions — every service decides its own signature, return type, and error style, and none of them get callbacks, validations, scopes, or `dom_id` for free. Count the edge cases the layer absorbs: zero. Count the ones the model would have absorbed: all of them.

**The honest nuance, from 37signals' own law:** their STYLE.md says "when justified, it is fine to use services or form objects, but don't treat those as special artifacts," with this example:

```ruby
Signup.new(email_address: email_address).create_identity
```

Read that carefully: `Signup` is a noun a user would recognize, it lives in `app/models/signup.rb`, and it reads like a model. What's banned is the *artifact* — the `app/services` directory, the `ApplicationService` base class, the `.call` convention. A PORO model is vanilla Rails (see `02-models.md`, "Truth without a table"); a service layer is a framework fork.

---

## 2. What to do with the urge: find the noun or the trait

**When:** the refusal above leaves you holding logic that genuinely needs a home.

**Do:** classify the urge. It is always one of two shapes:

**Verb-shaped** (`BanUser`, `CloseCard`, `ResetPassword`, `JoinRoom`) → **find the noun.** Every custom action is CRUD on a hidden noun. Banning a user is the creation of a `Ban`. Closing a card is the creation of a `Closure` (Fizzy). Resetting a password is creating a `PasswordReset`. The noun gets a model (often tiny), a `resource` route, and a two-line controller — see `03-controllers-routing.md` for the full verb-as-noun discipline.

```ruby
# The urge: a BanUserService, or `post :ban` on UsersController
# The move: the noun was Ban all along             (Campfire)
resources :users, only: :show do
  scope module: "users" do
    resource :ban, only: %i[ create destroy ]
  end
end
```

**Capability-shaped** (`searchable`, `broadcastable`, `has an avatar`, `can be banned`) → **find the trait.** The capability becomes a concern at `app/models/<noun>/<trait>.rb`, and the model's include line grows by one word. The include line IS the spec — see `02-models.md` for the concern grammar.

```ruby
class Message < ApplicationRecord
  include Attachment, Broadcasts, Mentionee, Pagination, Searchable   # (Campfire)
```

**Not:** you will be tempted to skip the classification and dump the logic in the controller "for now" — don't. A controller exists once per request shape; a fact about a Message is true no matter who created it or how. Put it in the controller and you'll re-type it in every place that creates a message and watch the copies drift.

**Why:** noun and trait are the only two homes Rails has conventions for — and conventions are what absorb the edge cases. A noun gets routes, a controller, validations, callbacks. A trait gets `included do` wiring and a file the next reader can find from the include line alone. Everything else is a home you'd have to invent and maintain.

---

## 3. Vanilla-Rails maximalism: exhaust the framework first

**When:** you need tokens, expiring links, image resizing, value vocabularies, URL helpers with extra behavior — anything that smells like "there's probably a gem for this."

**Do:** assume Rails already ships it, because it usually does. The framework's full surface is enormous and most agents use a tenth of it. Before adding any dependency, check these built-ins:

**Signed ids — the tokens table you never create:**

```ruby
# Password reset / magic link: no tokens table, no expiry column, no cleanup sweeper
token = user.signed_id(purpose: :password_reset, expires_in: 15.minutes)

# Later, in the controller:
user = User.find_signed!(params[:token], purpose: :password_reset)
# raises if expired, tampered with, or generated for a different purpose
```

Count the edge cases this line absorbs for free: expiry, tampering, purpose-confusion (a reset token used as a login token), and cleanup — there is nothing to sweep because there is nothing stored.

**Message verifiers — sign any value, not just records:**

```ruby
# A QR-code room invite that expires            (Campfire-style)
verifier = Rails.application.message_verifier(:room_invite)
code     = verifier.generate(room.id, expires_in: 1.week)
room_id  = verifier.verified(params[:code])   # nil if invalid — no exception to rescue
```

**Enum — a whole vocabulary in one line** (predicates, scopes, bang-setters; see `02-models.md`):

```ruby
enum :involvement, %w[ invisible nothing mentions everything ].index_by(&:itself), default: :mentions   # (Campfire)
```

**Direct routes — a URL helper that carries behavior:**

```ruby
# config/routes.rb — a cache-busting avatar URL as a first-class route helper   (Campfire)
direct :fresh_user_avatar do |user, options|
  route_for :user_avatar, user, v: user.updated_at.to_fs(:number), **options
end
# Views call fresh_user_avatar_path(user); the version param busts CDN/browser caches
# automatically because updated_at changes when the avatar does.
```

**ActiveStorage variants — the image pipeline you don't build:**

```ruby
has_one_attached :avatar do |attachable|
  attachable.variant :thumb, resize_to_limit: [ 128, 128 ]
end
# <%= image_tag user.avatar.variant(:thumb) %> — no resize lambda, no imgproxy service
```

Also in the framework, waiting: `ActiveSupport::CurrentAttributes` (section 7), `Rails.cache` + `touch:` chains, `has_secure_password`, `generates_token_for`, rate limiting in controllers, `params.expect`/strong params, ActionMailer previews, fixtures as the seed system.

**Not:** you will be tempted to reach for Devise, JWT gems, paperclip-descendants, friendly_id, or a pagination gem on day one — don't. Each wraps something Rails does in fewer lines than the gem's configuration. Campfire hand-rolls sessions in one concern; both products paginate with plain scopes.

**Why:** a gem is a moving part — a version to track, a CVE feed to watch, a DSL to learn, an upgrade to sequence with Rails upgrades. The framework's built-in is maintained by the same team on the same release train. Use the framework's full surface before reaching for a gem, and the Gemfile stays short enough to read aloud.

---

## 4. When a gem IS justified

**When:** the dependency decision, stated as a rule instead of vibes.

**Do:** add a gem only when it sits in one of these categories — which is, not coincidentally, what Campfire's and Fizzy's Gemfiles actually contain:

| Category | Examples | Why it clears the bar |
|---|---|---|
| Crypto you must not hand-roll | `bcrypt` | Getting it wrong is a security incident, not a refactor |
| Protocol / format codecs | `web-push`, `rqrcode`, `image_processing` | A binary wire format or spec with hostile inputs |
| Infrastructure adapters | `kamal`, `thruster`, DB drivers, `redis` (when actually needed) | Talks to systems outside your process |
| The Hotwire/Rails family itself | `turbo-rails`, `stimulus-rails`, `importmap-rails`, `propshaft`, `solid_queue` | First-party; it IS the framework |

**Not:** never add a gem that *organizes your code* — interactors, decorators, authorization DSLs, soft-delete frameworks, admin panels, view-component systems, pagination DSLs. Those compete with Rails' conventions instead of extending its reach, and every one of them is a fork of the framework you now teach to every future contributor.

**Why:** the test is one question — *does this gem do something outside Ruby's reach (crypto, codecs, other processes), or does it tell me how to arrange Ruby I could arrange myself?* The first kind removes risk. The second kind removes Rails.

---

## 5. The one-person-framework stack

**When:** `rails new` time — picking database, queue, asset pipeline, CSS approach for a new product.

**Do:** pick the stack where every choice *deletes a moving part*. This is the stack Campfire ships to paying customers with:

| Agent default | 37signals choice | The moving part deleted |
|---|---|---|
| Postgres on a managed service | **SQLite in production** | The database *server*: no second host, no connection pool tuning, no network hop, no ops. Backups are file copies (or Litestream). |
| Elasticsearch for search | **SQLite FTS5 virtual table** (Campfire) / sharded MySQL full-text (Fizzy at SaaS scale) | The search cluster. FTS5 lives in the same file as the data and syncs via model callbacks. |
| Redis + Sidekiq | **Solid Queue** — database-backed jobs (Fizzy) | Redis. The queue is rows in the DB you already have, inspectable with SQL, transactional with your writes. Campfire predates Solid Queue and used Resque; starting today, Solid Queue is the doctrine. |
| Redis cache | **Solid Cache** — database-backed cache | Redis, again. |
| webpack / esbuild / Vite + node | **Import maps + Propshaft** | Node, `node_modules`, the build step, the transpiler, the watcher. JS ships as the ES modules you wrote; Propshaft just digests and serves. |
| Sass / Tailwind | **Plain CSS with modern features** — nesting, custom properties, `:has()`, container queries | The preprocessor and its config. The platform caught up; the browser runs what you wrote. |
| Auth gem (Devise) | **A hand-rolled sessions concern** (~one screen of code) | A DSL larger than the problem. Sessions are a `Session` model, a signed cookie, and one concern (section 7). |

**Not:** you will be tempted to call SQLite-in-production a toy and "upgrade" to Postgres-plus-Redis-plus-a-worker-fleet for an app with thousands of users — don't. Campfire is a real-time chat product handling websockets, push notifications, attachments, and full-text search on this exact stack. SQLite's single-writer model is a real constraint only at write volumes most products never see; modern SQLite with WAL mode handles enormous read concurrency. Choose the bigger stack when you have the bigger numbers, not before.

**Why:** every moving part is something a one-person team (or one agent) must provision, monitor, secure, upgrade, and debug at 3am. The deleted parts don't have outages. The whole point of the one-person framework is that `git clone` + `bin/setup` + `bin/dev` is the entire onboarding, and one `kamal deploy` to one box is the entire production architecture.

---

## 6. The directory shape: three trees that are one tree

**When:** deciding where any new file goes.

**Do:** make the directory listing restate the include lines, and the controller folders restate the routes. The shape, drawn from Campfire:

```
app/
  models/
    message.rb                  # include Attachment, Broadcasts, Mentionee, Pagination, Searchable
    message/
      attachment.rb             # module Message::Attachment   ← one file per word
      broadcasts.rb             # module Message::Broadcasts      in the include line
      mentionee.rb
      pagination.rb
      searchable.rb
    user.rb                     # include Avatar, Bannable, Bot, Mentionable, Role, Transferable
    user/
      avatar.rb
      bannable.rb
      bot.rb
      ...
    rooms/                      # STI subclasses: Rooms::Open, Rooms::Closed, Rooms::Direct
      open.rb
      closed.rb
      direct.rb
    concerns/                   # ONLY cross-model traits (a Searchable shared by several nouns)
    current.rb                  # ActiveSupport::CurrentAttributes (section 7)
  controllers/
    rooms_controller.rb
    messages_controller.rb
    users/
      bans_controller.rb        # Users::BansController ← created by scope module: "users"
    messages/
      boosts_controller.rb
    concerns/
      authentication.rb
  jobs/
    room/
      push_message_job.rb       # a two-line thunk delegating to a model verb (08)
  helpers/
  views/
lib/                            # work that escapes the Rails executor — see 08-jobs-background-work.md
```

The rules that produce this shape:

- **`app/models/<noun>/<trait>.rb` mirrors the include line.** `include Attachment` inside `Message` resolves to `Message::Attachment` in `message/attachment.rb`. Reading the include line and running `ls app/models/message/` give you the same list. A trait goes in `app/models/concerns/` *only* when several nouns share it; default to the namespaced folder.
- **Controller folders mirror the route tree via `scope module:`.** The route `resources :users { scope module: "users" { resource :ban } }` makes the URL `/users/:user_id/ban`, the class `Users::BansController`, and the file `app/controllers/users/bans_controller.rb` — three trees, same tree. You never wonder where the code for a URL lives: the URL is the path.
- **Jobs are thunks, named for the model verb they trigger** — `Room::PushMessageJob` performs `room.push_message_now(...)`. The job class is two lines; the logic is in the model (see `08-jobs-background-work.md`).
- **`lib/` is for code that must run outside the Rails executor** — long-lived processes, web-push connection pools, anything that would deadlock holding an executor permit. If it's domain logic, it's in `app/models`; `lib/` is the escape hatch, not the junk drawer (see `08-jobs-background-work.md`).

**Not:** you will be tempted to create `app/models/concerns/` entries for single-model traits, or to leave all controllers flat at the top level with names like `user_bans_controller.rb` — don't. Both break the mirror: the reader can no longer navigate from an include line or a URL straight to a file path.

**Why:** the shape is free documentation. When the directory tree, the include lines, and `routes.rb` are projections of the same structure, learning any one of them teaches all three — and drift between them is impossible because Rails' constant resolution *enforces* the model mirror and `scope module:` *enforces* the controller mirror. Convention at the boundary, again.

---

## 7. Current attributes: ambient request state, set once

**When:** many layers need to know *who is acting* (and in multi-tenant apps, *which account*) — model defaults, broadcast targets, authorization scopes, audit trails.

**Do:** define a `Current` singleton and set it in exactly one place — a controller concern's `before_action`:

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

Once set, the whole request breathes it. The payoff shows up as deleted parameters everywhere:

```ruby
class Message < ApplicationRecord
  belongs_to :creator, class_name: "User", default: -> { Current.user }   # (Campfire)
end

# Controller create actions never mention the user:
@message = @room.messages.create!(message_params)   # creator filled in by the default
```

Fizzy runs its entire multi-tenancy on the same pattern: middleware extracts the account slug from the URL prefix and sets `Current.account`, every model carries `account_id`, and background jobs serialize and restore `Current.account` across the queue boundary so a job runs in the tenant that enqueued it (see `08-jobs-background-work.md` for the job half).

**Not:** you will be tempted to treat `Current` as a grab-bag of globals — request flags, feature toggles, the shopping cart — don't. It holds identity and request facts only (`user`, `account`, `request_id`, `user_agent`, `ip_address`), it is written in exactly one concern, and models *read* it (in defaults and scopes) but never *write* it. `CurrentAttributes` is reset by the Rails executor between requests and jobs, so it cannot leak — but only if you keep it small enough to reason about.

**Why:** the alternative is threading `user:` through every method signature in the app — every model verb, every helper, every job — which bloats every seam to carry a fact that is constant for the whole request. One ambient attribute, set at the boundary where it becomes known, deletes a parameter from a hundred signatures. Count the edge cases: forgotten parameters, mismatched users mid-request, and the entire "which user do I pass here?" question class.

---

## 8. STYLE.md — 37signals' written law, distilled

37signals ships a STYLE.md *inside* their repos (Fizzy's is the canonical text). It opens with the standard: "We aim to write code that is a pleasure to read… We care about how code reads, how code looks, and how code makes you feel when you read it." And one instruction that is pure doctrine for an agent: **when writing new code, find similar code elsewhere in the app and imitate it** — prior art over invention. Every law below is theirs; follow them exactly.

**Law 1 — Expanded conditionals over guard clauses.** Default to a visible `if/else`, not a `return-unless` scattering:

```ruby
# Bad (their label, not ours)
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

Two sanctioned exceptions: a guard *right at the top* of a method, or when the main body is non-trivial:

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

**Law 2 — Method ordering:** `class` methods first, then `public` methods with `initialize` at the top, then `private`.

**Law 3 — Invocation order:** order methods vertically by *when they're called*, so reading top-to-bottom replays the execution. `some_method` calls `method_1` then `method_2`; below `private`, `method_1` and its helpers appear in full before `method_2` and its helpers begin.

**Law 4 — Bang discipline:** use `!` *only* when a non-bang counterpart exists (`save`/`save!`). Never use `!` to flag "destructive" — Ruby and Rails are full of destructive methods without it.

**Law 5 — Visibility-modifier layout:** no blank line under `private`, and indent the methods beneath it:

```ruby
class SomeClass
  def some_method
    # ...
  end

  private
    def some_private_method
      # ...
    end
end
```

Exception: a module that is *entirely* private marks `private` at the top, adds a blank line, and does not indent.

**Law 6 — CRUD controllers.** When an action doesn't map to a CRUD verb, introduce a new resource — never a custom action:

```ruby
# Bad
resources :cards do
  post :close
  post :reopen
end

# Good                                              (Fizzy)
resources :cards do
  resource :closure
end
```

This is the find-the-noun rule, in their own words; full mechanics in `03-controllers-routing.md`.

**Law 7 — Thin controllers, rich models, no connecting artifacts.** Controllers directly invoke the domain model — plain Active Record is fine, and complex behavior gets an intention-revealing model API:

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

`@card.gild` — the controller speaks the domain's language and owns none of its logic.

**Law 8 — Shallow jobs, `_later`/`_now` suffixes.** Jobs delegate to domain models. A method that enqueues ends in `_later`; its synchronous twin ends in `_now`:

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
    # ...
  end
end

class Event::RelayJob < ApplicationJob
  def perform(event)
    event.relay_now
  end
end
```

Note everything composing in eleven lines: a concern as the trait's home, `after_create_commit` (never plain `after_create` — `_commit` means after-durable, or you relay the ghost row), the thunk job, the suffix pair. The full job doctrine is `08-jobs-background-work.md`.

---

## 9. Underdo: what to refuse to build

**When:** scoping a product or a milestone — deciding what exists at all.

**Do:** build five features that work perfectly instead of twenty that mostly work. Underdoing the competition is the strategy, not a budget constraint: the smaller surface is *the product advantage*, because every feature you don't build is support you don't answer, bugs you don't fix, and UI the user doesn't wade through. Campfire ships a chat product a company pays Slack per-seat for, and its entire Ruby domain is roughly a dozen models.

What to refuse, by name:

| The thing you're about to build | Why to refuse | What to do instead |
|---|---|---|
| An admin framework / admin panel gem | A second app to secure and maintain | `rails console` is the admin. If operators need UI, add one or two owner-scoped resourceful controllers for the actual operations needed. |
| A settings page | Every setting is a fork of your test matrix | Pick the good default and hardcode it. Add the setting when real users actually diverge — Campfire's rooms get *one* involvement enum, not a notification-preferences matrix. |
| A premature API (`/api/v1`, serializers, API tokens) | A second contract to version and document, with zero clients | The HTML controllers ARE the API. Campfire's bots POST to the same message endpoints humans use — a bot is just a User with a bot role, capability by subtraction, not a parallel surface. |
| A roles-and-permissions matrix | An authorization product inside your product | One `role` enum on User (`member / administrator / bot`) and data-access shape (P3). Add granularity when a customer's real workflow demands it. |
| Soft delete / paranoia framework | A second truth on every query forever (`flags lie`) | `destroy` means destroy; `dependent: :destroy` cascades it; backups handle regret. If "archived" is a real domain state, it's a noun — an `Archival` row — not a flag on everything. |
| A feature-flag system | Configuration as a shadow codebase | Deploy small changes often; branch in git, not in production state. |

**Not:** you will be tempted to build these *up front* because "we'll need it eventually" — don't. Each is a second product hiding inside your product, and each can be added later in the rare case "eventually" arrives. Nothing on this list is hard to add when a real user makes it real.

**Why:** the asymmetry of maintenance. A feature costs its build time once and its existence forever. A small app stays holdable in one head — which is the precondition for everything else in this skill: you can only let the model own the consequence if you can find the model, and you can only trust conventions at the boundary if the boundary count stays small.

---

## 10. The feature build order

**When:** building any feature in an existing 37signals-shaped app.

**Do:** build in this order, asking one question at each step. The order matters because each step's output is the next step's input — and because it front-loads the decisions that are expensive to reverse (schema, nouns) and back-loads the ones that are cheap (polish).

**1. Model + migration.** *Question: what is the noun, and whose fact is this?* Find the smallest honest schema: derive, don't store (no counter you can `count`, no flag you can infer — see `02-models.md`); and before adding a table, ask whether an existing join row can carry the fact — Campfire rides presence (`connected_at` timestamp), read-state (one nullable `unread_at`), and notification involvement (one enum) all on the `Membership` join row. The most important model in a chat app is a join row.

**2. Routes.** *Question: did I find the noun?* If you're typing `post :something`, you didn't — go back. Nest under the parent that owns it, use `scope module:` so the controller file lands where the URL says (`03-controllers-routing.md`).

**3. Controller.** *Question: am I about to write an `if`?* The action should be roughly two lines: load through `Current.user` (or the parent loaded through it), call one model verb or one Active Record operation. Logic appearing here is logic that belongs one level down.

**4. View.** *Question: will every path render this exact partial?* One partial per noun, root element addressed by `dom_id` — first load, edit response, broadcast, and search result must all paint with the same renderer or they will drift (`04-views-helpers.md`).

**5. Turbo.** *Question: replace or refresh?* For multiplayer pages, the default is the morphing pair — `turbo_stream_from` on the page + `broadcasts_refreshes` (riding the `touch:` chain) on the model — and the live update is done in two declarations (`06-morphing-live-updates.md`). For append-shaped feeds (chat, notifications), targeted streams: subscribe, then broadcast the same partial to the `dom_id` address (`05-turbo-frames-streams.md`).

**6. Polish.** *Question: what's still manual?* Stimulus only now, and only as generic controllers configured by `data-*` attributes — config over forks (`07-stimulus-widgets.md`). Fragment caching keyed on the record, freshness via the `touch:` chain you already declared. Preload scopes for the N+1s the feature introduced.

A feature that follows this order is typically six small files — and steps 5–6 are often *zero* new files, because the declarations from steps 1–4 (the `touch:`, the `dom_id`, the one partial) are exactly what Turbo composes into the live experience. The composition is the lesson: each step trusts the conventions laid down by the previous one.

**Not:** you will be tempted to start at step 6 — scaffolding the interactive UI first and backfilling the model — don't. UI-first inverts the dependency graph: you end up inventing client state (which the DOM attribute should have been), wire formats (which should have been HTML), and endpoints (which should have been the noun's CRUD) to serve a frontend that didn't know what the truth was yet.

**Why:** the order is the dependency graph of the doctrine itself — the model owning truth is what makes one-renderer possible, which is what makes broadcast-the-same-partial possible, which is what makes the live page two declarations instead of a synchronization engine.

---

## 11. The ten-minute orientation: an unfamiliar codebase

**When:** you've just been dropped into a Rails codebase you've never seen.

**Do:** resist the instinct to find the biggest file and scroll. Rails apps are laid out by convention, so three moves orient you:

```
THE TEN-MINUTE ORIENTATION

  1. ls app/models          →  the NOUNS    (what the domain is)
        message.rb, room.rb, user.rb, membership.rb, ban.rb ...

  2. read the include lines →  the SPEC     (what each noun can do)
        include Attachment, Broadcasts, Mentionee, Pagination, Searchable
        └────────── each is a file in app/models/<noun>/ ──────────┘

  3. read routes.rb         →  the VERBS    (every state change, as CRUD)
        resources :rooms do resources :messages end
        resource  :ban, only: %i[ create destroy ]
```

**Move 1 — the domain lives in `app/models`; start there, not in controllers.** Controllers are plumbing that translates HTTP into method calls. The nouns of the business live in the model filenames; read the nouns first and the verbs make sense.

**Move 2 — the include line is the table of contents.** Open a model and read exactly one line. `include Avatar, Bannable, Bot, Mentionable, Role, Transferable` (Campfire's User) tells you the shape of the thing in two seconds, and each word is a file you can open. Want to know how search works? Open `message/searchable.rb` — twenty-odd self-contained lines — not a 300-line scroll.

**Move 3 — `routes.rb` is the sitemap of every state change.** Every URL, every verb the app exposes, in one forced-readable file. Read it top to bottom once and notice the verbs that are nouns (`resource :ban`, `resource :closure`) — each is a tiny controller and usually a tiny model, exactly where you'd expect them on disk.

Two reading habits to carry along:

- **The missing subsystem is the lesson.** When the machinery you expect isn't there — no presence sweeper, no read-receipts table, no dedup service, no "live update pipeline" — don't hunt for where it's hidden. Presence is a timestamp compared against a 60-second window; read-state is one nullable column; the live update and the HTTP response are the same partial over two transports. Each absent subsystem is a convention absorbing it.
- **When a line looks suspiciously short, count the edge cases it absorbs for free.** `belongs_to :room, touch: true` is one token absorbing an entire stale-cache bug class. The short line is never doing less; a convention at the boundary is doing the other nine-tenths.

**Why:** ten minutes of nouns → spec → verbs beats an afternoon of reverse-engineering models from how controllers poke them — and in a 37signals-shaped app the three views are guaranteed consistent, because the directory mirrors the includes and the controller tree mirrors the routes (section 6).

---

## 12. Red flags → fixes

| Red flag | The fix |
|---|---|
| `app/services/`, `app/forms/`, `app/queries/`, `app/presenters/` exists or is about to | Refuse the layer; find the noun or the trait (sections 1–2) |
| A class named `SomethingService`, `SomethingManager`, or with a `.call` method | It's a verb pretending to be a thing — the noun gets a model, the model gets a verb |
| A PORO workflow object treated as a "special artifact" with its own base class | Fine as a plain domain noun in `app/models` (the `Signup` exception); kill the layer ceremony |
| Reaching for a tokens table + expiry sweeper | `signed_id(purpose:, expires_in:)` / `find_signed!` |
| Adding Devise / a soft-delete gem / a pagination gem / an admin gem | Hand-roll the concern, destroy means destroy, write the scope, use the console (sections 3–4, 9) |
| `package.json` appearing in a Rails app | Import maps + Propshaft; no node, no build step (section 5) |
| Postgres + Redis + Sidekiq provisioned for a small product "to be safe" | SQLite + Solid Queue + Solid Cache until real numbers demand otherwise (section 5) |
| A trait file in `app/models/concerns/` used by exactly one model | Move it to `app/models/<noun>/<trait>.rb` so the include line and the directory agree (section 6) |
| Flat controller named `user_bans_controller.rb` | `scope module: "users"` → `app/controllers/users/bans_controller.rb`; URL, route, and path are one tree (section 6) |
| `current_user` threaded as a parameter through model methods | `Current.user` set once in the authentication concern; model defaults read it (section 7) |
| `Current` accumulating non-identity state (carts, flags, toggles) | `Current` holds identity + request facts only, written in one place |
| A `post :close` / `post :archive` custom action | `resource :closure` / `resource :archival` — STYLE.md Law 6 (section 8, `03-controllers-routing.md`) |
| A job class with real logic in `perform` | Two-line thunk delegating to a model `_now` method; enqueue via `_later` (section 8, `08-jobs-background-work.md`) |
| A settings page, admin framework, or `/api/v1` in the first milestone | Refuse; hardcode the default, console is the admin, the HTML controllers are the API (section 9) |
| Building the interactive UI before the model exists | Run the build order forward: model → routes → controller → view → Turbo → polish (section 10) |
| Orienting in a new codebase by scrolling the biggest file | `ls app/models` → include lines → `routes.rb` (section 11) |
