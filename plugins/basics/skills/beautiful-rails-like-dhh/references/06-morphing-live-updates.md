# Turbo 8 Morphing & Live Multiplayer

Read this when a page must stay live across browsers, when writing a broadcast call, when adding drag-and-drop or optimistic UI, or when about to add a `position` column.

This file owns the **push** half of Turbo — live refresh, morphing, and the drag-and-drop stack built on them. The request-driven pull half (frames, streams, `dom_id` addressing) lives in `05-turbo-frames-streams.md`; the exhaustive stream-action semantics table lives in `15-hotwire-api-cheatsheet.md`; Stimulus client state lives in `07-stimulus-widgets.md`.

---

## 1. Refresh, don't replace — kill the broadcast matrix

Don't hand-author a broadcast verb per model × per lifecycle event × a fan-out loop for every borrowed field × a client-side restore layer for what each destructive swap throws away. That matrix grows silently with every new model and field, with no error when you forget a cell.

Instead, stop telling the client *what* changed — tell it *that* something changed and let it diff. In Turbo 8 the push payload is the word `refresh`. A subscribed client re-requests the page and **morphs** the response: walks old and new DOM side by side, edits only the nodes that differ. One extra GET per change deletes the whole subsystem — the server already has the templates, so "render again and compare" *is* the diff engine.

## 2. The four declarations that make multiplayer emerge

Write zero real-time code. Multiplayer falls out of four declarations that all name the same parent stream (Fizzy ships its live Kanban board this way):

```erb
<%# boards/show.html.erb — the page subscribes %>
<%= turbo_stream_from @board %>
```
```ruby
# the model broadcasts refreshes — one macro, all of create/update/destroy
broadcasts_refreshes
```
```erb
<%# layout <head> — how refreshes land; the single most important line %>
<% turbo_refreshes_with method: :morph, scroll: :preserve %>
```
`method: :morph` turns "refresh" from "reload" into "diff"; `scroll: :preserve` keeps position.

**`touch: true` is the declarative fan-out.** When a record borrows fields from another (a card shows its column's name), staleness must propagate — declare it on the association, don't write the loop:

```ruby
class Column < ApplicationRecord
  belongs_to :board, touch: true
  after_save_commit -> { cards.touch_all }, if: -> { saved_change_to_name? || saved_change_to_color? }
end
```

Trace one close-a-card: a `Closure` is created → `touch: true` bumps the card's `updated_at` → `broadcasts_refreshes` pushes `refresh` → every subscriber re-requests the board → morph re-renders exactly the one closed card. Nobody wrote "when a closure is created, update the card on everyone's screen." The four declarations each ask the framework the same question — *what is this board's stream name?* — so they can't drift. Skipping `touch: true` to broadcast dependents yourself is the §1 fan-out loop sneaking back.

## 3. Morph is reconciliation, not replacement

The load-bearing distinction behind everything here. `replace` and `morph` have different blast radii:

| | `replace` (destructive) | `morph` (reconciliation) |
|---|---|---|
| Open menu on the node | slammed shut | survives |
| Focus / cursor mid-edit | lost | survives |
| Optimistic client mutation | undone, then redone | reconciled — a no-op when the guess was right |

A node identical in old and new trees is never touched. That's why a live refresh and an open menu coexist. Don't reach for client bookkeeping to remember-and-restore what updates destroy — morph already *is* the reconciliation layer. The two sharp edges (§10, §11) are exactly where client-only state hides in places the server's render can't see.

## 4. Morph the reply to your own action

When responding to a user's own mutation (form submit, drag-drop) where the client may hold transient/optimistic state, reply with a stream `replace` flagged to morph — same `dom_id` addressing, reconciling swap:

```erb
<%# cards/update.turbo_stream.erb %>
<%= turbo_stream.replace dom_id(@card, :card_container), partial: "cards/container", method: :morph, locals: { card: @card.reload } %>
```

While the round-trip was in flight the DOM held focus, a running transition, an optimistically-moved card. The morph edits only what actually changed and leaves the rest — the optimistic mutation is *reconciled*, not undone-and-redone. A plain `turbo_stream.replace` works in a demo and flickers in production: it kills focus, transition, and optimistic placement, then redraws them.

This is **one engine, two entry points**: `broadcasts_refreshes` + `turbo_refreshes_with method: :morph` morphs the *whole page* on a push for everyone; `turbo_stream.replace … method: :morph` morphs *one node* on the HTTP reply to your own request. Same partials serve both.

## 5. Derived order: no position column

Don't add a `position` integer (or `acts_as_list`) and renumber on every move. Two `update_all`s that must agree leave corrupted order on half-failure with no exception, and eventually a drift-sweeping cron. A stored copy is a second source of truth, and it lies.

Derive instead. Fizzy's `cards` table has **no** position column — order is one scope on the only sort axis:

```ruby
scope :latest, -> { order last_active_at: :desc, id: :desc }
```

A drag bumps activity; the next render re-sorts. The renumbering subsystem isn't optimized, it's *absent*. "Pinned to top" is derived from the *existence* of a satellite row, never an integer:

```ruby
scope :with_golden_first, -> { left_outer_joins(:goldness).prepend_order("card_goldnesses.id IS NULL").preload(:goldness) }
```

Rows lacking a goldness (`id IS NULL` → true) sort last, so golden leads.

**The judgment call:** derive when order is computable; store **only when position encodes genuine user intent**. Fizzy refuses hand-placement for cards as a product decision — order *is* recency — and that refusal deletes the ranking machine. Where position genuinely is intent (reordering whole columns), it stores it — and even then reorder is a REST resource, not a renumbering loop. Ask "whose fact is this?"

## 6. Drop-as-REST: the routing table owns the case-on-destination

When one gesture means several things (drop onto Done vs Not Now vs a column), don't write `case params[:destination]` in one controller that grows a `when` per target and hides a close bug next to a postpone branch.

Find the noun. Each *kind* of drop is its own resource; the routing table is where the case lives:

```ruby
namespace :columns do
  resources :cards do
    scope module: :cards do
      namespace :drops do
        resource :not_now   # postpone
        resource :stream    # send back to triage
        resource :closure   # close
        resource :column    # triage_into
      end
    end
  end
end
```

Dropping onto "Done" is `POST` to its `closure` — *creating a closure*. Verb-as-noun. Each controller is 3–7 lines naming one model verb:

```ruby
class Columns::Cards::Drops::ClosuresController < ApplicationController
  include CardScoped
  def create = @card.close
end

class Columns::Cards::Drops::ColumnsController < ApplicationController
  include CardScoped
  def create
    @column = @card.board.columns.find(params[:column_id])
    @card.triage_into(@column)
  end
end
```

The destination is decided by which route the POST hit, before any Ruby runs. `include CardScoped` loads the card through the user's accessible boards, so an out-of-reach drop 404s before `create` — the IDOR you cannot type. Four near-identical tiny controllers are not duplication: the `case` version would be *shorter*, not DRYer; each file changes for one reason, and a fifth target is a new route + file, never an edit. (37signals STYLE.md: when an action doesn't map to a CRUD verb, introduce a resource, not a custom action.)

