# Turbo: Drive, Frames, Streams — the Request-Driven Half of Hotwire

Read this when you're about to make any page update without a full reload — a live feed, an in-place edit, a lazy-loaded region, a real-time broadcast — and you feel the pull toward fetch handlers, JSON payloads, or a client-side renderer.

Scope: this file owns the *pull* mechanics — Drive, Frames, and Streams over both transports — plus the broadcast discipline around them. Turbo 8 morphing and `broadcasts_refreshes` → `06-morphing-live-updates.md`. Stimulus authoring → `07-stimulus-widgets.md`. The worldview argument for server rendering → `00-frontend-first-principles.md`. The exhaustive stream-action / attribute / event API → `15-hotwire-api-cheatsheet.md`.

---

## The three-mechanism ladder

Turbo is a server-driven UI model: the server keeps rendering HTML, the browser swaps pieces of the page, you write zero fetch-and-render glue. Three mechanisms, escalating in precision. Start at the bottom and climb only when the lower rung can't express the update.

| Mechanism | Granularity | You write | When |
|---|---|---|---|
| **Turbo Drive** | whole `<body>` | nothing | plain navigation — `link_to`, ordinary form submit |
| **Turbo Frame** | one region | a `turbo_frame_tag` with an id (+ optional `src:`) | one part of the page loads, swaps, or persists independently |
| **Turbo Stream** | one DOM node, one verb | a one-line `.turbo_stream.erb` and/or a `broadcast_*_to` call | a surgical change — append a row, replace a node — possibly pushed to *other* people's screens |

Decision rule: **navigation is Drive (free), a self-contained region is a Frame, a surgical multi-screen mutation is a Stream.** The temptation is to skip the ladder and reach for a Stimulus controller doing `fetch()`. Every rung below replaces JavaScript you'd otherwise own.

---

## Turbo Drive: the floor you get for free

Any full-page navigation. Write a boring `link_to` and a boring resourceful `GET`. Drive intercepts the click, turns it into a background fetch, swaps the new `<body>` in — SPA-feel, zero code. This is why opening a room in Campfire is *just* a `GET` to `rooms#show`: there's no "switch room" code, because Drive makes normal navigation feel instant. It absorbs history/back-button, scroll restoration, asset-reload detection, and in-flight cancellation — all yours the moment you do nothing.

"Do nothing" has exactly two taxes, both silent failures if unpaid.

### The form-response contract: redirect on success, status on failure

Any stateful form submit (`create`/`update`/`destroy`) with a failure branch: success ends in a redirect (Drive expects a 303 and follows it — pass `status: :see_other` on `destroy`/`update`). Failure re-renders **with an error status**:

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

The trap is the classic pre-Turbo `render :new` with its implicit 200. Drive refuses to render a 200 from a POST (browsers own "resubmit this form?"), so it stays on the current URL and your validation errors silently never paint. Drive renders submit responses only at 4xx/5xx — `422` for validation errors, 5xx for a broken server. The first time you write an if-save-else branch, the `else` must carry the status or the failure path is a no-op no success-path test will catch.

### The Drive cache: temporary elements and idempotent transforms

Drive snapshots every page before navigating away (`cloneNode` — event listeners discarded) and re-shows the copy on Back/Forward and as a visit preview. Three disciplines pay for that speed:

```erb
<div class="flash" data-turbo-temporary><%= notice %></div>
```

1. Mark inherently temporary elements (flashes, alerts) `data-turbo-temporary` — Drive strips them before caching, so they don't redisplay on Back.
2. Make client-side DOM transformations idempotent — restored pages re-run your JS against already-transformed HTML. Stamp a `data` attribute on processed nodes and skip them on the second pass.
3. For teardown neither covers, listen for `turbo:before-cache`. Per-page opt-out: `<meta name="turbo-cache-control" content="no-preview">` (or `no-cache`); detect a preview via `data-turbo-preview` on `<html>`.

The trap is debugging a reappearing flash as a server bug — the Back button serves Drive's cache, not your controller.

---

## Turbo Frames: one region, updating on its own

A frame is a region with an id. Any link or form inside it (or targeted at it) whose response contains a frame with the *same* id replaces only that region. Three options carry the feature: `src:` lazy-loads content in a second request, `loading: :lazy` defers that request until visible, `turbo_permanent` makes the node survive navigation untouched.

### The permanent frame: a sidebar that survives navigation

