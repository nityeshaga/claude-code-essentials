# Turbo: Drive, Frames, Streams — the Request-Driven Half of Hotwire

Read this when you're about to make any part of a page update without a full reload — a live feed, an in-place edit, a lazy-loaded region, a real-time broadcast — and you feel the pull toward fetch handlers, JSON payloads, or a client-side renderer.

## Contents

- [The three-mechanism ladder](#the-three-mechanism-ladder)
- [Turbo Drive: the floor you get for free](#turbo-drive-the-floor-you-get-for-free)
  - [The form-response contract: redirect on success, status on failure](#the-form-response-contract-redirect-on-success-status-on-failure)
  - [The Drive cache: temporary elements and idempotent transforms](#the-drive-cache-temporary-elements-and-idempotent-transforms)
- [Turbo Frames: one region, updating on its own](#turbo-frames-one-region-updating-on-its-own)
  - [The permanent frame: a sidebar that survives navigation](#the-permanent-frame-a-sidebar-that-survives-navigation)
  - [Frames as page-assembly strategy](#frames-as-page-assembly-strategy)
  - [Session expiry inside a frame: break out, don't error](#session-expiry-inside-a-frame-break-out-dont-error)
  - [Eager-on-intent: prefetch by flipping one attribute](#eager-on-intent-prefetch-by-flipping-one-attribute)
  - [Edit-in-place: the frame-navigation mechanic](#edit-in-place-the-frame-navigation-mechanic)
- [Turbo Streams: HTML + action + target, over two transports](#turbo-streams-html--action--target-over-two-transports)
  - [The full send-a-message wiring](#the-full-send-a-message-wiring)
  - [HTML over the wire: the trade, stated honestly](#html-over-the-wire-the-trade-stated-honestly)
  - [Broadcasting is an explicit method, not a callback](#broadcasting-is-an-explicit-method-not-a-callback)
  - [The optimistic-id handshake: the de-dupe is deleted, not written](#the-optimistic-id-handshake-the-de-dupe-is-deleted-not-written)
  - [Edit and delete: same address, different verb](#edit-and-delete-same-address-different-verb)
  - [Intent as data on the wire](#intent-as-data-on-the-wire)
  - [Wake-from-sleep catch-up is a diff, not a reload](#wake-from-sleep-catch-up-is-a-diff-not-a-reload)
- [Uploads: one attachment line, one polymorphic blob partial](#uploads-one-attachment-line-one-polymorphic-blob-partial)
- [Red flags → fixes](#red-flags--fixes)
- [The composition](#the-composition)

Scope: this file owns the *pull* mechanics — Drive, Frames, and Streams over both transports — plus the broadcast discipline around them. Turbo 8 morphing and `broadcasts_refreshes` belong to `06-morphing-live-updates.md`. Stimulus controller authoring belongs to `07-stimulus-widgets.md`. The worldview argument for why the server renders at all lives in `00-frontend-first-principles.md`.

---

## The three-mechanism ladder

Turbo is a server-driven UI model: the server keeps rendering HTML, the browser keeps swapping pieces of the page, and you write zero fetch-and-render glue. Three mechanisms, escalating in precision. Always start at the bottom of the ladder and climb only when the lower rung can't express the update.

| Mechanism | Granularity | You write | When |
|---|---|---|---|
| **Turbo Drive** | whole `<body>` | nothing | plain navigation — `link_to`, ordinary form submit |
| **Turbo Frame** | one region | a `turbo_frame_tag` with an id (+ optional `src:`) | one part of the page loads, swaps, or persists independently |
| **Turbo Stream** | one DOM node, one verb | a one-line `.turbo_stream.erb` template and/or a `broadcast_*_to` call | a precise surgical change — append a row, replace a node, remove a node — possibly pushed to *other* people's screens |

The decision rule: **navigation is Drive (free), a self-contained region is a Frame, a surgical multi-screen mutation is a Stream.** You will be tempted to skip the ladder and reach for a Stimulus controller doing `fetch()` — don't. Every rung below replaces JavaScript you'd otherwise own.

---

## Turbo Drive: the floor you get for free

**When:** any full-page navigation.

**Do:** nothing. Write a boring `link_to` and a boring resourceful `GET`. Drive intercepts the click, turns it into a background fetch, and swaps the new `<body>` into the current page — SPA-feel, zero code. This is why opening a room in Campfire is *just* a `GET` to `rooms#show`: there is no "switch room" code anywhere, because Drive makes a normal navigation feel instant.

**Not:** you will be tempted to write a "navigate without reload" handler — a click listener, a fetch, an innerHTML swap, a pushState call. Don't. That is a hand-rolled reimplementation of the thing already running on every page.

**Why:** Drive is the baseline that makes the rest of the ladder cheap. Count the edge cases this absorbs for free: history/back-button handling, scroll restoration, asset reload detection, in-flight request cancellation — all yours the moment you do nothing.

"Do: nothing" has exactly two taxes, and both are silent failures if unpaid:

### The form-response contract: redirect on success, status on failure

**When:** any controller action handling a stateful form submit — `create`, `update`, `destroy` — that has a failure branch.

**Do:** success ends in a redirect (Turbo Drive expects a 303 and follows it; pass `status: :see_other` explicitly on `destroy`/`update` paths). Failure re-renders **with an error status** (Hotwire docs):

```ruby
def create
  @board = Current.user.boards.new(board_params)
  if @board.save
    redirect_to @board
  else
    render :new, status: :unprocessable_entity
  end
end
```

**Not:** you will be tempted to write the classic pre-Turbo `render :new` with its implicit 200. Don't — Drive deliberately refuses to render a 200 from a POST (browsers own the "resubmit this form?" behavior, and Turbo can't replicate it), so it stays on the current URL and your validation errors silently never paint. The only submit responses Drive renders directly are 4xx/5xx — `422 Unprocessable Content` for validation errors, 5xx for a broken server.

**Why:** the controller examples in this file are bang-style (`create!`) happy paths — the first time you write an if-save-else branch, the `else` must carry the status or the failure path is a no-op that no test of the success path will ever catch.

### The Drive cache: temporary elements and idempotent transforms

**When:** anything ephemeral or JS-mutated rides on a page — flash messages, expanded menus, client-side DOM decoration.

**Do:** know that Drive snapshots every page before navigating away (`cloneNode` — event listeners discarded) and re-shows the copy on Back/Forward and as a preview during visits. Three disciplines pay for that speed (Hotwire docs):

```erb
<div class="flash" data-turbo-temporary><%= notice %></div>
```

1. Mark inherently temporary elements (flashes, alerts) `data-turbo-temporary` — Drive strips them before caching, so they don't redisplay on Back.
2. Make client-side DOM transformations idempotent — restored pages re-run your JS against already-transformed HTML. Stamp a `data` attribute on processed nodes and skip them on the second pass.
3. For teardown neither covers, listen for `turbo:before-cache`. Per-page opt-out is `<meta name="turbo-cache-control" content="no-preview">` (or `no-cache`); detect a cache preview via the `data-turbo-preview` attribute on `<html>`.

**Not:** you will be tempted to debug the reappearing flash message as a server bug. Don't — the back button serves Drive's cache, not your controller.

**Why:** the cache is what makes Drive feel instant; these three lines are its entire tax, and the bug class — flashes resurrecting on Back, double-applied transformations — never ships.

---

## Turbo Frames: one region, updating on its own

A frame is a region with an id. Any link or form inside it (or targeted at it) whose response contains a frame with the *same* id replaces only that region. Three options carry the whole feature: `src:` makes the frame lazy-load its content in a second request, `loading: :lazy` defers that request until visible, `turbo_permanent` makes the node survive navigation untouched.

### The permanent frame: a sidebar that survives navigation

**When:** one region must outlive every navigation — a sidebar, a player, a persistent panel.

**Do (Campfire):** wrap it in a frame marked permanent, loaded once via `src:`:

```ruby
# A helper so every render of the sidebar agrees on the same frame
def sidebar_turbo_frame_tag(src: nil, &)
  turbo_frame_tag :user_sidebar, src: src, target: "_top", data: {
    turbo_permanent: true
  }, &
end
```

One frame, fetched once, persisted across every room switch. `target: "_top"` makes links inside it drive full navigations instead of swapping inside the frame.

**Not:** you will be tempted to re-render the sidebar on every page and cache it, or to manage its state in JavaScript across navigations. Don't — `turbo_permanent` means the DOM node itself is carried over, scroll position and all.

**Why:** the sidebar's state (scroll, open sections) lives in the DOM, and the DOM survives. Nothing to serialize, nothing to restore.

### Frames as page-assembly strategy

**When:** a page composes several independently-heavy regions — a board with N columns, a dashboard with N widgets.

**Do (Fizzy):** don't render the heavy content in the initial response at all. Ship one *empty* frame per region, each naming its own content endpoint:

```erb
<%# Each column on a Fizzy board is an empty frame that fills itself %>
<%= turbo_frame_tag dom_id(column, :cards), src: board_column_path(column.board, column) %>
```

At the other end of that `src:` is a perfectly ordinary resourceful `GET` (`#show`) that renders the cards. The first response paints the page skeleton instantly; each region's heavy content arrives on its own request, in parallel. The same shape recurs at widget scale — an assignee picker is an empty-src frame pointed at a `new_…` endpoint:

```erb
<%= turbo_frame_tag card, :assignment, src: new_card_assignment_path(card), loading: :lazy %>
```

A wall of these — one per column, one per deferrable widget — is the default page-assembly strategy, not a one-off. The frame *is* the client; the URL carries the contract.

**Not:** you will be tempted to render everything in one response and eat the slow first paint, or to build a client that fetches JSON per region and stitches the page together. Don't. Each frame is a `turbo_frame_tag` plus a normal Rails route — lazy loading, parallel fetching, and per-region refresh with no second app.

**Why:** instant skeleton, parallel fills, and every region independently refreshable by re-requesting its own URL. The "loading orchestration layer" never gets built.

One caveat rides along (Hotwire docs): frame navigation does not touch the browser URL or history. For a frame where the user's position is shareable state — a paginated list, a tab set — back, refresh, and share are silently broken unless you render the frame (or its links/forms) with `data-turbo-action="advance"` to promote frame navigations to full visits. Once promoted, it becomes *your* responsibility to rebuild that URL-derived state (page 2, the active tab) on a hard refresh — the URL carries the contract, so the controller must honor it.

### Session expiry inside a frame: break out, don't error

**When:** `src:` frames live behind authentication — which, given the page-assembly strategy above, is every frame you ship.

**Do:** know the failure semantics first (Hotwire docs): if a frame request returns a response without a matching `<turbo-frame>`, Turbo treats it as an error — it writes an informational "Content missing" message into the frame and throws. The canonical trigger is an expired session: the frame's GET gets redirected to the login page, which contains no such frame. Declare the login page as requiring a full-page load, so any response that lands there breaks out of the frame as a real navigation:

```erb
<%# app/views/sessions/new.html.erb — turbo-rails helper; emits
    <meta name="turbo-visit-control" content="reload"> into the head %>
<% turbo_page_requires_reload %>
```

For handling a missing frame some other way (transform the response, visit another location), intercept the `turbo:frame-missing` event.

**Not:** you will be tempted to diagnose "Content missing" as a frame-id mismatch and start wrapping the login page in matching frames. Don't — the login page is a navigation, not a region; one meta tag declares it so for every frame in the app at once.

**Why:** a wall of `src:` frames behind auth means session expiry *will* hit this — N frames, N redirects, N "Content missing" boxes. The meta tag turns all of them into the one correct behavior: land on the login page, full-page.

### Eager-on-intent: prefetch by flipping one attribute

**When:** a lazy frame's content should be ready *before* the click lands — a menu about to open, a dialog about to show.

**Do (Fizzy):** a lazy frame waits until it scrolls into view; prefetch on *intent* by flipping its `loading` attribute to `eager` when the user signals (hover, dialog open). The JavaScript is one line and stays in the background:

```javascript
// Fired on mouseenter — every lazy frame inside the dialog starts loading now
loadLazyFrames() {
  Array.from(this.dialogTarget.querySelectorAll("turbo-frame")).forEach(frame => { frame.loading = "eager" })
}
```

The Rails half is what makes this safe to repeat: the frame's endpoint computes a strong ETag from exactly the records it renders —

```ruby
# The menu endpoint: hover-prefetch and the real navigation hit the same URL;
# the second request comes back 304 Not Modified against the browser cache.
def show
  fresh_when etag: [ @filters, @boards, @tags, @users, @accounts ]
end
```

The frame's `src:` declares *where* the content lives; `fresh_when` declares *when* it may be reused. Prefetch-on-intent costs almost nothing because the endpoint is conditional-GET-aware.

**Not:** you will be tempted to build a prefetch cache in JavaScript, or to debounce/track which regions were already fetched. Don't — the browser's HTTP cache plus an ETag *is* that cache, maintained by people who aren't you.

**Why:** the hover request and the click request are the same GET to the same URL; the convention at the HTTP boundary (conditional GET) absorbs the duplication. Server side it's pure Rails: one `fresh_when` line.

### Edit-in-place: the frame-navigation mechanic

The frame-side fact you need here: when a link targets a frame (`data: { turbo_frame: ... }`) and the response contains a frame with the **same id**, Turbo swaps only that region — so a row becomes its own editor in place, the controller's `edit` action is genuinely empty (`def edit; end`), and the form's redirect swaps the frame back to the presentation. The swap is free; the id agreement carries all the weight. Full three-file pattern (display frame + link target + edit response, all deriving `dom_id(record, :edit)`): see `04-views-helpers.md` §5.

---

## Turbo Streams: HTML + action + target, over two transports

A stream is a fragment of HTML wrapped in an *action* aimed at a *target DOM id*. The full verb set (Hotwire docs): `append`, `prepend`, `replace`, `update`, `remove`, `before`, `after`, `refresh` — plus `method="morph"` variants of `replace`/`update`, and a `targets` (plural) attribute that takes a CSS selector instead of a single dom id. One distinction earns its own line: `update` swaps only the target's *children* and keeps handlers bound to the target element alive, while `replace` swaps the element itself and forces any Stimulus controller on it to reconnect — when the target carries behavior, reach for `update`. A stream says, literally: take this HTML and append it to the element with this id. The load-bearing fact — the one that deletes whole subsystems — is that the identical stream travels over **two transports**:

1. **In-band**: as the HTTP response to a form submit (a `create.turbo_stream.erb` template).
2. **Out-of-band**: pushed over a WebSocket from the model via `broadcast_append_to`.

Same action, same target, same partial, byte-identical HTML. The HTTP reply and the live update are **one feature, not two**.

One boundary rule before the patterns (Hotwire docs): a stream target is a **plain element with a `dom_id`** — never a `<turbo-frame>` added for the stream's sake. Frames contribute nothing to streams, and their presence changes the behavior of every `<a>` and `<form>` they contain; introduce a frame only where you want scoped navigation or lazy loading, and aim streams at ordinary elements.

### The full send-a-message wiring

**When:** a created record must appear on the creator's screen instantly and on every other open screen a half-second later.

**Do (Campfire):** the complete wiring is four small pieces, and none of them renders anything by hand.

The controller — three real lines, no rendering:

```ruby
class MessagesController < ApplicationController
  def create
    set_room
    @message = @room.messages.create_with_attachment!(message_params)

    @message.broadcast_create
    deliver_webhooks_to_bots
  rescue ActiveRecord::RecordNotFound
    render action: :room_not_found
  end
end
```

The HTTP response — a one-line template:

```erb
<%# app/views/messages/create.turbo_stream.erb %>
<%= turbo_stream.append dom_id(@message.room, :messages), @message %>
```

One caveat the Campfire example elides (Hotwire docs): official doctrine is to design the flow to work *without* streams first, then layer them on — the canonical controller answers both formats, `format.turbo_stream` plus a `format.html { redirect_to ... }` fallback via `respond_to`, so native apps, dropped WebSockets, and stream-less clients still get a working flow. Campfire ships stream-only here because its clients are guaranteed Turbo-capable; default to the fallback unless yours are.

The WebSocket broadcast — a plain method in a plain `Broadcasts` module on the model:

```ruby
module Message::Broadcasts
  def broadcast_create
    broadcast_append_to room, :messages, target: [ room, :messages ]
    ActionCable.server.broadcast("unread_rooms", { roomId: room.id })
  end

  def broadcast_remove
    broadcast_remove_to room, :messages
  end
end
```

And the subscription — one line in the room's show view, which also renders the initial list through the *same* partial both transports use:

```erb
<%# rooms/show.html.erb %>
<%= render partial: "messages/message", collection: @messages, cached: true %>
<%= turbo_stream_from @room, :messages %>
```

That `turbo_stream_from` line is the **entire** real-time wiring. No channel class, no event names, no payload schema, no socket handler. The view subscribes to `[@room, :messages]`; the model broadcasts to `[room, :messages]`; both resolve through the same signing/`dom_id` machinery, so they cannot spell the channel differently. The HTTP target `dom_id(@message.room, :messages)` and the broadcast target `[room, :messages]` resolve to the byte-identical string for the same reason. And `broadcast_append_to` defaults to rendering `messages/_message` — the same partial the page load used. **One renderer.** Rails stays small because each layer trusts a convention at its boundary.

**Not:** you will be tempted to render the message three ways — the partial for the page, a `render_to_string` (or worse, a JSON blob) for the socket, an inline string for the HTTP reply — with hand-typed id strings like `"room_#{id}_messages"` in one place and `"msg-#{id}"` in another. Don't. The day you add a badge to the partial, the page shows it and the broadcast forgets it, and nothing errors — the live path just silently drifts. Never type a DOM id as a string; always ask `dom_id(model)` or pass the `[model, :suffix]` array form on both sides of the wire.

**Why:** one partial, addressed by one function, over both transports means there is no second copy of the markup to drift and no id string to mistype. Count the edge cases this absorbs for free: render drift, channel-name drift, target-id drift, the entire socket-handler layer.

### HTML over the wire: the trade, stated honestly

The wire carries HTML, not data. Yes — rendered HTML is more bytes than a tiny JSON blob. That is the trade, made on purpose. You spend a few extra bytes to **delete a subsystem**: no serializer, no client-side templating engine, no payload contract kept in sync between a server and a client, no second renderer, no divergence bug class. For a chat message the byte difference is noise; the maintenance difference is an entire layer you never write, test, or debug. If you find yourself designing a JSON shape for a live update, stop — the server already knows how to turn the record into HTML; it has a partial. Send *that*. (The full worldview lives in `00-frontend-first-principles.md`; here you need only the mechanic.)

### Broadcasting is an explicit method, not a callback

**When:** wiring a model's live broadcast.

**Do (Campfire):** keep broadcasting a plain method in a plain module — no `included do`, no callback — called explicitly at each call site (the controller's `create`, the webhook reply path):

```ruby
# Called from MessagesController#create and from the bot-webhook reply path —
# and from NOWHERE else. A seed or an import never fires it.
module Message::Broadcasts
  def broadcast_create
    broadcast_append_to room, :messages, target: [ room, :messages ]
  end
end
```

The discriminating question is the standard one: **whose fact is this?** A live browser broadcast is a property of *how* a message came into being (an interactive send), not of the message *existing*. Two consequences:

1. Seeds, imports, backfills, and rake tasks create messages too — none of them should push to browsers. A callback would force a `skip_broadcast` flag onto every one of those paths; an explicit method needs nothing.
2. Create, update, and destroy need three *different* verbs (`append`, `replace`, `remove`). A single `after_create_commit :broadcast` can only ever express one.

Contrast the line that sits one row below in the same model — and *is* a callback:

```ruby
class Message < ApplicationRecord
  after_create_commit -> { room.receive(self) }   # true of EVERY message that exists
end
```

Marking members unread is a fact of the record (true of every message that exists, however it was made), so it rides persistence as an `after_create_commit`; broadcasting is a fact of the call path, so it stays an explicit verb at the call site. The general callback-vs-explicit-method rule — "whose fact is this?", the `_commit`/ghost-row discipline, and the `skip_x`-flag smell — is owned by `02-models.md` §3; what's broadcast-specific is the two consequences above, and get those right here.

**Not:** you will be tempted to wire `after_create_commit :broadcast_create` because it "keeps the controller thin." Don't — you'll be re-adding `skip_broadcast` guards within the month, and you still can't express the three verbs.

### The optimistic-id handshake: the de-dupe is deleted, not written

**When:** the client paints a record optimistically (the instant the user hits Enter) and the authoritative copy then arrives over the wire — the classic duplicate-node problem.

**Do (Campfire):** make the optimistic node and the authoritative broadcast *share an identity from the first keystroke*, so Turbo's own semantics collapse them. Four pieces:

1. The client chooses a UUID and draws the placeholder with `id="message_<that-uuid>"`, sending the UUID along in the form as `client_message_id`. (The JS is background — a template node and a hidden field.)
2. The server persists the client's id, minting one only if absent:

```ruby
class Message < ApplicationRecord
  before_create -> { self.client_message_id ||= Random.uuid } # Bots don't care
end
```

(The `||=` is the tell: a bot posting via the API has no optimistic bubble to reconcile, so it sends no id.)

3. The model overrides what *identity means* — `to_key` is the ActiveModel method every Rails identity helper consults:

```ruby
class Message < ApplicationRecord
  def to_key
    [ client_message_id ]
  end
end
```

4. Now `dom_id(message)` no longer yields `message_472` (a primary key the client could never have guessed before the insert) — it yields `message_<the-uuid-the-client-already-chose>`. When `broadcast_append_to` ships the authoritative HTML, Turbo sees a node whose id already exists in the DOM, and Turbo's **append-with-an-existing-id semantics replace in place** instead of stacking a duplicate.

One overridden method bridges three layers — ActiveModel identity → `dom_id` → Turbo's id matching — and the reconciliation pass evaporates. **The de-dupe is deleted, not written.**

**Not:** you will be tempted to write the reconciliation by hand: a temp id on the placeholder, a find-and-swap when the real id arrives, a race guard for when the broadcast beats the POST response, and per-user "broadcast to everyone except the sender" channels. Don't. That pile is a documented, classic source of duplicate-and-flicker bugs, and every line of it exists only because the server invented a second identity after the insert.

**Why:** when both sides of a boundary ask the framework the same question (`dom_id`, which asks `to_key`), they cannot drift. The duplicate-bubble bug doesn't get fixed — it never gets a chance to exist.

### Edit and delete: same address, different verb

**When:** an updated or destroyed record must vanish or change on every spectator's screen, live.

**Do (Campfire):** because every row is addressed by `dom_id`, editing is a `replace` aimed at the same node and deleting is a `remove` — the same machinery, a different verb. The update action:

```ruby
def update
  @message.update!(message_params)

  @message.broadcast_replace_to @room, :messages,
    target: [ @message, :presentation ],
    partial: "messages/presentation",
    attributes: { maintain_scroll: true }
  redirect_to room_message_url(@room, @message)
end
```

Read what is *not* there: no `if creator == current_user` branch. One action serves two audiences with zero conditionals. Spectators get the broadcast `replace` of the presentation node. The actor gets a plain redirect — and because their submit originated inside the edit frame, the redirect's response naturally swaps that frame back to the presentation. Each audience's path is determined by *where their request originated*, not by a runtime check. Destroy is symmetric: `broadcast_remove_to room, :messages` and the node disappears from every open screen.

**Not:** you will be tempted to branch on actor-vs-spectator, or to give edit/delete their own rendering logic. Don't — the node already has an address; you only need a verb.

**Why:** spectators never sit on a stale message until refresh, and the branch you'd expect to write simply isn't there. (Fizzy reaches the same shape with `method: :morph` on the replace — that variant belongs to `06-morphing-live-updates.md`.)

### Intent as data on the wire

**When:** the client must behave differently for one kind of update — e.g. an edit must not yank the scroll to the bottom the way a new message does.

**Do (Campfire):** look again at the update broadcast above: `attributes: { maintain_scroll: true }`. The server stamps *intent as data on the wire* — a plain attribute riding on the stream element — and client-side glue reads it and behaves accordingly. The model and controller never learn a UI exists; they declare "this change should maintain scroll" as a labeled fact, and the transport stays generic (still just HTML at a target).

**Not:** you will be tempted to fork a second, scroll-aware render path for edits, or to encode the behavior into different partials. Don't — that's the two-renderer drift bug wearing a behavior costume. One renderer; nuance rides along as data.

**Why:** the instruction travels as data, not as code, so you can rewrite the client behavior without touching the model — and vice versa. (The Stimulus that honors the attribute belongs to `07-stimulus-widgets.md`.)

### Wake-from-sleep catch-up is a diff, not a reload

**When:** a client reconnects hours behind — laptop wake, tab restore, flaky network.

**Do (Campfire):** ask "what changed since this client last saw the page?" and answer with a turbo_stream response that reuses the same verbs and the same partial:

```erb
<%# rooms/refreshes/show.turbo_stream.erb — the catch-up response %>
<%= turbo_stream.append dom_id(@room, :messages) do %>
  <%= render partial: "messages/message", collection: @new_messages, cached: true %>
<% end if @new_messages.any? %>

<% @updated_messages.each do |message| %>
  <%= turbo_stream.replace dom_id(message), partial: "messages/message", locals: { message: message } %>
<% end %>
```

The controller computes the diff — new messages since the timestamp, updated messages since the timestamp — with one guard: the updated set is scoped `.without(@new_messages)` so a brand-new message isn't counted as both new and updated. New rows are *appended* by the container's `dom_id`; edited rows are *replaced* by each row's `dom_id`. The catch-up is the send arc and the edit arc, replayed in bulk, over identical machinery.

**Not:** you will be tempted to write `window.onfocus = () => location.reload()` — throw away the whole page and refetch. Don't. A reload loses scroll position, in-progress composition, and every byte of state, to fix a problem that is just "a few rows changed."

**Why:** this is the fifth delivery path (first load, optimistic draw, HTTP reply, live broadcast, catch-up) routing through the one partial and the one address — and the proof the discipline is load-bearing: a path that *cannot* diverge from the other four is a path with no "works only after refresh" bug. (Turbo 8 reaches the same diff-don't-reload end via `broadcasts_refreshes` + morph — see `06-morphing-live-updates.md`.)

---

## Uploads: one attachment line, one polymorphic blob partial

**When:** records carry files — images, video, audio, PDFs, arbitrary binaries.

**Do (Fizzy):** the storage side is one declarative line on the model:

```ruby
class Card < ApplicationRecord
  has_one_attached :image, dependent: :purge_later
end
```

That line buys the blob, the storage indirection, the variants, and the URLs. No upload controller, no file-handling code, no MIME bookkeeping in the model.

The rendering side is the one-renderer move again: **one partial that asks the blob what it is**, instead of a controller branching on type:

```erb
<%# app/views/active_storage/blobs/web/_representation.html.erb %>
<% if blob.video? %>
  <%= tag.video src: rails_blob_path(blob), controls: true, preload: :none %>
<% elsif blob.audio? %>
  <audio controls="true" width="100%" preload="metadata">
    <source src="<%= rails_blob_path(blob) %>" type="<%= blob.content_type %>">
  </audio>
<% elsif blob.variable? %>
  <%= link_to rails_representation_path(blob.variant(variant)) do %>
    <%= image_tag rails_representation_path(blob.variant(variant)) %>
  <% end %>
<% elsif blob.previewable? %>
  <%= image_tag rails_representation_path(blob.preview(variant)) %>
<% else %>
  <span class="attachment__icon"><%= blob.filename.extension&.downcase.presence || "unknown" %></span>
<% end %>
```

The predicates — `blob.video?`, `blob.audio?`, `blob.variable?` (can be resized), `blob.previewable?` (can yield a preview image, e.g. a PDF's first page) — are ActiveStorage's, not yours. The partial doesn't know an mp4 from a PDF; it asks the blob, and the blob answers from its content type. And note the *path* of that partial: `active_storage/blobs/web/_representation` is the conventional override location. Rails ships a default blob partial; supply your own at that exact name and every attachment renders your way — override-by-naming-convention, no framework surgery.

One production option deserves its line. Fizzy processes image variants **immediately on attach** rather than lazily on first view:

```ruby
# Processed immediately on attachment to avoid read-replica issues
# (lazy variants would attempt writes on read replicas).
attachable.variant variant_name, **variant_options, process: :immediately
```

A lazily-generated variant writes the resized file the first time someone *reads* the page — and if that read is served by a read replica, the write fails. `process: :immediately` moves the write to the moment a write is already happening.

**Not:** you will be tempted to write an uploads controller, store paths/content-types on the record, and branch per file type in the view or controller. Don't — each of those is a hand-rolled copy of something ActiveStorage already owns.

**Why:** count the edge cases the one `has_one_attached` line plus the one polymorphic partial absorb: storage backends, variant generation, URL signing, MIME detection, per-type rendering, and the read-replica write trap — none of it in your code.

---

## Red flags → fixes

| Red flag in the diff | The fix |
|---|---|
| `render_to_string` feeding `ActionCable.server.broadcast` | `broadcast_append_to` / `broadcast_replace_to` — one partial, both transports |
| A DOM id typed as a string (`"room_#{id}_messages"`, `"msg-#{id}"`) | `dom_id(model)` / `[model, :suffix]` on both sides — dom_id is the address |
| A channel class, event names, or a JSON payload schema for live updates | `turbo_stream_from` + `broadcast_*_to`; the wire carries HTML, not data |
| `after_create_commit :broadcast_create` (or a `skip_broadcast` flag) | broadcast as an explicit method called at the call path; ask "whose fact is this?" |
| Temp-id reconciliation, "broadcast except sender," a de-dupe pass | client-chosen UUID + `to_key` override; the de-dupe is deleted, not written |
| `if creator == current_user` branching actor vs spectator in update | broadcast `replace` to spectators, plain redirect to the actor — no branch |
| A second render path so edits behave differently on the client | one renderer; stamp intent as `attributes:` data on the broadcast |
| `window.onfocus = () => location.reload()` for catch-up | a turbo_stream diff: append new + replace updated by `dom_id`, `.without()` guard |
| All regions rendered in one slow first response, or a JS fetch-and-stitch client | one empty `src:` frame per region; the frame is the client |
| A JavaScript prefetch cache for menus/dialogs | flip `loading = "eager"` on intent + `fresh_when` ETag; the browser cache is the cache |
| `render :new` (implicit 200) after a failed save | `render :new, status: :unprocessable_entity` — Drive won't render a 200 from a POST; the errors silently never paint |
| A flash partial without `data-turbo-temporary` | mark it temporary, or it redisplays from the Drive cache on Back |
| "Content missing" in frames after idle | the login page needs `turbo_page_requires_reload` (or intercept `turbo:frame-missing`) |
| A `<turbo-frame>` wrapped around a node only so a stream can target it | a plain element + `dom_id` — frames capture every contained link and form |
| A paginated/tabbed frame whose URL never changes | `data-turbo-action="advance"` on the frame, and rebuild URL-derived state on refresh |
| An uploads controller, MIME columns, per-type view branches | `has_one_attached` + the polymorphic blob partial at the override path |

---

## The composition

The pieces interlock into the full real-time arc, and the composition is the lesson:

- `dom_id` everywhere (never a typed id string) gives every node one address —
- so the page render, the `create.turbo_stream.erb` reply, and `broadcast_append_to` can all target the same node through the same partial (**one renderer**) —
- while `turbo_stream_from` + the `[model, :suffix]` array form make subscription and broadcast spell the channel identically by construction —
- and the `to_key` override extends that single identity back to the client's optimistic placeholder, so Turbo's replace-on-existing-id deletes the de-dupe —
- and because the address never changes, edit and delete are just different verbs (`replace`, `remove`) at the same address, catch-up is those same verbs replayed in bulk, and client nuance rides along as `attributes:` data.

Five delivery moments — first load, optimistic draw, HTTP reply, live broadcast, wake-from-sleep catch-up — one partial, one address, zero glue. That's the request-driven half. When the update is "this whole page is stale, re-render and reconcile," climb to Turbo 8 morphing: `06-morphing-live-updates.md`.