## 7. One rich transactional model verb, many entry points

When a state change is reachable more than one way (dragged *and* clicked, user- *and* job-initiated), put the whole consequence in one intention-revealing transactional model verb every entry point calls:

```ruby
def triage_into(column)
  raise "The column must belong to the card board" unless board == column.board
  transaction do
    resume                       # un-postpone
    update! column: column
    track_event "triaged", particulars: { column: column.name }
  end
end
```

Guard, then consequences that succeed or fail together. The drag path, the click path, and any future path all call `triage_into`; same for `close` and `postpone` (also called by the hourly auto-postpone job). Inline the consequences in the controller and every entry point reimplements the move — fix the drag path's bug and the click path and cron still have it. The model owns the consequence; controllers state intentions. Drag, click, and cron producing the *same* transition is what makes the §2 broadcast/morph chain trustworthy from every direction.

## 8. The URL carries the contract: the `__id__` placeholder

When one generic client behavior (one drag controller) must serve many semantically different targets, have the server render each drop target with the URL its drops POST to — a URL with a hole in it — as a data attribute. The route *is* the meaning:

```erb
<%= column_tag id: "closed-cards", name: "Done",
      drop_url: columns_card_drops_closure_path("__id__"), ... %>
<%= column_tag id: dom_id(column), name: column.name,
      drop_url: columns_card_drops_column_path("__id__", column_id: column.id), ... %>
```

The client's entire server interaction: fill the hole, POST an empty body.

```javascript
const url = container.dataset.dragAndDropUrl.replaceAll("__id__", item.dataset.id)
return post(url, { body: new FormData(), headers: { Accept: "text/vnd.turbo-stream.html" } })
```

The same `drop()` serves Done, Not Now, Maybe, and every column — it doesn't know whether the drop closes, postpones, or moves; it transports a card id to an address the server chose. Don't build the URL in JS or POST `{ destination: "done", card_id: ... }` JSON for a server `case`: both split the drop's meaning across two codebases kept in sync by hand. The route shape lives in one place; changing what "Done" means is a route change, zero lines of JS.

## 9. Constrain the optimistic guess to the server's sort axis

Drag must feel instant, so the client moves the node optimistically before the server answers — and the §4 morph reply must then find nothing to correct. Move first, POST second:

```javascript
this.#insertDraggedItem(targetContainer, this.dragItem)        // optimistic: move NOW
await this.#submitDropRequest(this.dragItem, targetContainer)  // then tell the server
```

For the morph to be a no-op, the client's guess about *where* the card lands must match what the server renders — so constrain the guess to the server's one sort axis (§5). A freshly-dropped card just became most-recently-active, so it sorts to the top of the non-golden band; golden cards occupy the band above. That's one bit, and the server stamps it:

