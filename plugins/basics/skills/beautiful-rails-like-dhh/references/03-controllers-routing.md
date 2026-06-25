# Controllers & Routing — The Layer That Almost Disappears

Read before writing/reviewing a controller action, adding a route, or reaching for a custom verb (`post :ban`, `member do … end`).

---

## 1. The controller's only job

A controller translates HTTP into a method call on a noun: receive the request, call **one** method, respond. Authorization rides along as `before_action`s; everything else belongs in the model.

```ruby
def create
  @user.ban
  redirect_to @user
end
```

Thinness isn't a discipline — it's what's left when the model took the weight (`02-models.md`). An action over ~3 lines is a receipt that a model method is missing; go find it.

Two free mechanics, don't fight them:
- **Rendering is implicit.** A `show` with no `render` renders `show.html.erb`. Campfire ships `def show; end`. Never write `render :show` inside `show`.
- **Conventions bind the layers.** `rooms#show` → `RoomsController#show` → `rooms/show`. Custom action names, explicit renders, and hand-built URLs all start charging you for what was free.

---

## 2. Verb-as-noun: every state change is CRUD on a hidden noun

The load-bearing pattern. From Fizzy's `STYLE.md`:

> We model web endpoints as CRUD operations on resources (REST). When an action doesn't map to a standard CRUD verb, we introduce a new resource rather than adding custom actions.
>
> ```ruby
> # Bad
> resources :cards do
>   post :close
>   post :reopen
> end
> # Good
> resources :cards do
>   resource :closure
> end
> ```

Any feature that arrives as a verb (ban, reset, regenerate, close, mute, pin, publish, triage, archive) — **find the noun whose lifecycle is changing** and route it as that noun's create/update/destroy.

| Verb | Hidden noun | CRUD action | Source |
|---|---|---|---|
| ban / unban a user | `Ban` | create / destroy | Campfire |
| regenerate join code | `JoinCode` | create | Campfire |
| reset a bot's API key | `Key` | update | Campfire |
| close / reopen a card | `Closure` | create / destroy | Fizzy |
| gild / ungild a card | `Goldness` | create / destroy | Fizzy |
| triage a card | `Triage` | create | Fizzy |
| watch / pin / publish | `Watch`/`Pin`/`Publish` | create / destroy | Fizzy |

One flat route line, not a `member` block:

```ruby
resource :ban, only: %i[ create destroy ]
```

Collapses to the two-line CRUD shape (Campfire, complete file):

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

There's no `ban` action — banning is *creating* a `Ban`. The transaction, IP harvesting, and content removal live on `@user.ban` (`02-models.md`).

**A model is allowed to have verbs; a controller is not.** On the controller a custom verb is public HTTP surface (route + helper + guard entry, all of which drift). On the model, `reset_join_code` is a domain method hiding behind a standard `create` route. Naming the noun also forces "what record am I creating?" — usually a row you wanted anyway (a `Ban` you can look up by IP later).

---

## 3. Cardinality: singular `resource` vs plural `resources`

Let the router encode cardinality. `resources :rooms` → seven collection routes. Singular `resource :ban` → six (no `index`) because the noun is one-per-context (a user has one ban relationship, one profile; a card has one closure). Forcing plural means a meaningless `index`, a path helper demanding an always-implied id, and a `routes.rb` that hides whether the noun is a collection.

---

## 4. The verb that was a read

The deepest find-the-noun: the verb that creates nothing. "Open a room," "switch rooms," "jump to a message," "view as X" change the screen but are `GET` on an existing `#show`. Campfire's room open, switch, and deep-link are the *same* action:

```ruby
def show
  @messages = find_messages
end
```

The deep link is just another route into `rooms#show` with a `message_id` param. The only real decision — where in the conversation to open — is two scopes on one render path:

```ruby
def find_messages
  messages = @room.messages.with_creator.with_attachment_details.with_boosts

  if show_first_message = messages.find_by(id: params[:message_id])
    @messages = messages.page_around(show_first_message)  # deep link
  else
    @messages = messages.last_page                        # plain open
  end
end
```