When one region must outlive every navigation — a sidebar, a player, a persistent panel — wrap it in a frame marked permanent, loaded once via `src:`:

```ruby
# A helper so every render of the sidebar agrees on the same frame
def sidebar_turbo_frame_tag(src: nil, &)
  turbo_frame_tag :user_sidebar, src: src, target: "_top", data: {
    turbo_permanent: true
  }, &
end
```

One frame, fetched once, persisted across every room switch. `target: "_top"` makes links inside it drive full navigations instead of swapping in-frame. The DOM node itself is carried over — scroll position, open sections, and all — so there's nothing to serialize or restore in JavaScript.

### Frames as page-assembly strategy

When a page composes several independently-heavy regions (a board with N columns, a dashboard with N widgets), don't render the heavy content in the initial response at all. Ship one *empty* frame per region, each naming its own content endpoint:

```erb
<%# Each column on a Fizzy board is an empty frame that fills itself %>
<%= turbo_frame_tag dom_id(column, :cards), src: board_column_path(column.board, column) %>
```

At the other end of that `src:` is an ordinary resourceful `GET` (`#show`) that renders the cards. The first response paints the skeleton instantly; each region's content arrives on its own request, in parallel. Same shape at widget scale — an assignee picker is an empty-src frame pointed at a `new_…` endpoint:

```erb
<%= turbo_frame_tag card, :assignment, src: new_card_assignment_path(card), loading: :lazy %>
```

A wall of these — one per column, one per deferrable widget — is the default page-assembly strategy, not a one-off. The frame *is* the client; the URL carries the contract. No "loading orchestration layer" gets built.

One caveat: frame navigation does not touch the browser URL or history. For a frame where the user's position is shareable state — a paginated list, a tab set — back, refresh, and share are silently broken unless you render the frame (or its links/forms) with `data-turbo-action="advance"` to promote frame navigations to full visits. Once promoted, rebuilding that URL-derived state (page 2, the active tab) on a hard refresh becomes *your* controller's job.

### Session expiry inside a frame: break out, don't error

`src:` frames live behind authentication, which — given the page-assembly strategy above — means every frame you ship. The failure semantics: if a frame request returns a response without a matching `<turbo-frame>`, Turbo writes a "Content missing" message into the frame and throws. The canonical trigger is an expired session — the frame's GET redirects to the login page, which contains no such frame. Declare the login page as requiring a full-page load:

```erb
<%# app/views/sessions/new.html.erb — turbo-rails helper; emits
    <meta name="turbo-visit-control" content="reload"> into the head %>
<% turbo_page_requires_reload %>
```

Now any response landing there breaks out of the frame as a real navigation. For handling a missing frame some other way, intercept `turbo:frame-missing`. The trap is diagnosing "Content missing" as a frame-id mismatch and wrapping the login page in matching frames — it's a navigation, not a region, and one meta tag declares it so for every frame at once.

### Eager-on-intent: prefetch by flipping one attribute

When a lazy frame's content should be ready *before* the click — a menu about to open, a dialog about to show — prefetch on *intent* by flipping `loading` to `eager` when the user signals (hover, dialog open):

```javascript
// Fired on mouseenter — every lazy frame inside the dialog starts loading now
loadLazyFrames() {
  Array.from(this.dialogTarget.querySelectorAll("turbo-frame")).forEach(frame => { frame.loading = "eager" })
}
```

What makes this safe to repeat is the Rails half: the endpoint computes a strong ETag from exactly the records it renders, so the hover request and the real click both hit the same URL and the second comes back `304 Not Modified`:

```ruby
def show
  fresh_when etag: [ @filters, @boards, @tags, @users, @accounts ]
end
```

The browser's HTTP cache plus the ETag *is* the prefetch cache — no JS cache, no debounce, no fetched-region tracking. Server side it's one `fresh_when` line.

### Edit-in-place: the frame-navigation mechanic

When a link targets a frame (`data: { turbo_frame: ... }`) and the response contains a frame with the **same id**, Turbo swaps only that region — so a row becomes its own editor in place, the controller's `edit` action is genuinely empty (`def edit; end`), and the form's redirect swaps the frame back to presentation. The id agreement carries all the weight. Full three-file pattern (display frame + link target + edit response, all deriving `dom_id(record, :edit)`): see `04-views-helpers.md` §5.

---

## Turbo Streams: HTML + action + target, over two transports

