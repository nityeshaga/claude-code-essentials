# Views, Partials & Helpers — One Renderer, One Address

Read when writing or reviewing anything in `app/views` or `app/helpers` — templates, partials, layouts, helpers, or any code that names a DOM element another piece of code will later target.

Two conventions carry this whole file: the **shared partial** (one renderer) and **`dom_id`** (one address). Everything else is their consequences.

---

## 1. The root bug: two things synced by hand

Every view-layer disaster reduces to one shape: **two things you must keep equal by hand, in files that don't know about each other** — two copies of markup, or two hand-typed id strings that must match. Both fail silently. A drifted id throws no exception; the stream append just matches nothing. A drifted markup copy shows on reload but not on the live element, and nothing errors.

The naive first draft — each file looks fine in isolation:

```erb
<%# rooms/show.html.erb — ids and markup typed by hand %>
<div id="room_<%= @room.id %>_messages">
  <% @messages.each do |message| %>
    <div id="msg-<%= message.id %>" class="message">
      <strong><%= message.creator.name %></strong>
      <%= message.body %>
    </div>
  <% end %>
</div>
```

```erb
<%# create.turbo_stream.erb — a SECOND copy of the same markup %>
<%= turbo_stream.append "room_#{@message.room.id}_messages" do %>
  <div id="message_<%= @message.id %>" class="message">  <%# "msg-" or "message_"? %>
    <strong><%= @message.creator.name %></strong>
    <%= @message.body %>
  </div>
<% end %>
```

Three latent bugs, zero errors: the container id is typed in two files; the row id is `msg-#{id}` here and `message_#{id}` there (already disagreeing — the edit/replace path silently matches nothing); and the row markup exists twice, so every future change must be made twice.

The fix is not discipline — it's structure. Make the markup and the id **computed in one place** instead of typed in two; the drift becomes unwriteable. Both sides of the seam ask the framework the same question, so they cannot desync.

---

## 2. One partial, every path

**When:** the same record renders in more than one moment — first load, index, live append, refresh catch-up, edit swap. In a Hotwire app that's *every* record.

Write exactly one partial per renderable noun (`messages/_message.html.erb`) and point every path at it. Both Campfire entry points render the list with the identical line:

```erb
<%# rooms/show.html.erb AND messages/index.html.erb (Campfire) %>
<%= render partial: "messages/message", collection: @messages, cached: true %>
```

The turbo_stream response, the broadcast, and the refresh catch-up all render `messages/_message` — **the only file that knows what a message looks like.** This is **one renderer**: the fragment is rendered once and every transport carries that same HTML — the wire carries HTML, not data (transport in `05-turbo-frames-streams.md`).

Shorthand resolves by convention: `render @messages` infers the partial from the model name and names the local after it; `render message` does the same for one record. Use shorthand when you can; use explicit `partial:`/`collection:` when you need `cached: true` (§4).

The second copy costs every future change made twice — and the day one copy gets it and the other doesn't, half your screens drift with no exception anywhere.

---

## 3. dom_id is the address

**When:** any element another piece of code — a stream, broadcast, frame, link target, CSS hook — will ever need to find.

Never type the id; compute it. **dom_id is the address.**

| Call | Returns | Use for |
|---|---|---|
| `dom_id(message)` | `"message_47"` | the row — the record's own element |
| `dom_id(room, :messages)` | `"messages_room_5"` | the container — a parent's named region |
| `dom_id(message, :edit)` | `"edit_message_47"` | a secondary surface (its edit frame) |
| `dom_id(Message.new)` | `"new_message"` | the new-record form/slot |

Container vs row is load-bearing: the *container* is addressed off the **parent** with a purpose prefix (`dom_id(room, :messages)`), the *row* off the **record itself** (`dom_id(message)`). Streams append to the container, replace/remove at the row.

When the view writes `id: dom_id(message)` and a later operation targets `dom_id(message)`, both asked the same function about the same record — no second copy to drift. Across Campfire's five operations on a message (append on load, append on broadcast, append on refresh, replace on edit, remove on delete), not one path types an id string.

**Not:** `id="message_#{message.id}"` produces the same string today but is a second copy of the convention, and second copies drift. Don't thread a controller-computed `@target_id` through templates either — same bug in a routing costume.

---

## 4. Collection rendering: the loop you stop writing

**When:** a view draws every element of a collection.

```erb
<%= render partial: "messages/message", collection: @messages, cached: true %>
```

Renders `_message` once per element, assigns each to a local named after the partial — no loop. Avoid the hand-written `<% @messages.each do %>` form: beyond brevity, the single render call over a known collection is **the seam that makes batched caching possible.** `cached: true` collapses N fragment-cache lookups into one batched `read_multi`; the loop has nowhere to hang the batch. (Cache mechanics — keys, `touch:`, nesting — in `09-caching-performance.md`.)