```ruby
data[:drag_and_drop_top] = true if card.golden? && !card.closed? && !card.postponed?
```

The client reads exactly that bit: golden → before the golden band, normal → after it (top of the normal cards). That's the same partition `with_golden_first` + `latest` produce, so the optimistic placement *cannot disagree with server truth*. When the morph reply arrives the card is already in place in both trees: a no-op, placement/focus/animation survive. Don't compute an insertion index from pixel position and POST it as `params[:position]` — client and server then hold separate ideas of order and drift the instant a sort rule changes, with a visible flicker every drop. The DOM attribute IS the state.

## 10. Sharp edge: lazy frames must self-heal, not stale-morph

When page-level morphing coexists with lazy `src` turbo-frames (empty placeholder server-side, content fetched client-side): a refresh morphs the page, comparing the server's render — the empty placeholder — against the browser's loaded frame, and naively morphs the full frame back into the placeholder. The live refresh *erases* the content it meant to keep fresh.

Bake the guard into the frame helper so every `src` frame self-heals, decided once:

```ruby
def column_frame_tag(id, src: nil, data: {}, **options, &block)
  data = data.with_defaults controller: "frame",
    action: "turbo:before-morph-element->frame#morphReload"
  options[:refresh] = :morph if src.present?
  turbo_frame_tag(id, src: src, data: data, **options, &block)
end
```
```javascript
morphReload(event) {
  const el = event.detail.newElement
  if (el?.tagName === "TURBO-FRAME" && el.matches('[data-controller~="frame"]')) {
    event.preventDefault()
    this.element.reload()   // fetch real content instead of accepting the placeholder
  }
}
```

The frame morphs its children normally but vetoes being morphed *wholesale*, reloading instead. In the helper, no future frame can forget the guard.

## 11. Sharp edge: veto the morph on client-only attributes

When an element holds state in an attribute the server can't know — a `<dialog>`'s `open`, a collapsed panel's `class`: a refresh arrives with a menu open, the server's render has it closed, morph diffs `open` → absent and slams it shut mid-interaction.

Declare a one-attribute veto. `turbo:before-morph-attribute` fires per attribute; preventDefault exactly the one carrying client state:

```erb
<dialog ... data-action="turbo:before-morph-attribute->dialog#preventCloseOnMorphing">
```
```javascript
preventCloseOnMorphing(event) {
  if (event.detail?.attributeName === "open") {
    event.preventDefault()
    event.stopPropagation()
  }
}
```

Every *other* attribute still morphs — contents stay fresh — but the one the server can't know is protected. (Fizzy applies the same veto to `class` on collapsible columns.) Don't disable morphing on the whole element or rebuild state with restore code. Scope it to the attribute name, never the element.

## 12. Red flags → fixes

| Red flag in the diff | Fix | Section |
|---|---|---|
| `broadcast_*_to` per lifecycle event | `broadcasts_refreshes`, one macro, all verbs | §1–2 |
| A loop re-broadcasting child records when a parent changes | `touch: true` (+ `touch_all` for the reverse) | §2 |
| A channel class / event names / hand-rolled WebSocket for live updates | four declarations agreeing on a stream name | §2 |
| `turbo_refreshes_with` missing from the layout | add `method: :morph, scroll: :preserve` once, in `<head>` | §2 |
| Plain `turbo_stream.replace` replying to an edit or drop | add `method: :morph` | §4 |
| A new `position`/`rank`/`sort_order` column; `acts_as_list` | derive order from one sort axis; store only for genuine user intent | §5 |
| "Pinned" stored as an integer/boolean re-sorted by hand | derive from a satellite row's existence (`left_outer_joins` + `prepend_order`) | §5 |
| `case params[:destination]` in a controller | one resource per meaning in `namespace :drops` | §6 |
| `@card.update!(...)` inline, duplicated across entry points | one transactional model verb all paths call | §7 |
| Client JS building route paths, or POSTing `{ destination, id }` JSON | server-rendered `drop_url` with a `__id__` hole | §8 |
| Client computing an insertion index from pixel position and posting it | one server-stamped bit (`data-drag-and-drop-top`) | §9 |
| Lazy `src` frame goes empty after a live refresh | frame helper wires `morphReload`: cancel the wholesale morph, reload | §10 |
| Menus/panels slam shut on every live refresh | `turbo:before-morph-attribute` veto on the client-only attribute | §11 |
| Client code saving/restoring focus/menu/scroll around updates | delete it; morph + the two vetoes are the reconciliation layer | §3, §10–11 |

The composition is the lesson: `turbo_stream_from` + `broadcasts_refreshes` + `turbo_refreshes_with method: :morph` + `touch: true` = multiplayer with zero real-time code. Derived order + drop-as-REST + one model verb + URL-as-contract + the one-bit constrained guess + morph = drag-and-drop where every layer defers to a convention the next layer already understands.