Both branches feed the view the same `@messages`; only the slice differs (`page_around`/`last_page` are model scopes). One render path = one place pagination, eager-loading, and auth are decided. Three endpoints (`open_room`/`switch_room`/`jump_to_message`) = three copies that drift.

---

## 5. Routing moves that keep `routes.rb` flat

### `scope module:` — folder mirrors routes, URL doesn't pay

Nest the controller under a folder without the URL inheriting `/users/users/...`:

```ruby
resources :users, only: :show do
  scope module: "users" do
    resource :avatar, only: %i[ show destroy ]
    resource :ban,    only: %i[ create destroy ]
  end
end
```

`/users/8/ban` → `Users::BansController` at `app/controllers/users/bans_controller.rb`; URL stays flat. Don't use `namespace :users` (it prefixes the URL too).

### `scope defaults:` — the argument-free path helper

When a route always means "the current user's X":

```ruby
scope defaults: { user_id: "me" } do
  resource :sidebar, only: :show
  resource :profile
end
```

`user_profile_path` now generates `/users/me/profile` with no argument, instead of degrading into a bespoke `/my_profile` route.

### `direct` — a named helper for a derived URL

For a URL the resourceful routes don't generate, typically derived from record state:

```ruby
direct :fresh_user_avatar do |user, options|
  route_for :user_avatar, user.avatar_token, v: user.updated_at.to_fs(:number)
end
```

`fresh_user_avatar_url(user)` exists app-wide; `v=` changes when the user changes. Don't hand-concatenate URLs or store a computed URL on the record (a stored copy is a second source of truth).

### `resolve` — the record knows its own URL

When a record's "page" is really somewhere else (a comment lives on its card's page):

```ruby
resolve "Comment" do |comment, options|
  options[:anchor] = ActionView::RecordIdentifier.dom_id(comment)
  route_for :card, comment.card, options
end

resolve "Notification" do |notification, options|
  polymorphic_url(notification.notifiable_target, options)
end
```

`link_to comment` and `url_for notification` Just Work everywhere. `direct` and `resolve` are two halves of one move: teach the *router* how a thing becomes a URL, once. A `case record when Comment … when Notification …` URL-builder is a missing `resolve` block.

---

## 6. The URL's query state is a noun too

When an index has filters (`?board_ids[]=2&assignee_ids[]=7`), sorts, or search — and the query-building starts appearing in `index`, the sidebar, the export, the badge — name the query itself as a record. Fizzy's `Filter` is a real table, found-or-built from params:

```ruby
class Filter < ApplicationRecord
  include Fields, Params, Resources, Summarized

  belongs_to :creator, class_name: "User", default: -> { Current.user }
  belongs_to :account, default: -> { creator.account }

  def self.from_params(params)
    find_by_params(params) || build(params)
  end
end
```

Matching is a DB lookup on a normalized fingerprint:

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
      params.to_h.compact_blank
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

`normalize_params` drops blanks/defaults, stringifies, and **sorts by key**, so reordered params collapse to one digest. A unique index on `[creator_id, params_digest]` makes each distinct filter one row; `before_save` keeps the key in sync.

The whole index action:

```ruby
def index
  set_page_and_extract_portion_from @filter.cards
end
```

`Filter#cards` owns the conditional-scope chain. Because the query is a row, users get saveable/shareable/recently-used filters for free. Inline `Card.where(...)` from `params` gets copy-pasted into every surface and none of the copies can be saved or linked. The URL carries the contract: same params → same query. Almost nothing in a web app *isn't* CRUD on some noun.

---

## 7. Strong params: the allow-list

Name exactly the fields you accept:

```ruby
def message_params
  params.require(:message).permit(:body, :attachment, :client_message_id)
end
```

Never `params.permit!`, never pass raw `params` into `update!`/`create!`. `params` is untrusted — permit-everything is how a client sets `admin: true` on a row you never rendered a form for. The allow-list makes the unsafe write unexpressible; that "ceremony" is the entire defense.