---

## 5. Edit-in-place: three files agree, the controller does nothing

**When:** a row should turn into its own editor in place — no navigation, no hand-wired swap.

Make three files derive the same frame id from `dom_id(message, :edit)`: the row wraps its editable region in a frame, the Edit link targets that frame, the edit response wraps its form in the matching frame (Campfire):

```erb
<%# messages/_message.html.erb %>
<turbo-frame id="<%= dom_id(message, :edit) %>">...message body...</turbo-frame>

<%# messages/_actions.html.erb — Edit link targets that frame %>
<%= link_to edit_room_message_path(message.room, message),
      data: { turbo_frame: dom_id(message, :edit) } %>

<%# messages/edit.html.erb — response fills that frame %>
<turbo-frame id="<%= dom_id(@message, :edit) %>">
  <%= form_with model: [@message.room, @message] do |form| %>...<% end %>
</turbo-frame>
```

Turbo sees a frame whose id matches one already on the page and swaps it in place. Because the id agreement carries the weight, the controller action is, in full:

```ruby
def edit
end
```

Empty by convention, not laziness: `edit` with no explicit render renders `edit.html.erb`, whose outermost frame id already says where the result lands.

**Not:** a controller that computes a target id, JS that finds the row and swaps, or a full-page redirect — all re-create the hand-synced-strings bug or rebuild what the frame convention already does. (Frame navigation mechanics: `05-turbo-frames-streams.md`.)

---

## 6. The honest exception: when two copies are unavoidable

**When:** a second markup copy genuinely can't collapse into the partial. Canonical case (Campfire): the optimistic placeholder the sender's browser draws *before* the server round-trip — a static client-side template that can't run ERB against a record the server hasn't seen.

Make the coupling **loud** — a twin-pointer comment at the top of **both** files, each naming the other:

```erb
<%# messages/_message.html.erb %>
<%# Be sure to check/update messages/_template.html.erb when changing this file %>
```
```erb
<%# messages/_template.html.erb %>
<%# Static optimistic twin of messages/_message.html.erb — keep markup in sync %>
```

Even where markup can't be shared, share the *address convention*: the placeholder hard-codes `id="message_$clientMessageId$"` — the exact shape `dom_id` produces — so the optimistic node and the broadcast speak the same id grammar. (The full optimistic-id/`to_key` handshake is transport doctrine: `05-turbo-frames-streams.md`.)

The discipline budget is spent on exactly the one spot convention can't reach, and nowhere else.

---

## 7. Helpers: give the view a domain vocabulary

**When:** a `tag.div` with its `dom_id` and a fistful of data attributes is about to appear in a template — especially if a second template will need the same element.

Wrap it in a helper named in the *domain's* words, so templates read as sentences (Campfire, adapted):

```ruby
# app/helpers/messages_helper.rb
def messages_tag(room, &)
  tag.div id: dom_id(room, :messages), class: "messages", data: {
    controller: "maintain-scroll refresh-room",
    action: [ maintain_scroll_actions, refresh_room_actions ].join(" "),
    messages_target: "messages",
    refresh_room_loaded_at_value: room.updated_at.to_fs(:epoch),
    refresh_room_url_value: room_refresh_url(room)
  }, &
end

def message_tag(message, &)
  tag.div id: dom_id(message),
    class: "message #{"message--emoji" if message.plain_text_body.all_emoji?}",
    data: {
      controller: "reply", user_id: message.creator_id, message_id: message.id,
      messages_target: "message", refresh_room_target: "message"
    }, &
rescue Exception => e
  Rails.logger.error "Exception rendering message ##{message.id}: #{e.message}"
  render "messages/unrenderable"
end
```

The template now says `messages_tag(@room) do ... end`. Division of labor: the helper owns the container, the partial owns the row, each derives its own id from `dom_id`, no third place to disagree. (Bonus: the per-row `rescue` renders an `unrenderable` fallback so one corrupt record degrades one row instead of 500ing the page.)

Fizzy reaches for the same move — `card_article_tag` even reuses the `dom_id` value as the CSS `view-transition-name`, so the animation hook can't drift from the address:

```ruby
def card_article_tag(card, **options, &)
  tag.article id: dom_id(card, :article),
    class: [ "card", ("card--postponed" if card.postponed?), ("card--active" if card.active?) ],
    style: "view-transition-name: #{dom_id(card, :article)}",
    data: { controller: "card", card_url_value: card_path(card) }, &
end
```

**Not:** inlining the `tag.div` in ERB — the moment a second template needs it you copy it, back to §1. And no presenter/decorator *classes* (Draper-style) — plain helper methods are the house style.