A stream is a fragment of HTML wrapped in an *action* aimed at a *target DOM id*: take this HTML and append it to the element with this id. The full verb set and semantics live in `15-hotwire-api-cheatsheet.md`; this file reasons about three — `append`, `replace`, `remove` — plus one distinction: `update` swaps only the target's *children* and keeps handlers on the target element alive, while `replace` swaps the element itself and forces any Stimulus controller on it to reconnect. When the target carries behavior, reach for `update`.

The load-bearing fact — the one that deletes whole subsystems — is that the identical stream travels over **two transports**:

1. **In-band**: as the HTTP response to a form submit (a `create.turbo_stream.erb` template).
2. **Out-of-band**: pushed over a WebSocket from the model via `broadcast_append_to`.

Same action, same target, same partial, byte-identical HTML. The HTTP reply and the live update are **one feature, not two**.

One boundary rule: a stream target is a **plain element with a `dom_id`** — never a `<turbo-frame>` added for the stream's sake. Frames contribute nothing to streams and change the behavior of every `<a>` and `<form>` they contain; introduce a frame only where you want scoped navigation or lazy loading.

### The full send-a-message wiring

A created record must appear on the creator's screen instantly and on every other open screen a half-second later. The complete wiring is four small pieces; none renders anything by hand.

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

One caveat the Campfire example elides: official doctrine is to design the flow to work *without* streams first, then layer them on — the canonical controller answers both formats (`format.turbo_stream` plus a `format.html { redirect_to ... }` fallback via `respond_to`), so native apps, dropped WebSockets, and stream-less clients still work. Campfire ships stream-only because its clients are guaranteed Turbo-capable; default to the fallback unless yours are.

The WebSocket broadcast — a plain method in a plain `Broadcasts` module:

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

That `turbo_stream_from` is the **entire** real-time wiring — no channel class, no event names, no payload schema, no socket handler. The view subscribes to `[@room, :messages]`; the model broadcasts to `[room, :messages]`; both resolve through the same signing/`dom_id` machinery, so they cannot spell the channel differently. The HTTP target `dom_id(@message.room, :messages)` and the broadcast target `[room, :messages]` resolve to the byte-identical string for the same reason. And `broadcast_append_to` defaults to rendering `messages/_message` — the same partial the page load used. **One renderer.**

The trap is rendering the message three ways — the partial for the page, a `render_to_string` (or a JSON blob) for the socket, an inline string for the HTTP reply — with hand-typed id strings like `"room_#{id}_messages"` in one place and `"msg-#{id}"` in another. The day you add a badge to the partial, the page shows it and the broadcast forgets it, and nothing errors — the live path silently drifts. Never type a DOM id as a string; always ask `dom_id(model)` or pass the `[model, :suffix]` array form on both sides of the wire.

### HTML over the wire: the trade

The wire carries HTML, not data. Rendered HTML is more bytes than a tiny JSON blob — that's the trade, made on purpose. You spend a few bytes to **delete a subsystem**: no serializer, no client-side templating, no payload contract kept in sync, no second renderer, no divergence bug class. If you find yourself designing a JSON shape for a live update, stop — the server already has a partial. Send *that*. (Full worldview: `00-frontend-first-principles.md`.)

### Broadcasting is an explicit method, not a callback