---

## 8. `before_action`: declaration order is the guard sequence

`before_action`s run in declaration order, and the order is design. When the permission doesn't need the record, authorize before loading:

```ruby
before_action :ensure_can_administer   # are you allowed in here at all?
before_action :set_user                # only then load the target
```

When the guard needs the record, load first:

```ruby
before_action :set_message
before_action :ensure_can_administer, only: %i[ edit update destroy ]

private
  def ensure_can_administer
    head :forbidden unless Current.user.can_administer?(@message)
  end
```

One predicate, declared once, guarding every write. Don't re-type the check in each action body (copies drift; the new action forgets it). A guard reading `@user` before `set_user` ran is a nil-check bug shipped as security.

The load itself should also be the authorization — records loaded through `Current.user`'s associations so the inaccessible record doesn't exist (Campfire's `set_room` goes through `Current.user.memberships`, never `Room.find`). That worldview is owned by `10-auth-security.md`; here, just never write a bare `Model.find(params[:id])` for anything access-controlled.

---

## 9. Controller inheritance + `super`: the second path IS the first path

When a second client needs an almost-identical action (a bot, an API consumer, an admin variant), subclass, call `super`, override only the seam that differs. Campfire's bot-message endpoint (complete file):

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

`super` runs the entire human `create` — same creation, broadcasts, fan-out. The subclass overrides exactly two seams: `message_params` (a bot sends a raw body) and the `head :created`. A standalone `Api::MessagesController` re-implementing lookup/creation/broadcasting diverges the first time you fix a bug in one path and forget the other. Zero drift is structural, not disciplined — which is why the parent should read its params through an overridable method rather than inline.

---

## 10. `partition`: one query, two lists

One page showing a collection split by a rule (admins/members, open/closed, read/unread):

```ruby
users = account_users.ordered.without_bots
@administrators, @members = users.partition(&:administrator?)
```

One query, one pass — no risk the two lists were scoped differently by hand. Don't run two `where` queries for one already-loadable set.

---

## 11. The stored-position exception: intent is still CRUD

**Derive, don't store** is the default — but a deliberate arrangement a human dragged into place has no formula to recover it. Store the `position`; the reorder still reaches the web as CRUD on a noun. Sliding a Fizzy column left is the `create` of a `LeftPosition`:

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

`move_left` is a transactional two-row swap, so the board never has two columns claiming one slot:

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

Don't route reordering as `post :move_left`, and don't let "we stored position" license storing other derivable state — **flags lie**; elsewhere Fizzy's card list has no position column because card order derives from sort scopes. Store genuine intent that can't be recomputed; derive everything else. Either way the web only sees the create of a noun.

---

## 12. Worked example: the ban arc

"Ban a user" exercises verb-as-noun, the two-line controller, the ordered model transaction, and the guard stack at once.

**The naive version:** a `post :ban` member route; an action doing `user.update!(status: "banned")`, looping `user.messages.each(&:destroy)` in-request, plus a `redirect_if_banned` check sprinkled around. Each piece fails — the flag describes the account not the machine (re-register in 30 seconds); the live session keeps posting; the untransacted in-request loop times out half-done.

**The 37signals version.** Route: `resource :ban, only: %i[ create destroy ]`. Controller: the two-line `Users::BansController` from §2 — guard first, load second, `create` is `@user.ban; redirect_to @user`. The controller doesn't know what banning entails: the verb found its noun, the noun's lifecycle is the route, the action is pure translation.

`@user.ban` is one model method whose **order is the correctness**: in one transaction, snapshot each session IP into a durable `Ban` row *before* deleting those sessions, kick live connections, defer slow content removal to a job, flip the status enum **last**. `unban` is the inverse CRUD. The full ordered transaction and the request-time enforcement gate (`Ban.banned?(request.remote_ip)`): `10-auth-security.md` §13. The thin controller is the receipt; the ordered transaction is what it's a receipt for.