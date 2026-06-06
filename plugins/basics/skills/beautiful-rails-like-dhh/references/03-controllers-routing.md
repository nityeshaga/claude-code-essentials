# Controllers & Routing — The Layer That Almost Disappears

Read this when you are about to write or review a controller action, add a route, or feel the pull to add a custom verb (`post :ban`, `post :archive`, `member do … end`) to an existing controller.

**Contents**
1. [The controller's only job](#1-the-controllers-only-job)
2. [Verb-as-noun: every state change is CRUD on a hidden noun](#2-verb-as-noun-every-state-change-is-crud-on-a-hidden-noun)
3. [Cardinality: singular `resource` vs plural `resources`](#3-cardinality-singular-resource-vs-plural-resources)
4. [The verb that was a read](#4-the-verb-that-was-a-read)
5. [Routing moves that keep `routes.rb` flat](#5-routing-moves-that-keep-routesrb-flat)
6. [The URL's query state is a noun too](#6-the-urls-query-state-is-a-noun-too)
7. [Strong params: the allow-list](#7-strong-params-the-allow-list)
8. [`before_action`: declaration order is the guard sequence](#8-before_action-declaration-order-is-the-guard-sequence)
9. [Controller inheritance + `super`: the second path IS the first path](#9-controller-inheritance--super-the-second-path-is-the-first-path)
10. [`partition`: one query, two lists](#10-partition-one-query-two-lists)
11. [The stored-position exception: intent is still CRUD](#11-the-stored-position-exception-intent-is-still-crud)
12. [Worked example: the ban arc](#12-worked-example-the-ban-arc)
13. [Red flags → fixes](#13-red-flags--fixes)

---

## 1. The controller's only job

A controller is a translator between two worlds: HTTP (verbs, paths, params, status codes) and Ruby (objects and method calls). Its complete job description: receive the request, call **one** method on a noun, respond. Authorization rides along as `before_action`s; everything else belongs elsewhere.

**Do** judge every controller you write by this shape — one load, one method call, one response:

```ruby
def create
  @user.ban
  redirect_to @user
end
```

**Not** — you will be tempted to treat the controller as the place where the feature lives, because that's where the request lands: open a transaction there, loop over records there, branch on record types there. Don't. Every line of business logic in an action is a line that can't be reached except through an HTTP request, can't be reused by a console session or a job, and will be duplicated the day a second entry point appears.

**Why** — thinness is not a discipline you impose; it's what's left over when the model took the weight. **The model owns the consequence** (see `02-models.md` for where that weight goes); the thinness of the controller is the *receipt* that the model took it. If your action is more than ~3 lines, the receipt says the model didn't — go find the missing model method before you write another controller line.

Two mechanics you get for free and must not fight:

- **An action is just a method, and rendering is implicit.** A `show` that ends without `render` renders `show.html.erb`. Campfire ships actions that are *literally empty* (`def show; end`) — the convention picks the template by the action's name. Never write `render :show` at the end of `show`.
- **Rails stays small because each layer trusts a convention at its boundary.** The router trusts that `rooms#show` means `RoomsController#show` renders `rooms/show`. Every time you break that chain (custom action names, explicit renders, hand-built URLs) you start paying for what was free.

---

## 2. Verb-as-noun: every state change is CRUD on a hidden noun

This is the load-bearing pattern of the whole layer. 37signals state it as law in Fizzy's `STYLE.md`:

> We model web endpoints as CRUD operations on resources (REST). When an action doesn't map cleanly to a standard CRUD verb, we introduce a new resource rather than adding custom actions.
>
> ```ruby
> # Bad
> resources :cards do
>   post :close
>   post :reopen
> end
>
> # Good
> resources :cards do
>   resource :closure
> end
> ```

**When** — any feature request that arrives as a verb: ban, unban, reset, regenerate, close, reopen, mute, pin, publish, triage, archive, approve.

**Do** — **find the noun.** Stop asking "what action is this?" and ask **"what is the thing whose lifecycle is changing?"** Then route it as the create/update/destroy of that noun:

| The verb you were asked for | The hidden noun | The CRUD action | Source |
|---|---|---|---|
| ban / unban a user | `Ban` | `create` / `destroy` | Campfire |
| regenerate the join code | `JoinCode` | `create` (you're minting a new one) | Campfire |
| reset a bot's API key | `Key` | `update` | Campfire |
| close / reopen a card | `Closure` | `create` / `destroy` | Fizzy |
| mark a card golden / ungild | `Goldness` | `create` / `destroy` | Fizzy |
| triage a card | `Triage` | `create` | Fizzy |
| watch, pin, publish a card | `Watch`, `Pin`, `Publish` | `create` / `destroy` | Fizzy |

The route is one flat line, not a `member do` block:

```ruby
resource :ban, only: %i[ create destroy ]
```

And the controller collapses to the two-line CRUD shape (Campfire — this is the complete file):

```ruby
class Users::BansController < ApplicationController
  before_action :ensure_can_administer
  before_action :set_user

  def create
    @user.ban
    redirect_to @user
  end

  def destroy
    @user.unban
    redirect_to @user
  end

  private
    def set_user
      @user = User.find(params[:user_id])
    end
end
```

There is no `ban` action anywhere. Banning a user is the *creation* of a `Ban`; unbanning is its *destruction*. The transaction, the IP harvesting, the content removal all live on `@user.ban` — a model method (internals in `02-models.md`).

The same two-line shape repeats wherever a verb shows up. Regenerating a join code (Campfire — complete file):

```ruby
class Accounts::JoinCodesController < ApplicationController
  before_action :ensure_can_administer

  def create
    Current.account.reset_join_code
    redirect_to edit_account_url
  end
end
```

Resetting a bot key (Campfire — complete file):

```ruby
class Accounts::Bots::KeysController < ApplicationController
  before_action :ensure_can_administer

  def update
    User.active_bots.find(params[:bot_id]).reset_bot_key
    redirect_to account_bots_url
  end
end
```

Closing a card (Fizzy): `Cards::ClosuresController#create` is `@card.close`, `#destroy` is `@card.reopen`. Gilding (Fizzy): `Cards::GoldnessesController#create` is `@card.gild`, `#destroy` is `@card.ungild`. A chat app and a Kanban board, built years apart, reach for the identical move every time a verb appears — that's what makes this doctrine, not a habit.

**Not** — you will be tempted to write `member do post :ban end` because Rails offers it and it feels simpler for exactly one action. Don't. A custom verb needs a custom route, a custom path helper, and its own guard — and the next verb needs three more. Six months later the controller is a junk drawer of fifteen actions, the guard's `only:` array has drifted, and the day someone adds an action without extending the guard you've shipped an open admin endpoint that never errors.

You will also be tempted to object: *"isn't `reset_join_code` still a custom verb — just moved to the model?"* The distinction is the point. On the controller, a custom verb is public HTTP surface area: a route, a helper, a guard entry, all of which drift. On the model, `reset_join_code` is a domain method hiding behind a standard `create` route — an implementation detail of the noun's lifecycle. **A model is allowed to have verbs; a controller is not.**

**Why** — count the edge cases this line absorbs for free: `resource :ban, only: %i[ create destroy ]` absorbs the custom route, the custom helper, the forgotten-guard drift, and the question of where the controller file lives. Naming the noun also forces the question "what record am I actually creating?" — which is usually a row you wanted anyway (a `Ban` you can look up by IP later). Skinny controllers aren't willpower; they're the leftover after every action becomes genuine CRUD.

---

## 3. Cardinality: singular `resource` vs plural `resources`

**When** — every time you add a route.

**Do** — let the router encode cardinality. `resources :rooms` generates the seven CRUD routes for a collection. Singular `resource :ban` generates six — no `index` — because the noun is one-per-context: a user has exactly one ban relationship, a user has one profile, a card has one closure. There is no list to index.

**Not** — don't force a plural `resources` with an `:id` you'll never use just because plural is the shape you type by reflex, and don't hand-write routes the macro already generates.

**Why** — the router has a word for "one-per-context"; hand-encoding it means a meaningless `index` route, a path helper demanding an id that's always implied, and a reader who can't tell from `routes.rb` whether the noun is a collection.

---

## 4. The verb that was a read

The deepest version of find-the-noun is catching the verb that's secretly a **read**.

**When** — the product spec says "open a room," "switch rooms," "jump to a message," "view as X" — verbs that change what's on screen but create nothing.

**Do** — recognize them as `GET` on an existing `#show`. Campfire's room opening, room switching, and message deep-links are all the *same* action:

```ruby
def show
  @messages = find_messages
end
```

There is no switching code anywhere, because switching rooms is just reading a different room. The deep link is merely **another route into the same action** — a second path in `routes.rb` that lands on `rooms#show` with a `message_id` param, not a separate `jump_to_message` endpoint.

The one real decision `#show` carries is *where in the conversation to open* — and that's two scopes on **one render path** (Campfire):

```ruby
def find_messages
  messages = @room.messages.with_creator.with_attachment_details.with_boosts

  if show_first_message = messages.find_by(id: params[:message_id])
    @messages = messages.page_around(show_first_message)  # deep link: a page before + it + a page after
  else
    @messages = messages.last_page                        # plain open: the newest page
  end
end
```

Both branches hand the same view the same `@messages`; only the slice differs. `page_around` and `last_page` are named pagination scopes on the model (`02-models.md`), so the controller reads like the sentence you'd say out loud.

**Not** — you will be tempted to write `open_room`, `switch_room`, and `jump_to_message` as three endpoints, each with its own `find`, each re-deriving "where do I scroll to," each needing its own view. Don't. The verbs you're about to route are a read you already have.

**Why** — one render path means one place where pagination, eager-loading, and authorization are decided; three endpoints means three copies that drift. Count the edge cases the single `#show` absorbs: the stale deep link, the duplicated eager-load list, the endpoint that forgot its guard.

---

## 5. Routing moves that keep `routes.rb` flat

Four small route-level tools carry the organization so neither the URL nor the controller pays for it.

### `scope module:` — folder mirrors routes, URL doesn't pay

**When** — you nest nouns under a parent (`/users/:user_id/ban`) and want the controller filed under a matching folder without the URL inheriting `/users/users/...`.

**Do** (Campfire):

```ruby
resources :users, only: :show do
  scope module: "users" do
    resource :avatar, only: %i[ show destroy ]
    resource :ban,    only: %i[ create destroy ]
  end
end
```

The controller for `/users/8/ban` is `Users::BansController` at `app/controllers/users/bans_controller.rb` — **the controller folder tree mirrors the route tree one-to-one** — while the URL stays the flat `/users/8/ban`.

**Not** — don't reach for `namespace :users` here (that would prefix the URL too), and don't flatten the controllers into one directory of `UserBansController`-style names to avoid nesting.

**Why** — the folder structure and the route structure are the same shape, so a reader navigates the codebase by reading `routes.rb`; the URL pays nothing for the organization.

### `scope defaults:` — the argument-free path helper

**When** — a route always refers to "the current user's X."

**Do** (Campfire):

```ruby
scope defaults: { user_id: "me" } do
  resource :sidebar, only: :show
  resource :profile
end
```

`user_profile_path` now generates `/users/me/profile` with **no argument** — `"me"` is baked into the route, and the controller reads the param through the current user anyway.

**Why** — every call site stops passing an id that was always implied; the resourceful shape survives intact instead of degrading into a bespoke `/my_profile` route.

### `direct` — a named helper for a derived URL

**When** — you need a URL the resourceful routes don't generate, typically one that derives from record state (cache-busting versions, sized variants).

**Do** (Campfire):

```ruby
direct :fresh_user_avatar do |user, options|
  route_for :user_avatar, user.avatar_token, v: user.updated_at.to_fs(:number)
end
```

`fresh_user_avatar_url(user)` now exists app-wide, and the `v=` param changes whenever the user changes — change the content, change the URL.

**Not** — don't hand-concatenate the URL in a helper or, worse, in views; don't store a computed URL on the record (**a stored copy is a second source of truth**).

**Why** — the derivation lives in one place, in the router, where URL knowledge belongs.

### `resolve` — the record knows its own URL

**When** — views, mailers, or jobs need to link to a record whose "page" is really somewhere else (a comment lives on its card's page; a notification points at its target).

**Do** (Fizzy):

```ruby
resolve "Comment" do |comment, options|
  options[:anchor] = ActionView::RecordIdentifier.dom_id(comment)
  route_for :card, comment.card, options
end

resolve "Notification" do |notification, options|
  polymorphic_url(notification.notifiable_target, options)
end

resolve "Event" do |event, options|
  polymorphic_url(event.eventable, options)
end
```

Now `link_to comment` and `url_for notification` Just Work everywhere — the comment resolves to its card's path plus a `dom_id` anchor; notifications and events fall through to their targets.

**Not** — don't write a `case record when Comment … when Notification …` URL-builder helper. That's a missing `resolve` block.

**Why** — `direct` and `resolve` are the two halves of one move: teach the *router* how a thing becomes a URL, once, instead of teaching every call site. Per-type `case` statements in views are the drift you're deleting.

---

## 6. The URL's query state is a noun too

**When** — an index has filters: `?board_ids[]=2&assignee_ids[]=7&tag_ids[]=4`, sort orders, search terms. The query-building logic is starting to appear in `index`, the sidebar, the export, the count badge.

**Do** — name the query itself as a record. Fizzy's `Filter` is a real table (with `creator_id` and `account_id` like any noun), found-or-built from the URL's params:

```ruby
class Filter < ApplicationRecord
  include Fields, Params, Resources, Summarized

  belongs_to :creator, class_name: "User", default: -> { Current.user }
  belongs_to :account, default: -> { creator.account }

  class << self
    def from_params(params)
      find_by_params(params) || build(params)
    end
  end
end
```

`from_params` is the whole move: if a `Filter` matching these params was saved before, you get the persisted row; otherwise a fresh unsaved one. Either way the app holds a domain object, not a bag of `params`.

"Matching these params" becomes a database lookup by reducing the params to one indexed fingerprint (Fizzy):

```ruby
module Filter::Params
  extend ActiveSupport::Concern

  class_methods do
    def find_by_params(params)
      find_by params_digest: digest_params(params)
    end

    def digest_params(params)
      Digest::MD5.hexdigest normalize_params(params).to_json
    end

    def normalize_params(params)
      params
        .to_h
        .compact_blank
        .reject(&method(:default_value?))
        .collect { |name, value| [ name, value.is_a?(Array) ? value.collect(&:to_s) : value.to_s ] }
        .sort_by { |name, _| name.to_s }
        .to_h
    end
  end

  included do
    before_save { self.params_digest = self.class.digest_params(as_params) }
  end
end
```

`normalize_params` drops blanks and defaults, stringifies, and **sorts by key**, so `?board_ids[]=1&tag_ids[]=2` and `?tag_ids[]=2&board_ids[]=1` collapse to the same canonical hash and one digest. A unique index on `[creator_id, params_digest]` makes each distinct filter exactly one row; the `before_save` recomputes the digest so the stored key never drifts from the contents.

The controller payoff — the entire index action (Fizzy):

```ruby
def index
  set_page_and_extract_portion_from @filter.cards
end
```

No query building, no reading fifteen params keys, no branching on which filters are present. `Filter#cards` owns the long chain of conditional scopes; the controller asks the noun for its cards and paginates.

**Not** — you will be tempted to build `Card.where(...)` inline in the controller, straight from `params`, because a filter feels like request ephemera rather than data. Don't. That query-builder gets copy-pasted into every surface that needs the same filtered set, and none of the copies can be saved, named, or linked to.

**Why** — **the URL carries the contract**: the same params always mean the same query, and because the query is a row, users get saveable/shareable/recently-used filters for free. Banning was a verb that was a `create`; opening a room was a verb that was a read; a query — the most throwaway thing in a web app — is a noun you can find, build, save, and re-find by fingerprint. Once you see that, almost nothing in a web app *isn't* CRUD on some noun.

---

## 7. Strong params: the allow-list

**When** — every action that writes client params to a record.

**Do** — name exactly the fields you accept:

```ruby
def message_params
  params.require(:message).permit(:body, :attachment, :client_message_id)
end
```

**Not** — never `params.permit!`, never pass `params` (or `params[:message]`) straight into `update!`/`create!`. You will be tempted when the form has many fields and the permit list feels like ceremony — that ceremony is the entire defense.

**Why** — `params` is untrusted input; anything the client sends is in there, including fields you never rendered a form input for. Permit-everything is how a client sets `admin: true` on a row you never meant to expose. The allow-list makes the unsafe write unexpressible.

---

## 8. `before_action`: declaration order is the guard sequence

**When** — composing a controller's setup and guards.

**Do** — treat the `before_action` stack as a deliberate, ordered sequence — they run in declaration order, and the order is part of the design:

```ruby
class Users::BansController < ApplicationController
  before_action :ensure_can_administer   # 1. are you allowed in this room at all?
  before_action :set_user                # 2. only then load the target
  ...
end
```

Authorization runs *before* the load when the permission doesn't depend on the record. Conversely, when the guard needs the record (`can_administer?(@message)`), the load comes first:

```ruby
before_action :set_message
before_action :ensure_can_administer, only: %i[ edit update destroy ]

private
  def ensure_can_administer
    head :forbidden unless Current.user.can_administer?(@message)
  end
```

One predicate, declared once, guarding every write through a single `before_action` with an `only:` list.

**Not** — don't re-type the permission check inside each action body (the copies drift, and the new action is the one that forgets it), and don't add `before_action`s in arbitrary order assuming they're independent — a guard that reads `@user` before `set_user` ran is a nil-check bug shipped as security.

**Why** — the stack at the top of the file *is* the controller's security spec, readable in order: who may enter, what gets loaded, what gets checked. Note: the load itself should also be the authorization — records loaded through `Current.user`'s associations so the inaccessible record simply doesn't exist (Campfire's `set_room` goes through `Current.user.memberships`, never `Room.find`). That whole worldview — auth-by-association, secure-by-default class macros, the IDOR you cannot type — is owned by `10-auth-security.md`; here, just never write a bare `Model.find(params[:id])` for anything access-controlled.

---

## 9. Controller inheritance + `super`: the second path IS the first path

**When** — a second client needs an almost-identical action: a bot posting a message, an API consumer creating a record, an admin variant of an existing flow.

**Do** — subclass the existing controller, call `super`, and override only the seam that differs. Campfire's bot-message endpoint (complete file):

```ruby
class Messages::ByBotsController < MessagesController
  allow_bot_access only: :create

  def create
    super
    head :created, location: message_url(@message)
  end

  private
    def message_params
      if params[:attachment]
        params.permit(:attachment)
      else
        reading(request.body) { |body| { body: body } }
      end
    end

    def reading(io)
      io.rewind
      yield io.read.force_encoding("UTF-8")
    ensure
      io.rewind
    end
end
```

`super` runs the *entire* human `create` — the same creation path, the same broadcasts, the same fan-out. The subclass overrides exactly two seams: `message_params` (a bot sends a raw request body, not a form field — `reading` is the small helper that reads it) and a `head :created` for the API caller. (`allow_bot_access` is the secure-by-default opt-out vocabulary — `10-auth-security.md`.)

**Not** — you will be tempted to write a standalone `Api::MessagesController` that re-implements lookup, creation, and broadcasting "to keep the API clean." Don't. It silently diverges the first time you fix a bug in one path and forget the other.

**Why** — the bot path *is* the human path: literally the same action with one parameter-parsing override and one status code. Zero drift is structural, not disciplined. Private methods like `message_params` are designed seams — small, named, overridable — which is why the parent should always read its params through such a method rather than inline.

---

## 10. `partition`: one query, two lists

**When** — one page shows the same collection split by a rule: admins and members, open and closed, read and unread.

**Do** (Campfire):

```ruby
users = account_users.ordered.without_bots
@administrators, @members = users.partition(&:administrator?)
```

**Not** — don't run two scoped queries (`where(role: :administrator)` / `where.not(...)`) for one already-loadable set.

**Why** — one query, one pass, and no risk the two lists were scoped differently by hand (different ordering, one filtered bots and one didn't). The code matches the thought: *one set, split by a rule.*

---

## 11. The stored-position exception: intent is still CRUD

**When** — the user arranges things by hand (column order on a board, items in a custom sequence). **Derive, don't store** is the default rule — but a deliberate arrangement a human dragged into place has no formula that recovers it. Store it: it's genuine user intent, not a derivable fact.

**Do** — store the `position`, but notice what *doesn't* change: the reorder still reaches the web as CRUD on a noun. Sliding a Fizzy column left is the `create` of a `LeftPosition`:

```ruby
resources :columns, only: [] do
  resource :left_position, module: :columns
  resource :right_position, module: :columns
end
```

```ruby
class Columns::LeftPositionsController < ApplicationController
  include ColumnScoped

  def create
    @left_column = @column.left_column
    @column.move_left

    respond_to do |format|
      format.turbo_stream
      format.json { head :created }
    end
  end
end
```

And `move_left` on the model is a precise transactional two-row swap, so the board never has two columns claiming the same slot (Fizzy):

```ruby
def move_left
  swap_position_with left_column
end

def left_column
  board.columns.where("position < ?", position).sorted.last
end

private
  def swap_position_with(other_column)
    return if other_column.nil?

    transaction do
      old_position = self.position
      self.update_column(:position, other_column.position)
      other_column.update_column(:position, old_position)
    end
  end
```

**Not** — don't route reordering as `post :move_left` on the columns controller, and don't let "we had to store position" license storing other derivable state — **flags lie**, and elsewhere in Fizzy the card list has *no* position column at all because card order derives from sort scopes. That's the counterpoint that proves the judgment is case-by-case.

**Why** — store when the value is genuine intent that can't be recomputed; derive when it's a function of data you already have. Either way the verb never makes it onto the controller — derived or stored, the web only ever sees the create of a noun.

---

## 12. Worked example: the ban arc

The patterns above compose. "Ban a user" is one feature that exercises verb-as-noun, the two-line controller, the ordered model transaction, and the guard stack at once — trace it end to end and you have the whole layer's doctrine in one arc.

**The naive version you will be tempted to write:** a `post :ban` member route; an action that does `user.update!(status: "banned")`, loops `user.messages.each(&:destroy)` in-request, and redirects; a `redirect_if_banned` check sprinkled into the controllers you remember. Every piece fails: the flag describes the account, not the machine (log out, re-register, back in thirty seconds); the live session keeps posting because the check only bites on the next login; the in-request loop times out half-done with no transaction, leaving a contradictory half-state.

**The 37signals version.** Route: `resource :ban, only: %i[ create destroy ]`. Controller: the two-line `Users::BansController` from §2 — `ensure_can_administer` first, then `set_user`, then `create` is `@user.ban; redirect_to @user`. The controller does not know what banning entails — and that's the entire controller-layer lesson: the verb found its noun, the noun's lifecycle is the route, and the action is pure translation.

What `@user.ban` actually does is one model method whose **order is the correctness**: inside one transaction, snapshot each session IP into a durable `Ban` row *before* deleting the sessions those IPs live on, then kick live connections, defer the slow content removal to a job, and flip the status enum **last**. `unban` is the literal **inverse CRUD** — destroy the noun's rows, restore the status. The full ordered transaction, why snapshot-before-purge is load-bearing, and the ambient request-time enforcement gate (`Ban.banned?(request.remote_ip)` installed app-wide by one concern): `10-auth-security.md` §13.

**Why this is the worked example:** count the files — a two-line controller stub, one route line, one ordered model method, a tiny job. The thinness of the controller is the receipt; the ordered transaction is what it's a receipt *for*. None of it is clever. Each piece lives at exactly the right altitude, in exactly the right order.

---

## 13. Red flags → fixes

| Red flag in the diff | The fix |
|---|---|
| `member do post :something end` | Find the noun; route `resource :something_noun, only: %i[ create destroy ]` |
| A controller action longer than ~3 lines | The missing model method — move the work, leave the translation |
| `def open_x` / `def switch_x` / `def jump_to_x` | It's a read — another route into the existing `#show` |
| `resources :profile` with an id that's always the current user's | Singular `resource` + `scope defaults: { user_id: "me" }` |
| `namespace :users` bending the URL just to organize controllers | `scope module: "users"` — folder mirrors routes, URL doesn't pay |
| A view helper with `case record when Comment … when Event …` building URLs | `resolve` blocks in `routes.rb`; for derived URLs, `direct` |
| Query-building from `params` inline in `index` (and copied to the export, the badge…) | Name the query as a noun: `from_params` find-or-build + normalized `params_digest`; index becomes one line |
| `params.permit!` or raw `params` into `update!` | `params.require(:noun).permit(:exact, :fields)` — the allow-list is the defense |
| Permission check re-typed inside each action body | One predicate, one `before_action … only:` at the top; stack order = guard sequence |
| `Api::XsController` re-implementing an existing action | Subclass + `super`; override only the params seam and the response status |
| Two `where` queries to split one set for one page | `partition` — one query, two lists |
| `post :move_left` custom verb for reordering | `resource :left_position` whose `create` calls a transactional model swap |
| Status flag flipped first, cleanup after, no transaction | Ordered transaction: snapshot durable facts first, flip the flag last; undo = inverse CRUD |