Keep broadcasting a plain method called explicitly at each call site (the controller's `create`, the webhook reply path) — no `included do`, no callback:

```ruby
# Called from MessagesController#create and from the bot-webhook reply path —
# and from NOWHERE else. A seed or an import never fires it.
module Message::Broadcasts
  def broadcast_create
    broadcast_append_to room, :messages, target: [ room, :messages ]
  end
end
```

The discriminating question: **whose fact is this?** A live browser broadcast is a property of *how* a message came into being (an interactive send), not of the message *existing*. Two consequences:

1. Seeds, imports, backfills create messages too — none should push to browsers. A callback would force a `skip_broadcast` flag onto every one of those paths; an explicit method needs nothing.
2. Create, update, and destroy need three *different* verbs (`append`, `replace`, `remove`). A single `after_create_commit :broadcast` can express only one.

Contrast the line one row below in the same model — which *is* a callback, because it's true of every message that exists:

```ruby
class Message < ApplicationRecord
  after_create_commit -> { room.receive(self) }   # marks members unread
end
```

Marking unread is a fact of the record; broadcasting is a fact of the call path. The general callback-vs-explicit-method rule ("whose fact is this?", the `_commit`/ghost-row discipline, the `skip_x`-flag smell) is owned by `02-models.md` §3; what's broadcast-specific is the two consequences above.

### The optimistic-id handshake: the de-dupe is deleted, not written

When the client paints a record optimistically (the instant the user hits Enter) and the authoritative copy then arrives over the wire — the classic duplicate-node problem — make the optimistic node and the authoritative broadcast *share an identity from the first keystroke* so Turbo's own semantics collapse them. Four pieces:

1. The client chooses a UUID and draws the placeholder with `id="message_<that-uuid>"`, sending the UUID in the form as `client_message_id`. (JS is background — a template node and a hidden field.)
2. The server persists the client's id, minting one only if absent:

```ruby
class Message < ApplicationRecord
  before_create -> { self.client_message_id ||= Random.uuid } # Bots don't care
end
```

The `||=` is the tell: a bot posting via the API has no optimistic bubble to reconcile, so it sends no id.

3. The model overrides what *identity means* — `to_key` is the ActiveModel method every Rails identity helper consults:

```ruby
class Message < ApplicationRecord
  def to_key
    [ client_message_id ]
  end
end
```

4. Now `dom_id(message)` yields `message_<the-uuid-the-client-already-chose>`, not a server-minted `message_472`. When `broadcast_append_to` ships the authoritative HTML, Turbo sees a node whose id already exists and its **append-with-existing-id semantics replace in place** instead of stacking a duplicate.

One overridden method bridges three layers — ActiveModel identity → `dom_id` → Turbo's id matching — and the reconciliation pass evaporates. The trap is writing that reconciliation by hand: a temp id, a find-and-swap, a race guard for when the broadcast beats the POST response, per-user "broadcast to everyone except the sender" channels — a documented source of duplicate-and-flicker bugs, every line of it existing only because the server invented a second identity after the insert.

### Edit and delete: same address, different verb

Because every row is addressed by `dom_id`, editing is a `replace` aimed at the same node and deleting is a `remove` — same machinery, different verb. The update action:

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

Read what is *not* there: no `if creator == current_user` branch. One action serves two audiences with zero conditionals. Spectators get the broadcast `replace` of the presentation node. The actor gets a plain redirect — and because their submit originated inside the edit frame, the response naturally swaps that frame back to presentation. Each audience's path is determined by *where their request originated*, not a runtime check. Destroy is symmetric: `broadcast_remove_to room, :messages`. (Fizzy reaches the same shape with `method: :morph` on the replace — that variant → `06-morphing-live-updates.md`.)

### Intent as data on the wire

When the client must behave differently for one kind of update — e.g. an edit must not yank scroll to the bottom the way a new message does — look at the update broadcast above: `attributes: { maintain_scroll: true }`. The server stamps *intent as data* — a plain attribute on the stream element — and client-side glue reads it. The model and controller never learn a UI exists; the transport stays generic (still just HTML at a target). The trap is forking a second, scroll-aware render path for edits — that's the two-renderer drift bug in a behavior costume. One renderer; nuance rides along as data, so you can rewrite client behavior without touching the model. (The Stimulus that honors the attribute → `07-stimulus-widgets.md`.)

### Wake-from-sleep catch-up is a diff, not a reload

When a client reconnects hours behind — laptop wake, tab restore, flaky network — ask "what changed since this client last saw the page?" and answer with a turbo_stream response that reuses the same verbs and the same partial:

```erb
<%# rooms/refreshes/show.turbo_stream.erb — the catch-up response %>
<%= turbo_stream.append dom_id(@room, :messages) do %>
  <%= render partial: "messages/message", collection: @new_messages, cached: true %>
<% end if @new_messages.any? %>

<% @updated_messages.each do |message| %>
  <%= turbo_stream.replace dom_id(message), partial: "messages/message", locals: { message: message } %>
<% end %>
```

The controller computes the diff — new messages since the timestamp, updated since the timestamp — with one guard: the updated set is scoped `.without(@new_messages)` so a brand-new message isn't counted as both. New rows are *appended* by the container's `dom_id`; edited rows are *replaced* by each row's `dom_id`. This is the fifth delivery path (first load, optimistic draw, HTTP reply, live broadcast, catch-up) routing through the one partial and one address — a path that *cannot* diverge from the other four has no "works only after refresh" bug. The trap is `window.onfocus = () => location.reload()`, which throws away scroll, in-progress composition, and every byte of state to fix "a few rows changed." (Turbo 8 reaches the same end via `broadcasts_refreshes` + morph — `06-morphing-live-updates.md`.)

---

## Uploads: one attachment line, one polymorphic blob partial

When records carry files — images, video, audio, PDFs, arbitrary binaries — the storage side is one declarative line:

```ruby
class Card < ApplicationRecord
  has_one_attached :image, dependent: :purge_later
end
```

That buys the blob, the storage indirection, the variants, and the URLs — no upload controller, no file-handling code, no MIME bookkeeping. The rendering side is the one-renderer move again: **one partial that asks the blob what it is**, instead of a controller branching on type:

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

The predicates — `blob.video?`, `blob.audio?`, `blob.variable?` (resizable), `blob.previewable?` (yields a preview image, e.g. a PDF's first page) — are ActiveStorage's. The partial asks the blob; the blob answers from its content type. And the *path* matters: `active_storage/blobs/web/_representation` is the conventional override location — Rails ships a default blob partial, and supplying your own at that exact name makes every attachment render your way, no framework surgery.

One production option: Fizzy processes image variants **immediately on attach** rather than lazily on first view:

```ruby
# Processed immediately on attachment to avoid read-replica issues
# (lazy variants would attempt writes on read replicas).
attachable.variant variant_name, **variant_options, process: :immediately
```

A lazily-generated variant writes the resized file the first time someone *reads* the page — and if a read replica serves that read, the write fails. `process: :immediately` moves the write to a moment a write is already happening.

---

## Red flags → fixes

| Red flag in the diff | The fix |
|---|---|
| `render_to_string` feeding `ActionCable.server.broadcast` | `broadcast_append_to` / `broadcast_replace_to` — one partial, both transports |
| A DOM id typed as a string (`"room_#{id}_messages"`) | `dom_id(model)` / `[model, :suffix]` on both sides |
| A channel class, event names, or JSON payload schema for live updates | `turbo_stream_from` + `broadcast_*_to`; the wire carries HTML |
| `after_create_commit :broadcast_create` (or a `skip_broadcast` flag) | broadcast as an explicit method at the call path; ask "whose fact is this?" |
| Temp-id reconciliation, "broadcast except sender," a de-dupe pass | client-chosen UUID + `to_key` override; the de-dupe is deleted |
| `if creator == current_user` branching actor vs spectator | broadcast `replace` to spectators, plain redirect to the actor — no branch |
| A second render path so edits behave differently on the client | one renderer; stamp intent as `attributes:` data on the broadcast |
| `window.onfocus = () => location.reload()` for catch-up | a turbo_stream diff: append new + replace updated by `dom_id`, `.without()` guard |
| All regions in one slow first response, or a JS fetch-and-stitch client | one empty `src:` frame per region; the frame is the client |
| A JavaScript prefetch cache for menus/dialogs | flip `loading = "eager"` on intent + `fresh_when` ETag |
| `render :new` (implicit 200) after a failed save | `render :new, status: :unprocessable_entity` — Drive won't render a 200 from a POST |
| A flash partial without `data-turbo-temporary` | mark it temporary, or it redisplays from the Drive cache on Back |
| "Content missing" in frames after idle | the login page needs `turbo_page_requires_reload` |
| A `<turbo-frame>` wrapped around a node only so a stream can target it | a plain element + `dom_id` |
| A paginated/tabbed frame whose URL never changes | `data-turbo-action="advance"` + rebuild URL-derived state on refresh |
| An uploads controller, MIME columns, per-type view branches | `has_one_attached` + the polymorphic blob partial at the override path |

---

## The composition

The pieces interlock into the full real-time arc:

- `dom_id` everywhere (never a typed id string) gives every node one address —
- so the page render, the `create.turbo_stream.erb` reply, and `broadcast_append_to` all target the same node through the same partial (**one renderer**) —
- while `turbo_stream_from` + the `[model, :suffix]` array form make subscription and broadcast spell the channel identically by construction —
- and the `to_key` override extends that single identity to the client's optimistic placeholder, so Turbo's replace-on-existing-id deletes the de-dupe —
- and because the address never changes, edit and delete are just different verbs (`replace`, `remove`) at the same address, catch-up is those verbs replayed in bulk, and client nuance rides along as `attributes:` data.

Five delivery moments — first load, optimistic draw, HTTP reply, live broadcast, wake-from-sleep catch-up — one partial, one address, zero glue. When the update is "this whole page is stale, re-render and reconcile," climb to Turbo 8 morphing: `06-morphing-live-updates.md`.