---

## 8. Layout regions: content_for and yield

**When:** a view computes UI that belongs somewhere *else* on the page — sidebar, header slot, toolbar the layout owns.

Stash it into a named region; let the layout place it (Campfire):

```erb
<% content_for :sidebar, sidebar_turbo_frame_tag(src: user_sidebar_path) %>
```

The layout `yield`s `:sidebar` where it physically renders. The line that *decides* the sidebar isn't the line that *paints* it. The layout owns *where* regions render; views own *what* fills them — don't push page-specific UI up into the layout with conditionals.

---

## 9. CSS state from data, not ERB branching

**When:** an element's appearance varies with a boolean (unread, active, postponed, selected).

Drive a CSS class from data with the array form of `class:`, the boolean passed in as a local (Campfire, adapted):

```erb
<%= link_to room_path(room),
      class: [ "align-center gap room btn txt-nowrap", "unread": local_assigns[:unread] ] do %>
  ...
<% end %>
```

The class is included only when the local is truthy. Whoever renders the partial decides the state; the partial reflects it. (`local_assigns` returns `nil` for an unpassed *optional* local instead of raising.) Styling lives in CSS against the class.

**Not:** `<% if unread %>...<% else %>...<% end %>` wrapping near-duplicate markup is two copies (§1 again). This is the static half of "the DOM attribute IS the state" — the live half (Stimulus reading/writing attributes) is `07-stimulus-widgets.md`; the morph contract is `06-morphing-live-updates.md`.

---

## 10. Additive decorator helpers (preview)

**When:** many forms need the same behavior bolted on (auto-submit, a shared controller) without forking markup or re-typing wiring per call site.

Wrap the framework helper in a decorator that **merges** into the caller's options instead of clobbering (Fizzy, adapted):

```ruby
def auto_submit_form_with(**options, &)
  options[:data] = (options[:data] || {}).merge(
    controller: "#{options.dig(:data, :controller)} auto-submit".squish
  )
  form_with(**options, &)
end
```

A caller carrying its own `data: { controller: "..." }` keeps it, because the decorator *appends*. **Not:** `options[:data] = { controller: "auto-submit" }` silently clobbers every caller-supplied data attribute. (Full decorator family + the Stimulus side of `auto-submit`: `07-stimulus-widgets.md`.)

---

## 11. Red flags → fixes

| Red flag in a diff | Fix |
|---|---|
| `id="message_<%= message.id %>"` or any hand-built id string | `id: dom_id(message)` — computed, never typed |
| Same id string typed in a template *and* a stream/operation | Both sides call `dom_id(record[, :prefix])` |
| Row markup in `show.html.erb` *and again* in a stream/broadcast | One partial (`_message`); every path renders it |
| `<% @records.each do %><%= render ... %><% end %>` | `render partial: "...", collection: @records` (only this form takes `cached: true`) |
| Controller computes a `@target_id`/`@frame_id` threaded through templates | All files derive the id: `dom_id(record, :edit)` |
| Edit action that builds state or picks targets for an in-place swap | Frame-id agreement across row/link/response; `def edit; end` |
| Two unavoidable markup copies with no marker | Twin-pointer comment atop **both** files |
| Multi-attribute `tag.div`/`tag.article` inlined in ERB | Domain-vocabulary helper (`messages_tag`, `card_article_tag`) |
| Page-specific UI hacked into the layout | `content_for :region` in the view, `yield :region` in the layout |
| `<% if state %>`/`<% else %>` wrapping near-duplicate markup | `class: [ "base", "state-class": local_assigns[:flag] ]` |
| Decorator helper that assigns `options[:data] = {...}` outright | Merge into caller's options; append to `controller:` lists |
| Presenter/decorator *classes* wrapping models | Plain helper methods — no view-model layer |

---

## 12. Scope boundaries

You own `app/views` and `app/helpers`: partial-per-noun, `dom_id` addressing, collection rendering, edit-in-place id agreement, layout regions, class-from-data, helper vocabulary. Adjacent doctrine:

- **Turbo transport** — streams, broadcasts, frames-as-navigation, the optimistic-id/`to_key` handshake: `05-turbo-frames-streams.md`
- **Morphing & live refresh** — `broadcasts_refreshes`, morph-safe markup: `06-morphing-live-updates.md`
- **Stimulus wiring** — controllers, targets, values, outlets, `auto-submit`: `07-stimulus-widgets.md`
- **Fragment caching** — keys, `touch:`, russian-doll nesting, what `cached: true` does: `09-caching-performance.md`

The **partial** is the single renderer, **`dom_id`** is the single address — together they're why a live feature is a handful of declarative lines instead of a payload schema and a reconciliation pass.