# Turbo 8 Morphing & Live Multiplayer

Read this when a page must stay live across multiple browsers, when you're about to write a broadcast call, when you're adding drag-and-drop or any optimistic UI, or when you're about to add a `position` column.

**Contents**

1. [Refresh, don't replace — kill the broadcast matrix](#1-refresh-dont-replace--kill-the-broadcast-matrix)
2. [The four declarations that make multiplayer emerge](#2-the-four-declarations-that-make-multiplayer-emerge)
3. [Morph is reconciliation, not replacement](#3-morph-is-reconciliation-not-replacement)
4. [Morph the reply to your own action](#4-morph-the-reply-to-your-own-action)
5. [Derived order: no position column](#5-derived-order-no-position-column)
6. [Drop-as-REST: the routing table owns the case-on-destination](#6-drop-as-rest-the-routing-table-owns-the-case-on-destination)
7. [One rich transactional model verb, many entry points](#7-one-rich-transactional-model-verb-many-entry-points)
8. [The URL carries the contract: the `__id__` placeholder](#8-the-url-carries-the-contract-the-__id__-placeholder)
9. [Constrain the optimistic guess to the server's sort axis](#9-constrain-the-optimistic-guess-to-the-servers-sort-axis)
10. [Sharp edge: lazy frames must self-heal, not stale-morph](#10-sharp-edge-lazy-frames-must-self-heal-not-stale-morph)
11. [Sharp edge: veto the morph on client-only attributes](#11-sharp-edge-veto-the-morph-on-client-only-attributes)
12. [Red flags → fixes](#12-red-flags--fixes)

Scope: this file owns the **push** half of Turbo — live refresh, morphing, and the full drag-and-drop stack built on them. The request-driven pull half (frames, streams, `dom_id` addressing) lives in `05-turbo-frames-streams.md`. Stimulus internals for client state (autosave, localStorage drafts, keyboard navigation) live in `07-stimulus-widgets.md`.

---

## 1. Refresh, don't replace — kill the broadcast matrix

**When:** Several screens must stay in sync as records change — a board, a list, a dashboard, anything multiplayer.

**Not:** You will be tempted to hand-author a broadcast verb for every kind of change on every model — and then hand-maintain the fan-out:

```ruby
# DO NOT WRITE THIS — the broadcast matrix
class Card < ApplicationRecord
  after_create_commit  -> { broadcast_prepend_to board, :cards, target: [board, column, :cards] }
  after_update_commit  -> { broadcast_replace_to board, :cards, target: self }
  after_destroy_commit -> { broadcast_remove_to board, :cards }
end

class Column < ApplicationRecord
  after_update_commit -> { broadcast_replace_to board, target: self }
  # Each card shows its column's name, so a renamed column makes every card stale:
  after_update_commit -> { cards.each { |c| c.broadcast_replace_to board, target: c } }
end
```

This is a matrix: every model × every verb (append/replace/remove) × a hand-written fan-out loop for every field one record borrows from another × a hand-written client-side restore layer for everything each destructive `replace` throws away (open menus, focus, in-flight transitions). Every new model on the page and every new borrowed field grows the matrix, silently, with no error when you forget a cell.

**Do:** Stop telling the client *what* changed. Tell it *that* something changed, and let it diff. In Turbo 8 the push payload is literally the word `refresh`. A client that receives `refresh` on a stream it's subscribed to re-requests the current page and **morphs** the response — it walks old DOM and new DOM side by side and edits only the nodes that actually differ. The wire stops carrying "a fragment and a verb and a target" and carries one word.

**Why:** You spend one extra GET per change to delete an entire subsystem: no per-verb broadcasts, no fan-out loops, no client-side restore layer. The server already has the templates — "render it again and compare" *is* the diff engine. This is "the wire carries HTML, not data" taken one level up: the wire carries only the news that the HTML is stale. Count the edge cases this trade absorbs for free.

---

## 2. The four declarations that make multiplayer emerge

**When:** You're implementing live updates and reaching for a channel class, an ActionCable subscription, broadcast calls, or event names.

**Do:** Write zero real-time code. Multiplayer is an emergent property of four small declarations that all name the same parent record — if they agree on the stream name, the feature falls out (Fizzy ships its entire live Kanban board this way):

**One — the page subscribes** to a stream named after the parent:

```erb
<%# boards/show.html.erb %>
<%= turbo_stream_from @board %>
```

**Two — the model declares it broadcasts refreshes.** One macro, no verb, no target; create, update, and destroy all push the word `refresh`:

```ruby
# Card includes this concern (Fizzy)
included do
  broadcasts_refreshes
end
```

**Three — the layout declares how refreshes land**: by morphing, with scroll preserved. Set once, in the layout `<head>`, for the whole app:

```erb
<%# layouts <head> — the single most important line in this file %>
<% turbo_refreshes_with method: :morph, scroll: :preserve %>
```

`method: :morph` is what turns "refresh" from "reload the page" into "diff the page." `scroll: :preserve` keeps scroll position through it.

**Four — `touch: true` is the declarative fan-out.** When a record's display borrows fields from another (a card shows its column's name; a closed card shows its closure), staleness must propagate. Don't write the loop — declare it on the association that already exists:

```ruby
class Column < ApplicationRecord
  belongs_to :board, touch: true          # column changes → board's updated_at bumps
  after_save_commit -> { cards.touch_all }, if: -> { saved_change_to_name? || saved_change_to_color? }
end

class Closure < ApplicationRecord
  belongs_to :card, touch: true           # closing a card → the card's updated_at bumps
end
```

Trace the chain for one close-a-card action: a `Closure` row is created → `touch: true` bumps the card's `updated_at` → the card's `broadcasts_refreshes` pushes `refresh` to the board's stream → every browser subscribed via `turbo_stream_from @board` re-requests the board → `method: :morph` diffs the page and re-renders exactly one node, the card that now shows as closed. Nobody wrote "when a closure is created, update the card on everyone's screen."

**Not:** You will be tempted to build a channel class, name events, write broadcast calls, or hand-roll a WebSocket protocol — don't. There is no real-time subsystem to build. You will also be tempted to skip `touch: true` and broadcast the dependent records yourself — don't; that's the fan-out loop from §1 sneaking back in.

**Why:** The four declarations each ask the framework the same question — *what is this board's stream name?* — so they cannot disagree or drift. This is the throughline in its purest form: Rails stays small because each layer trusts a convention at its boundary. The fan-out rides the association graph you already declared for other reasons; a new borrowed field means another `touch:`, never another loop.

---

## 3. Morph is reconciliation, not replacement

**When:** Always — this distinction is the load-bearing idea behind everything else in this file. Internalize it before writing any live-update or optimistic-UI code.

**Do:** Treat `replace` and `morph` as different operations with different blast radii:

| | `replace` (destructive) | `morph` (reconciliation) |
|---|---|---|
| Mechanism | rips out the old node, drops in a new one | keeps the old node, edits only changed attributes/children in place |
| Open menu on the node | slammed shut | survives |
| Focus / cursor mid-edit | lost | survives |
| In-flight CSS transition | killed, flickers | survives |
| Optimistic client mutation | undone, then redone | reconciled — a no-op when the guess was right |
| Unchanged sibling nodes | untouched | untouched |

A node that is identical in the old and new trees is never touched by morph. That is why a live refresh and an open menu can coexist on the same screen.

**Not:** You will be tempted to treat morph as "a fancier page reload" and reach for client-side bookkeeping to remember and restore what updates destroy (which menu was open, where the cursor was). Don't — that's a hand-maintained reconciliation layer in the browser, and morph already is the reconciliation layer.

**Why:** Every transient thing a user is doing — hovering, typing, watching an animation — lives in DOM nodes. Replacement destroys those nodes; reconciliation edits around them. The two sharp edges (§10, §11) exist precisely where client-only state hides in places the server's render can't know about.

---

## 4. Morph the reply to your own action

**When:** Responding to a user's own mutation — an edit form submit, a drag-and-drop drop, anything where the client may already hold transient or optimistic state on the node you're updating.

**Do:** Reply with a stream `replace` flagged to morph. Same `dom_id` addressing as a normal stream action (`dom_id` is the address), but the swap reconciles instead of destroying (Fizzy):

```erb
<%# cards/update.turbo_stream.erb — reply to editing a card %>
<% container_partial = @card.drafted? ? "cards/drafts/container" : "cards/container" %>
<%= turbo_stream.replace dom_id(@card, :card_container), partial: container_partial, method: :morph, locals: { card: @card.reload } %>
```

```erb
<%# columns/cards/drops/columns/create.turbo_stream.erb — reply to a drag-drop %>
<%= turbo_stream.replace(dom_id(@column), partial: "boards/show/column", method: :morph, locals: { column: @column }) %>
```

While the round-trip was in flight, the user's DOM held state: focus, a running view transition, an optimistically-moved card. The morph reply edits only what actually changed (the title text; nothing, if the optimistic guess matched) and leaves the rest alone. The optimistic mutation is *reconciled*, not undone-and-redone.

This is the **same engine, two entry points**: `broadcasts_refreshes` + `turbo_refreshes_with method: :morph` morphs the *whole page* when a push arrives for everyone; `turbo_stream.replace ... method: :morph` morphs *one node* when the HTTP reply to your own request arrives. Both say "reconcile, don't destroy" — which is why the same partials serve both paths. One renderer.

**Not:** You will be tempted to reply with a plain `turbo_stream.replace` — don't. It works in a demo and flickers in production: it kills the focus, the transition, and the optimistic placement, then redraws them.

**Why:** The node the user is touching survives the update that touches it. One `method: :morph` flag deletes the entire "remember and restore client state after the swap" bug class.

---

## 5. Derived order: no position column

**When:** A list the user can reorder or drag between containers — cards in columns, items in a queue.

**Not:** You will be tempted to add a `position` integer (or `rank`, or `acts_as_list`) and renumber on every move — don't:

```ruby
# DO NOT WRITE THIS — stored order you must keep consistent forever
Card.where(column: @card.column).where("position > ?", @card.position).update_all("position = position - 1")
Card.where(column: target).where("position >= ?", params[:position]).update_all("position = position + 1")
@card.update!(column: target, position: params[:position])
```

Two `update_all`s that must agree; a half-failed drop leaves two cards claiming slot 3 — corrupted order, no exception raised; eventually you write a cron to sweep the drift. A stored copy is a second source of truth, and it lies.

**Do:** Derive, don't store. Fizzy's `cards` table has **no** position column at all. Order is one scope on the only sort axis:

```ruby
# Card (Fizzy) — the entire ordering system
scope :latest, -> { order last_active_at: :desc, id: :desc }
```

Most recently active sorts first; ties break on `id`. A drag doesn't renumber anything — the move bumps the card's activity, and the next render re-sorts. The renumbering subsystem isn't optimized; it's *absent*. There's no stored answer to keep in sync, so reorder has nothing to update.

"Pinned to top" is derived too — from the *existence* of a satellite row, never an integer. A golden (pinned) card is one that has a `goldness` row:

```ruby
# Card (Fizzy) — golden cards float to the top, derived from a row's presence
scope :with_golden_first, -> { left_outer_joins(:goldness).prepend_order("card_goldnesses.id IS NULL").preload(:goldness) }
```

Rows lacking a goldness (`id IS NULL` → true) sort after rows that have one, so golden leads.

**The judgment call:** derive when order is computable; store **only when position encodes genuine user intent**. Fizzy refuses hand-placement for cards as a product decision — order *is* recency — and that refusal deletes the whole ranking machine. Where position genuinely is intent (reordering whole *columns*), it does store it — and even then reorder is a REST resource, not a renumbering loop. Ask "whose fact is this?" — if the order is a consequence of activity, it's the database's derived fact, not a column you maintain.

**Why:** Count the edge cases the missing column absorbs: no renumber transactions, no half-failure corruption, no drift cron, and — see §9 — a drag-and-drop client that needs only one bit to place a card correctly.

---

## 6. Drop-as-REST: the routing table owns the case-on-destination

**When:** One client gesture can mean several different things — dropping a card onto "Done" vs "Not Now" vs a workflow column vs back to triage. Any time you find yourself writing `case params[:destination]`.

**Not:** You will be tempted to write one controller action that branches on what the drop means — don't:

```ruby
# DO NOT WRITE THIS — the junction-box controller
def update
  case params[:destination]
  when "column"  then ...move...
  when "done"    then @card.update!(closed_at: Time.current, column: nil)
  when "not_now" then @card.update!(postponed_at: Time.current, column: nil)
  when "maybe"   then @card.update!(column: nil)
  end
end
```

One method that knows the meaning of every drop, grows a `when` per new target, and ships a bug in the "close" branch inside the same method as "postpone."

**Do:** Find the noun. Each *kind* of drop is its own resource; the routing table — not a conditional — is where the case-on-destination lives (Fizzy):

```ruby
# routes.rb
namespace :columns do
  resources :cards do
    scope module: :cards do
      namespace :drops do
        resource :not_now      # drop onto "Not Now"  → postpone
        resource :stream       # drop onto "Maybe?"   → send back to triage
        resource :closure      # drop onto "Done"     → close
        resource :column       # drop into a column   → triage_into
      end
    end
  end
end
```

Dropping a card onto "Done" is `POST` to its `closure` — *creating a closure*. Verb-as-noun. The controllers have nothing left to decide; each is 3–7 lines naming one model verb:

```ruby
class Columns::Cards::Drops::ColumnsController < ApplicationController
  include CardScoped

  def create
    @column = @card.board.columns.find(params[:column_id])
    @card.triage_into(@column)
  end
end

class Columns::Cards::Drops::ClosuresController < ApplicationController
  include CardScoped

  def create
    @card.close
  end
end

class Columns::Cards::Drops::NotNowsController < ApplicationController
  include CardScoped

  def create
    @card.postpone
  end
end

class Columns::Cards::Drops::StreamsController < ApplicationController
  include CardScoped

  def create
    @card.send_back_to_triage
    set_page_and_extract_portion_from @board.cards.awaiting_triage.latest.with_golden_first
  end
end
```

The destination is decided by which route the POST hit, before any Ruby runs. Note `include CardScoped` on every one: the card loads through the user's accessible boards, so a drop on a card you can't reach 404s before `create` runs — the IDOR you cannot type, secure-by-default. 37signals wrote this down as house law in their STYLE.md: when an action doesn't map to a standard CRUD verb, introduce a new resource rather than a custom action.

**Why:** Four near-identical tiny controllers are not duplication — the `case` version would be *shorter*, not DRYer. Four files each change for exactly one reason; adding a fifth drop target is adding a route and a file, never editing existing code. The routing table absorbs the branch the controller would otherwise grow — count the `when`s that `namespace :drops` block deletes: all of them, forever.

---

## 7. One rich transactional model verb, many entry points

**When:** A state change is reachable more than one way — dragged *and* clicked, user-initiated *and* scheduled-job-initiated.

**Do:** Put the whole consequence in one intention-revealing transactional model verb, and have every entry point call it (Fizzy):

```ruby
# Card — what "triage into a column" MEANS, in one place
def triage_into(column)
  raise "The column must belong to the card board" unless board == column.board

  transaction do
    resume                                                   # un-postpone if it was postponed
    update! column: column
    track_event "triaged", particulars: { column: column.name }
  end
end
```

Guard, then three consequences that succeed or fail together. The drag path (`Drops::ColumnsController`), the click-a-column-button path (a separate explicit triage controller), and any future path all call `triage_into`. The same shape governs the other drops: `close` (destroy any `not_now`, create the `closure`, track the event — one transaction) and `postpone` (send back to triage, reopen, clear activity, create the `not_now` row — four steps, one atomic verb), each called identically by the drag path, the click path, and the hourly auto-postpone job.

**Not:** You will be tempted to inline the consequences in the controller (`@card.update!(closed_at: ..., column: nil)`) — don't. Every entry point then reimplements the move, and the day someone fixes a bug in the drag path, the click path and the cron still have it.

**Why:** The model owns the consequence; controllers state intentions. Two-plus entry points, one implementation — the guard, the resume, and the event tracking cannot drift because they exist once. The deep doctrine is the model-owns-the-consequence file; what this file adds is the multiplayer corollary: drag, click, and cron all producing the *same* transition is what makes the broadcast/morph chain in §2 trustworthy from every direction.

---

## 8. The URL carries the contract: the `__id__` placeholder

**When:** A single generic client behavior (one drag controller) must serve many semantically different targets (close, postpone, move, un-triage) without the JavaScript knowing the difference.

**Do:** Have the server render each drop target with the URL its drops should POST to — a URL with a hole in it — stamped as a data attribute. The route *is* the meaning (Fizzy):

```erb
<%# boards/show/_closed.html.erb — the "Done" column %>
<%= column_tag id: "closed-cards", name: "Done",
      drop_url: columns_card_drops_closure_path("__id__"), ... %>

<%# boards/show/_not_now.html.erb %>
<%= column_tag id: "not-now", name: "Not Now",
      drop_url: columns_card_drops_not_now_path("__id__"), ... %>

<%# boards/show/_stream.html.erb — "Maybe?" / triage %>
<%= column_tag id: "maybe", name: "Maybe?",
      drop_url: columns_card_drops_stream_path("__id__"), ... %>

<%# boards/show/_column.html.erb — a real workflow column %>
<%= column_tag id: dom_id(column), name: column.name,
      drop_url: columns_card_drops_column_path("__id__", column_id: column.id), ... %>
```

The helper stamps the contract onto the DOM node as plain data — configuration carried as data, so the JS stays domain-agnostic:

```ruby
# columns_helper.rb (Fizzy) — inside column_tag
data = {
  drag_and_drop_target: "container",
  navigable_list_target: "item",
  column_name: name,
  drag_and_drop_url: drop_url,                       # ← the contract, on the DOM node
  drag_and_drop_css_variable_name: "--card-color",
  drag_and_drop_css_variable_value: card_color
}.merge(data)
```

And the client's entire server interaction is: fill the hole, POST an empty body:

```javascript
// drag_and_drop_controller.js (Fizzy) — all the JS knows about the server
async #submitDropRequest(item, container) {
  const body = new FormData()
  const id  = item.dataset.id
  const url = container.dataset.dragAndDropUrl.replaceAll("__id__", id)   // fill in the card

  return post(url, { body, headers: { Accept: "text/vnd.turbo-stream.html" } })
}
```

The same `drop()` serves Done, Not Now, Maybe, and every column. It does not know whether the drop closes, postpones, or moves the card — it transports a card id to an address the server chose. The `__id__` placeholder swap is the seam: server renders the URL-with-a-hole (it owns `routes.rb`), client fills the hole (it owns which card is being dragged).

**Not:** You will be tempted to build the URL in JavaScript from the card id, or to POST a JSON payload like `{ destination: "done", card_id: ... }` for a server `case` to switch on — don't. Both split the meaning of the drop across two codebases kept in sync by hand: the client encodes the route shape or names the action, and the server must agree.

**Why:** The URL carries the contract. The route shape lives in exactly one place; changing what dropping onto "Done" *means* is a route change, zero lines of JavaScript. The client invents no notion of "close" — no wire format to design, version, or drift.

---

## 9. Constrain the optimistic guess to the server's sort axis

**When:** Drag must feel instant, so the client moves the node optimistically — before the server answers — and the server's morph reply must then find nothing to correct.

**Do:** Move first, POST second, and let the morph reconcile (Fizzy):

```javascript
// drag_and_drop_controller.js — note the order
async drop(event) {
  const targetContainer = this.#containerContaining(event.target)

  if (!targetContainer || targetContainer === this.sourceContainer) { return }

  this.wasDropped = true
  this.#increaseCounter(targetContainer)
  this.#decreaseCounter(this.sourceContainer)

  const sourceContainer = this.sourceContainer
  this.#insertDraggedItem(targetContainer, this.dragItem)        // ← optimistic: move it NOW
  await this.#submitDropRequest(this.dragItem, targetContainer)  // ← then tell the server
  this.#reloadSourceFrame(sourceContainer)
}
```

For the §4 morph reply to be a no-op, the client's guess about *where* the card lands must match what the server will render. So don't let the client guess freely — constrain it to the server's one sort axis (§5). A freshly-dropped card just became most-recently-active, so it sorts to the top of the non-golden cards; golden cards occupy the band above. That's one bit, and the server stamps it:

```ruby
# cards_helper.rb (Fizzy) — the server tells the client which side of the axis this card is on
def card_article_tag(card, id: dom_id(card, :article), data: {}, **options, &block)
  # ...
  data[:drag_and_drop_top] = true if card.golden? && !card.closed? && !card.postponed?
  # ...
end
```

The client reads exactly that one bit to place the card:

```javascript
// drag_and_drop_controller.js — the client's only placement decision
#insertDraggedItem(container, item) {
  const itemContainer = container.querySelector("[data-drag-drop-item-container]")
  const topItems = itemContainer.querySelectorAll("[data-drag-and-drop-top]")
  const firstTopItem = topItems[0]
  const lastTopItem  = topItems[topItems.length - 1]

  const isTopItem = item.hasAttribute("data-drag-and-drop-top")
  const referenceItem = isTopItem ? firstTopItem : lastTopItem

  if (referenceItem) {
    referenceItem[isTopItem ? "before" : "after"](item)   // golden → before the golden band; normal → after it
  } else {
    itemContainer.prepend(item)
  }
}
```

Golden → before the existing golden band; normal → after it, i.e. at the top of the normal cards. That is the same partition the server's `with_golden_first` + `latest` scopes produce, so the optimistic placement *cannot disagree with server truth* — there's only one axis to agree on, and the server told the client which side of it this card falls on. When the morph reply arrives, the card is in the same place in both trees: a no-op. Placement, focus, and in-flight animation survive. Instant *and* correct, with no reconciliation code.

**Not:** You will be tempted to compute an insertion index from the pointer's pixel position and POST it as `params[:position]` for the server to trust — don't. Client and server then each hold their own idea of order, and they drift the instant a sort rule changes on one side; the morph "corrects" the placement with a visible flicker on every drop.

**Why:** The optimistic move buys instant feedback (a card snapping into place 150ms late feels broken); the constrained guess buys correctness for free. The DOM attribute IS the state: the server's sort knowledge reaches the client as one stamped bit, not a duplicated sorting algorithm.

---

## 10. Sharp edge: lazy frames must self-heal, not stale-morph

**When:** Page-level morphing (§2) coexists with lazy `src` turbo-frames — frames that render as empty placeholders server-side and fetch their own content client-side.

The failure: a refresh arrives and morphs the page. Morph compares the *server's* fresh render against the browser's current DOM — but the server's render of a lazy frame is the empty placeholder (loading the content is the frame's client-side job). A naive morph happily morphs the loaded, full-of-content frame back into the empty placeholder. The live refresh *erases* the content it was supposed to keep fresh.

**Do:** Bake the guard into the frame helper, so every `src` frame self-heals and you decide once, not per frame (Fizzy):

```ruby
# columns_helper.rb — every column frame gets the guard automatically
def column_frame_tag(id, src: nil, data: {}, **options, &block)
  data = data.with_defaults \
    drag_and_drop_refresh: true,
    controller: "frame",
    action: "turbo:before-frame-render->frame#morphRender turbo:before-morph-element->frame#morphReload"
  options[:refresh] = :morph if src.present?
  turbo_frame_tag(id, src: src, data: data, **options, &block)
end
```

```javascript
// frame_controller.js — cancel the stale-placeholder morph; reload fresh instead
morphReload(event) {
  const newElement = event.detail.newElement
  if (newElement && newElement.tagName === "TURBO-FRAME" && newElement.matches('[data-controller~="frame"]')) {
    event.preventDefault()
    this.element.reload()
  }
}
```

Read it as a sentence: "if a page morph is about to overwrite this lazy frame with the server's stale placeholder, stop — reload the frame so it fetches its real, current content." The frame morphs its *children* normally, but vetoes being morphed *wholesale*, reloading instead.

**Not:** You will be tempted to either let the page reload fully (throwing away every lazy frame's loaded state) or let the naive morph run (corrupting loaded frames with placeholders) — or to wire the guard per-frame in each view. Don't. Helper, once.

**Why:** Three lines turn corruption-vs-staleness into a non-dilemma: the frame heals itself on every refresh. Because it lives in the helper, no future frame can forget the guard.

---

## 11. Sharp edge: veto the morph on client-only attributes

**When:** Any element holds state in an attribute the server cannot know about — a `<dialog>`'s `open`, a collapsed panel's `class`, anything that never went to the database.

The failure: a live refresh arrives while a user has a "move to…" menu open. In the server's fresh render that menu is closed — "open" is pure client state. Morph diffs `open` → absent and slams the menu shut mid-interaction. A live board would constantly close every menu anyone opened.

**Do:** Declare a one-attribute veto. `turbo:before-morph-attribute` fires once per attribute morph is about to change; preventDefault exactly the one carrying client state (Fizzy):

```erb
<dialog ... data-action="turbo:before-morph-attribute->dialog#preventCloseOnMorphing">
```

```javascript
// dialog_controller.js — "when morph is about to change `open`, don't"
preventCloseOnMorphing(event) {
  if (event.detail?.attributeName === "open") {
    event.preventDefault()
    event.stopPropagation()
  }
}
```

Every *other* attribute on the dialog still morphs — its contents stay fresh — but the one attribute the server can't know about is protected. Fizzy applies the same veto to `class` on its collapsible columns, protecting the collapsed/expanded state the same way. A live refresh and an open menu coexist.

**Not:** You will be tempted to disable morphing on the whole element, or to rebuild the open/collapsed state after every refresh with restore code — don't. The veto is three lines per piece of transient state, not a reconciliation engine and not an opt-out from freshness.

**Why:** Morph protects everything the server *renders*; this is the escape hatch for the few attributes it doesn't. The veto is how you tell morph: this one attribute is mine, not yours. Scope it to the attribute name, never the element.

---

## 12. Red flags → fixes

| Red flag in the diff | Fix | Section |
|---|---|---|
| `broadcast_prepend_to` / `broadcast_replace_to` / `broadcast_remove_to` per lifecycle event | `broadcasts_refreshes`, one macro, all verbs | §1–2 |
| A loop re-broadcasting child records when a parent changes | `touch: true` on the association (+ `touch_all` for the reverse direction) | §2 |
| A channel class, event names, or hand-rolled WebSocket code for live updates | four declarations agreeing on a stream name; no real-time code | §2 |
| `turbo_refreshes_with` missing from the layout | add `method: :morph, scroll: :preserve` once, in `<head>` | §2 |
| Plain `turbo_stream.replace` replying to an edit or a drop | add `method: :morph` — reconcile, don't destroy | §4 |
| A new `position` / `rank` / `sort_order` column; `acts_as_list` | derive order from one sort axis (`order(last_active_at: :desc, id: :desc)`); store position only for genuine user intent | §5 |
| "Pinned" stored as an integer or boolean re-sorted by hand | derive from a satellite row's existence (`left_outer_joins` + `prepend_order("... IS NULL")`) | §5 |
| `case params[:destination]` (or any branch on what a gesture means) in a controller | one resource per meaning in a `namespace :drops` block; the routing table owns the branch | §6 |
| `@card.update!(closed_at: ...)` inline in a controller, duplicated across entry points | one transactional model verb (`close`, `postpone`, `triage_into`) all paths call | §7 |
| Client JS building route paths, or POSTing `{ destination: "...", id: ... }` JSON | server-rendered `drop_url` with a `__id__` hole; client fills the hole and POSTs empty | §8 |
| Client computing an insertion index from pixel position and posting it | one server-stamped bit (`data-drag-and-drop-top`) honoring the server's only sort axis | §9 |
| Lazy `src` frame goes empty after a live refresh | frame helper wires `morphReload`: cancel the wholesale morph, reload the frame | §10 |
| Menus/panels slam shut on every live refresh | `turbo:before-morph-attribute` veto on exactly the client-only attribute (`open`, `class`) | §11 |
| Client code saving and restoring focus/menu/scroll around updates | delete it; morph + the two vetoes are the reconciliation layer | §3, §10–11 |

The composition is the lesson: `turbo_stream_from` + `broadcasts_refreshes` + `turbo_refreshes_with method: :morph` + `touch: true` = multiplayer with zero real-time code. Derived order + drop-as-REST + one model verb + URL-as-contract + the one-bit constrained guess + morph = drag-and-drop where every layer defers to a convention the next layer already understands. Build live UIs by making conventions agree on a name, then count the edge cases each declaration absorbs for free.
