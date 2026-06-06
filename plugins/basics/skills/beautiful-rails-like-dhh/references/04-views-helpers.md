# Views, Partials & Helpers — One Renderer, One Address

Read this when you are writing or reviewing anything in `app/views` or `app/helpers` — templates, partials, layouts, helper methods, or any code that names a DOM element another piece of code will later target.

**Contents**

1. [The root bug: two things kept in sync by hand](#1-the-root-bug-two-things-kept-in-sync-by-hand)
2. [One partial, every path](#2-one-partial-every-path)
3. [dom_id is the address](#3-dom_id-is-the-address)
4. [Collection rendering: the loop you stop writing](#4-collection-rendering-the-loop-you-stop-writing)
5. [Edit-in-place: three files agree, the controller does nothing](#5-edit-in-place-three-files-agree-the-controller-does-nothing)
6. [The honest exception: when two copies are unavoidable](#6-the-honest-exception-when-two-copies-are-unavoidable)
7. [Helpers: give the view a domain vocabulary](#7-helpers-give-the-view-a-domain-vocabulary)
8. [Layout regions: content_for and yield](#8-layout-regions-content_for-and-yield)
9. [CSS state from data, not ERB branching](#9-css-state-from-data-not-erb-branching)
10. [Additive decorator helpers (preview)](#10-additive-decorator-helpers-preview)
11. [Red flags → fixes](#11-red-flags--fixes)
12. [Scope boundaries](#12-scope-boundaries)

---

## 1. The root bug: two things kept in sync by hand

Every view-layer disaster in a Hotwire app reduces to one shape: **two things you must keep equal by hand, in files that don't know about each other.** Two copies of the same markup. Two hand-typed id strings that must match. Both fail the same way: silently. A drifted id throws no exception — the stream append just quietly matches nothing. A drifted markup copy throws no exception — the badge you added shows on page reload but not on the live message, and nothing errors.

This is what the naive first draft looks like — and you will produce it, because each file looks fine in isolation:

```erb
<%# rooms/show.html.erb — the page, ids and markup typed by hand %>
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
<%# create.turbo_stream.erb — the live path: a SECOND copy of the same markup %>
<%= turbo_stream.append "room_#{@message.room.id}_messages" do %>
  <div id="message_<%= @message.id %>" class="message">  <%# ...was it "msg-" or "message_"? %>
    <strong><%= @message.creator.name %></strong>
    <%= @message.body %>
  </div>
<% end %>
```

Three latent bugs, zero errors: the container id is typed in two files (rename one, forget the other); the row id is `msg-#{id}` in one place and `message_#{id}` in the other (they *already* disagree, and the edit/replace path will silently match nothing); and the row markup exists twice (every future change must be made twice, forever).

**Do not fix this with discipline.** Human vigilance is not a synchronization mechanism — you signed up to be careful forever, across files that don't reference each other, and you will eventually have a bad day. The fix is structural: make both the markup and the id **computed in one place** instead of typed in two. Delete the second copy; the drift becomes unwriteable. That is what convention buys: not "less typing," but "two sides of a seam that *cannot* desync, because both ask the framework the same question." Rails stays small because each layer trusts a convention at its boundary — and the view layer's two conventions are the shared partial and `dom_id`.

The rest of this file is those two conventions and their consequences.

---

## 2. One partial, every path

**When:** the same record has to render in more than one moment — first page load, a standalone index, a live broadcast append, a wake-from-sleep refresh catch-up, an edit swap. In a Hotwire app this is not an edge case; it is *every* record the UI shows.

**Do:** write exactly one partial per renderable noun (`messages/_message.html.erb`) and point every path at it. Both of Campfire's entry points render the message list with the *identical* line:

```erb
<%# rooms/show.html.erb AND messages/index.html.erb — the same line (Campfire) %>
<%= render partial: "messages/message", collection: @messages, cached: true %>
```

The HTTP turbo_stream response renders `messages/_message`. The WebSocket broadcast renders `messages/_message`. The refresh catch-up renders `messages/_message`. There is no `show`-specific message markup and no `index`-specific message markup — there is `messages/_message`, and that is **the only file that knows what a message looks like.** This is **one renderer**: the server renders the fragment once, and every transport carries that same HTML — **the wire carries HTML, not data** (transport mechanics in `05-turbo-frames-streams.md`).

The shorthand form resolves by convention: `render @messages` infers the partial path from the model name (`Message` → `messages/_message`) and names the local after the partial (`message`); `render message` does the same for a single record. Use the shorthand when you can; use the explicit `partial:`/`collection:` form when you need `cached: true` (§4).

**Not:** you will be tempted to inline the row markup in the show view "just for now," then re-type it in the broadcast template because sharing felt like overhead. Don't. The render count is identical either way; the partial boundary costs nothing. What the second copy costs is every future change made twice — and the day one copy gets the change and the other doesn't, half your screens show it and half don't, with no exception anywhere.

**Why:** one file to change, zero copies to drift. Count the edge cases this line absorbs for free: the page, the index, the live append, the refresh, and the edit swap all stay pixel-identical through every future markup change, because there is no second template to forget.

---

## 3. dom_id is the address

**When:** any element that any other code — a turbo_stream, a broadcast, a frame, a link target, a CSS hook — will ever need to find.

**Do:** never type the id; compute it. `dom_id(record)` derives a stable, collision-free DOM id from the record; `dom_id(record, :prefix)` prefixes it. **dom_id is the address.**

| Call | Returns | Use for |
|---|---|---|
| `dom_id(message)` | `"message_47"` | the row — the record's own element |
| `dom_id(room, :messages)` | `"messages_room_5"` | the container — a parent's named region |
| `dom_id(message, :edit)` | `"edit_message_47"` | a secondary surface of the record (its edit frame) |
| `dom_id(Message.new)` | `"new_message"` | the new-record form/slot |

Container vs row is the load-bearing distinction: the *container* is addressed off the **parent** with a purpose prefix (`dom_id(room, :messages)` — "the messages region of this room"), the *row* is addressed off the **record itself** (`dom_id(message)`). Streams append to the container address and replace/remove at the row address.

The point is not brevity — it is *where the knowledge lives*. When the view writes `id: dom_id(message)` and a later operation targets `dom_id(message)`, neither side typed a string. Both **asked the same function the same question about the same record** — so they cannot disagree, because there is no second copy to drift from the first. Rename the convention and both sides change together. Across Campfire's five operations on a message — append on first load, append on live broadcast, append on refresh, replace on edit, remove on delete — **not one path types an id string.** The mismatch bug from §1 is not avoided by care; it is unwriteable.

This is doctrine, not a Campfire habit: Fizzy, an unrelated Kanban product, addresses its message container as `dom_id(card, :messages)` and every card row as `dom_id(card, :article)` — and then reuses that same computed value as the CSS `view-transition-name`, so even the animation hook cannot drift from the element's address. Two products, zero shared code, same function naming the node.

**Not:** you will be tempted to write `id="message_#{message.id}"` because it produces the same string today. Don't. The string is not the point — the single source is. A hand-typed `"message_#{id}"` is a second copy of the convention, and second copies drift. Also don't have a controller compute a `@target_id` string and thread it through templates — that's the same bug wearing a routing costume.

**Why:** `dom_id` absorbs every id-drift typo across every render path, forever, for the cost of a function call. **Derive, don't store** applied to identity: the id is derived from the record, never copied between files.

---

## 4. Collection rendering: the loop you stop writing

**When:** a view draws every element of a collection.

**Do:**

```erb
<%= render partial: "messages/message", collection: @messages, cached: true %>
```

One line: renders `_message` once per element, automatically assigns each element to a local named after the partial (`message`), no loop, no hand-named local per iteration.

**Not:** you will be tempted to write the loop —

```erb
<% @messages.each do |message| %>
  <%= render "messages/message", message: message %>
<% end %>
```

— because it's the form you already know. Don't. It works, but it forecloses the payoff below.

**Why:** beyond brevity, the single render call over a known collection is **the seam that makes batched caching possible at all.** Add `cached: true` and Rails collapses N separate fragment-cache lookups into one batched `read_multi`. The hand-written loop has no such seam — N renders means N lookups, and there's nowhere to hang the batch. (Fragment-cache mechanics — keys, `touch:`, russian-doll nesting — are owned by `09-caching-performance.md`; your job in the view is only to use the collection form so the seam exists.)

---

## 5. Edit-in-place: three files agree, the controller does nothing

**When:** a row should turn into its own editor in place — no page navigation, no hand-wired swap.

**Do:** make three files derive the same frame id from `dom_id(message, :edit)`. The row wraps its editable region in a Turbo Frame; the Edit link declares that frame as its target; the edit response wraps its form in a frame with the matching id (Campfire):

```erb
<%# messages/_message.html.erb — the frame the row's body lives in %>
<turbo-frame id="<%= dom_id(message, :edit) %>">
  ...message body...
</turbo-frame>

<%# messages/_actions.html.erb — the Edit link targets that exact frame %>
<%= link_to edit_room_message_path(message.room, message),
      data: { turbo_frame: dom_id(message, :edit) } %>

<%# messages/edit.html.erb — the response fills that frame %>
<turbo-frame id="<%= dom_id(@message, :edit) %>">
  <%= form_with model: [@message.room, @message] do |form| %>...<% end %>
</turbo-frame>
```

When the link loads the edit response, Turbo sees a frame whose id matches a frame already on the page and swaps that region in place. Because the id agreement carries all the weight, the controller action is, in full (Campfire):

```ruby
def edit
end
```

Empty — and not as laziness. An action named `edit` with no explicit `render` renders `edit.html.erb` by convention (implicit render-by-action-name); that template's outermost frame id already says where the result lands. The empty body is the visible proof that the convention *is* the behavior. Fizzy edits a card identically: the Edit link targets `dom_id(card, :edit)`, the response wraps itself in the matching frame, the swap falls out. Same trick, different noun — house style, not chat-app trivia.

**Not:** you will be tempted to write a controller that computes a target id, or JavaScript that finds the row and swaps in a form, or a full-page redirect to an edit screen. Don't. All three re-create the hand-synced-strings bug or rebuild what the frame convention already does.

**Why:** three files, one address, all derived, never typed — drift is unwriteable, and the entire interaction costs zero custom JavaScript and zero controller logic. (Frame navigation mechanics belong to `05-turbo-frames-streams.md`; what you own here is the *id agreement across the three view files*.)

---

## 6. The honest exception: when two copies are unavoidable

**When:** a second copy of markup genuinely cannot be collapsed into the partial. The canonical case (Campfire): the optimistic placeholder the sender's browser draws *before* the server round-trip. It's a static client-side template — it cannot run ERB against a record the server hasn't seen yet — so its markup is necessarily a second copy of the row.

**Do:** make the coupling **loud**. Put a twin-pointer comment at the top of **both** files, each naming the other:

```erb
<%# messages/_message.html.erb, line 1 %>
<%# Be sure to check/update messages/_template.html.erb when changing this file %>
```

```erb
<%# messages/_template.html.erb, line 1 %>
<%# Static optimistic twin of messages/_message.html.erb — keep markup in sync %>
```

And even where the machine can't share the markup, still share the *address convention*: Campfire's placeholder hard-codes `id="message_$clientMessageId$"` — the exact shape `dom_id` produces server-side — so the optimistic node and the authoritative broadcast speak the same id grammar. (The full optimistic-id handshake — `to_key` teaching `dom_id` to speak the client's UUID so the broadcast *replaces* the placeholder instead of duplicating it — is transport doctrine, owned by `05-turbo-frames-streams.md`.)

**Not:** you will be tempted to quietly leave the two copies and trust yourself to remember, or to bury the relationship in a commit message. Don't. The next editor (including the next you) will change one file without knowing the twin exists.

**Why:** convention deletes hand-syncing everywhere a function can compute the shared thing; where one can't, the next best move is making the seam impossible to miss. The discipline budget is spent on exactly the one spot convention can't reach — and nowhere else.

---

## 7. Helpers: give the view a domain vocabulary

**When:** a `tag.div` with its `dom_id` call and a fistful of data attributes is about to appear in a template — especially if a second template will ever need the same element.

**Do:** wrap it in a helper named in the *domain's* words, so templates read as sentences. Campfire's message container and row (adapted):

```ruby
# app/helpers/messages_helper.rb (Campfire)
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
  message_timestamp_milliseconds = message.created_at.to_fs(:epoch)

  tag.div id: dom_id(message),
    class: "message #{"message--emoji" if message.plain_text_body.all_emoji?}",
    data: {
      controller: "reply",
      user_id: message.creator_id,
      message_id: message.id,
      message_timestamp: message_timestamp_milliseconds,
      sort_value: message_timestamp_milliseconds,
      messages_target: "message",
      refresh_room_target: "message"
    }, &
rescue Exception => e
  Rails.logger.error "Exception while rendering message #{message.class.name}##{message.id}: #{e.class} `#{e.message}`"
  render "messages/unrenderable"
end
```

Now the template says `messages_tag(@room) do ... end` instead of inlining an eight-attribute `tag.div`. The container's address (`dom_id(room, :messages)`), the row's address (`dom_id(message)`), and all the data wiring live in **one method each** — and note the division of labor: the helper owns the container, the partial owns the row, each derives its own id from `dom_id`, and neither re-decides the other's markup. There is no third place where they could disagree. (Bonus pattern in `message_tag`: a per-row `rescue` that renders an `unrenderable` fallback, so one corrupt record degrades one row instead of 500ing the page.)

Fizzy reaches for the identical move in an unrelated product — `card_article_tag` wraps a `tag.article` with its `dom_id(card, :article)` id, its state classes, and its data attributes, and reuses the same `dom_id` value as the CSS `view-transition-name` (adapted):

```ruby
# app/helpers/cards_helper.rb (Fizzy, adapted)
def card_article_tag(card, **options, &)
  tag.article id: dom_id(card, :article),
    class: [ "card", ("card--postponed" if card.postponed?), ("card--active" if card.active?) ],
    style: "view-transition-name: #{dom_id(card, :article)}",
    data: { controller: "card", card_url_value: card_path(card) }, &
end
```

A board template says `card_article_tag(card) do ... end`. Two products, same instinct: **markup that's about to be shared gets a named home** — the same reason `_message` is a partial, one altitude up. The helper layer's job is a *domain vocabulary* (`messages_tag`, `message_tag`, `card_article_tag`, `message_timestamp`) so logic stays out of the ERB.

**Not:** you will be tempted to put the three-line `tag.div` straight in the ERB because a helper "for one div" feels like ceremony. Don't — the moment a second template needs that div (the page *and* the broadcast), you'll copy it, and you're back to the two-copies bug of §1. You will also be tempted by presenter/decorator *objects* (Draper-style). Don't — plain helper methods are the house style; no wrapper classes.

**Why:** the id computation and data wiring exist exactly once; the template reads in domain words; and every future caller gets the element right by construction instead of by copying.

---

## 8. Layout regions: content_for and yield

**When:** a view computes a piece of UI that belongs somewhere *else* on the page — a sidebar, a header slot, a toolbar the layout owns.

**Do:** stash it into a named region and let the layout place it. Campfire's room view injects the sidebar from inside `rooms/show.html.erb`:

```erb
<% content_for :sidebar, sidebar_turbo_frame_tag(src: user_sidebar_path) %>
```

The layout `yield`s `:sidebar` wherever the sidebar physically renders. The line that *decides* the sidebar is not the line that *paints* it — note it composes with §7: `sidebar_turbo_frame_tag` is a helper returning a tag, and the layout region renders whatever it's handed.

**Not:** you will be tempted to contort the template's structure — or the layout's — so the content sits in physical position, or to push page-specific UI decisions up into the layout with conditionals. Don't. The layout owns *where* regions render; views own *what* fills them.

**Why:** views stay about their own resource; the layout stays generic; page-specific slots cost one `content_for` line.

---

## 9. CSS state from data, not ERB branching

**When:** an element's appearance varies with a boolean state (unread, active, postponed, selected).

**Do:** drive a CSS class from data using the array form of `class:`, with the boolean passed in as a local. Campfire's sidebar room link (adapted):

```erb
<%# users/sidebars/rooms/_shared.html.erb — "unread" is a passed-in local %>
<%= link_to room_path(room),
      class: [ "align-center gap room btn txt-nowrap", "unread": local_assigns[:unread] ] do %>
  ...
<% end %>
```

The array form includes the `"unread"` class only when `local_assigns[:unread]` is truthy. Whoever renders the partial decides the state and passes it as a local; the partial just reflects it. (`local_assigns` is the right accessor for *optional* locals — it returns `nil` for an unpassed local instead of raising.) The styling itself lives in CSS against the class.

**Not:** you will be tempted to write `<% if unread %>...one copy of the markup...<% else %>...another copy...<% end %>`, or to interpolate style decisions into the template. Don't — a branch wrapping markup is two copies of the markup (§1 again), and logic in ERB is logic you read twice.

**Why:** one copy of the markup, state expressed as one class token, styling owned by the stylesheet. This is the static half of "the DOM attribute IS the state" — the live half, where Stimulus reads and writes those attributes, is owned by `07-stimulus-widgets.md`; morphing's contract that state must live in attributes to survive a morph is `06-morphing-live-updates.md`.

---

## 10. Additive decorator helpers (preview)

**When:** many forms or elements need the same behavior bolted on (auto-submit on change, a shared controller) without forking the markup or re-typing wiring at every call site.

**Do:** wrap the framework helper in a decorator that **merges** its additions into the caller's options instead of clobbering them (Fizzy, adapted):

```ruby
# app/helpers/forms_helper.rb (Fizzy, adapted)
def auto_submit_form_with(**options, &)
  options[:data] = (options[:data] || {}).merge(
    controller: "#{options.dig(:data, :controller)} auto-submit".squish
  )
  form_with(**options, &)
end
```

A template calls `auto_submit_form_with(model: filter)` exactly like `form_with` — and a caller that already carries its own `data: { controller: "..." }` keeps it, because the decorator *appends* to the controller list rather than overwriting it. Additive, not destructive: the decorator composes with whatever the call site brings.

**Not:** you will be tempted to write `options[:data] = { controller: "auto-submit" }` — a silent clobber that strips every caller-supplied data attribute — or to copy the `data:` wiring into every `form_with` call by hand. Don't.

**Why:** one method is the single home for the behavior's wiring (§7's instinct applied to forms), and the merge discipline means adopting the decorator never breaks an existing call site. Full treatment — the decorator family and the Stimulus side of `auto-submit` — is owned by `07-stimulus-widgets.md`.

---

## 11. Red flags → fixes

| Red flag in a diff | Fix |
|---|---|
| `id="message_<%= message.id %>"` or any hand-built id string | `id: dom_id(message)` — computed, never typed |
| Same id string typed in a template *and* a stream/operation | Both sides call `dom_id(record[, :prefix])` |
| Row markup in `show.html.erb` *and again* in a turbo_stream/broadcast template | One partial (`_message`); every path renders it |
| `<% @records.each do %><%= render ... %><% end %>` | `render partial: "...", collection: @records` (or `render @records`) — and only the explicit form takes `cached: true` |
| Controller computes a `@target_id`/`@frame_id` and threads it through templates | All files derive the id: `dom_id(record, :edit)` etc. |
| Edit action that builds state or picks targets for an in-place swap | Frame-id agreement across row/link/response; `def edit; end` |
| Two unavoidable markup copies with no marker | Twin-pointer comment at the top of **both** files |
| Multi-attribute `tag.div`/`tag.article` inlined in ERB (or about to be copied to a second template) | Domain-vocabulary helper (`messages_tag`, `card_article_tag`) |
| Page-specific UI hacked into the layout, or a view contorted to position shared chrome | `content_for :region` in the view, `yield :region` in the layout |
| `<% if state %>` / `<% else %>` wrapping near-duplicate markup | `class: [ "base", "state-class": local_assigns[:flag] ]` |
| Decorator helper that assigns `options[:data] = {...}` outright | Merge into the caller's options; append to `controller:` lists |
| Presenter/decorator *classes* wrapping models for the view | Plain helper methods — the house style has no view-model layer |

---

## 12. Scope boundaries

You own what lives in `app/views` and `app/helpers`: the partial-per-noun rule, `dom_id` addressing, collection rendering, the edit-in-place id agreement, layout regions, class-from-data, and helper vocabulary. Adjacent doctrine lives elsewhere:

- **Turbo transport** — streams, broadcasts, frames as navigation, the optimistic-id/`to_key` handshake: `05-turbo-frames-streams.md`
- **Morphing & live refresh** — `broadcasts_refreshes`, morph-safe markup: `06-morphing-live-updates.md`
- **Stimulus wiring** — controllers, targets, values, outlets, the `auto-submit` controller itself: `07-stimulus-widgets.md`
- **Fragment caching mechanics** — keys from `updated_at`, `touch:`, russian-doll nesting, what `cached: true` does under the hood: `09-caching-performance.md`

The composition to keep in your head: the **partial** is the single renderer, **`dom_id`** is the single address, and together they are why a live feature is a handful of declarative lines instead of a payload schema and a reconciliation pass. One renderer needs one address to aim at — neither works without the other.
