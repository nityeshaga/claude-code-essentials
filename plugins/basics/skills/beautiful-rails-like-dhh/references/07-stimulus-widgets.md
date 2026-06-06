# Stimulus & Rich Widgets the 37signals Way

Read this when you're about to write any client-side behavior — keyboard navigation, hotkeys, a combobox, a multi-select, autosave, drafts, an auto-submitting form — and especially when the richness of the interaction makes you think "this needs React." It doesn't. This file is how far rich frontend goes with thin, domain-agnostic JavaScript configured entirely from ERB.

**Contents**

1. [The doctrine: JS is mechanism, ERB is configuration, the server owns the domain](#1-the-doctrine-js-is-mechanism-erb-is-configuration-the-server-owns-the-domain)
2. [Config over forks: one controller, a vocabulary of toggles](#2-config-over-forks-one-controller-a-vocabulary-of-toggles)
3. [The DOM attribute IS the state: `aria-selected` as the cursor](#3-the-dom-attribute-is-the-state-aria-selected-as-the-cursor)
4. [Nested lists: declared, not wired](#4-nested-lists-declared-not-wired)
5. [Outlets: declared wires between controllers](#5-outlets-declared-wires-between-controllers)
6. [Hotkeys: read the URL off the element, POST, know nothing](#6-hotkeys-read-the-url-off-the-element-post-know-nothing)
7. [Capability subtracted in markup](#7-capability-subtracted-in-markup)
8. [Cursor rehoming after a morph](#8-cursor-rehoming-after-a-morph)
9. [Form widgets that stay plain-Rails on the wire](#9-form-widgets-that-stay-plain-rails-on-the-wire)
10. [`requestSubmit()`, never `submit()`](#10-requestsubmit-never-submit)
11. [`data-action` pipelines: intent declared in ERB](#11-data-action-pipelines-intent-declared-in-erb)
12. [Behavior on Turbo's published lifecycle: wrap `event.detail.render`](#12-behavior-on-turbos-published-lifecycle-wrap-eventdetailrender)
13. [Self-submitting, self-erasing forms](#13-self-submitting-self-erasing-forms)
14. [Additive decorator helpers: never clobber `data-controller`](#14-additive-decorator-helpers-never-clobber-data-controller)
15. [Autosave: the timer IS the dirty flag](#15-autosave-the-timer-is-the-dirty-flag)
16. [localStorage drafts: derive, don't store, at the client](#16-localstorage-drafts-derive-dont-store-at-the-client)
17. [Asides: progressive enhancement, the DOM as source of truth, speaking Rails off the wire](#17-asides-progressive-enhancement-the-dom-as-source-of-truth-speaking-rails-off-the-wire)
18. [The drag controller's client-side contract (recap)](#18-the-drag-controllers-client-side-contract-recap)
19. [Red flags → fixes](#19-red-flags--fixes)

Scope: this file owns the Stimulus layer — how rich widgets are built and configured. Morph mechanics, `broadcasts_refreshes`, the four-declaration multiplayer, and the full drag-and-drop stack (derived order, drop-as-REST, the optimistic-insert handshake) live in `06-morphing-live-updates.md`. The server-vs-client worldview — why one renderer beats two — lives in `00-frontend-first-principles.md`.

---

## 1. The doctrine: JS is mechanism, ERB is configuration, the server owns the domain

Every pattern in this file is one division of labor, applied over and over:

| Layer | Owns | Never owns |
|---|---|---|
| **Stimulus controller (JS)** | A generic mechanism: "navigate a list," "clone a template per selection," "submit on connect," "save after a pause" | Any domain noun. No "card," no "assignee," no route shape, no field name |
| **ERB / helpers** | The configuration: `data-*-value` toggles, `data-action` pipelines, stamped URLs, `<template>` blueprints, capability flags | The mechanism — no behavior is re-implemented per view |
| **Server (routes, models, params)** | All domain knowledge: what a hotkey *means*, what a field is *named*, what a drop *does*, who is *allowed* | — |

The test for any Stimulus controller you're about to write: **could this controller ship in a gem, with zero knowledge of your app, and still work?** Fizzy's `navigable-list`, `drag-and-drop`, `combobox`, `auto-submit`, `local-save` controllers all pass. If yours doesn't — if it knows a route, a model name, a field name, or what a key "means" — domain knowledge has leaked into the client, and you're on the road to the second renderer that `00-frontend-first-principles.md` exists to talk you out of.

The consequence of holding this line: a Rails developer builds and modifies rich keyboard-driven, multi-select, autosaving UIs **without writing or reading JavaScript** — they edit data attributes in views and helpers. That is the payoff this whole file cashes out.

---

## 2. Config over forks: one controller, a vocabulary of toggles

**When:** You have several UI surfaces that share a mechanism but differ in the rules — a vertical card list, a horizontal column row, a dropdown menu, all "navigable."

**Do:** Write ONE generic controller and express every variation as Stimulus values — `data-<controller>-*-value` attributes declared in the view or a helper. Fizzy has exactly one `navigable-list` controller for cards, columns, and menus. The board's columns container — a *horizontal* list that nests other lists (Fizzy):

```erb
<%# The outer list: columns navigate left/right, contain nested card lists %>
<%= tag.div class: "card-columns hide-scrollbar", data: {
      controller: "collapsible-columns drag-and-drop drag-and-strum navigable-list card-hotkeys",
      navigable_list_supports_vertical_navigation_value: false,
      navigable_list_has_nested_navigation_value: true,
      navigable_list_prevent_handled_keys_value: true,
      navigable_list_auto_select_value: false,
      navigable_list_auto_scroll_value: false,
      card_hotkeys_navigable_list_outlet: ".cards__transition-container",
      action: "
        keydown->navigable-list#navigate
        keydown->card-hotkeys#handleKeydown
        turbo:morph@document->card-hotkeys#handleMorphComplete" } do %>
```

The assignee dropdown — the *same* controller, configured as a vertical menu that stays focus-quiet (Fizzy):

```erb
<%# A dropdown: vertical navigation stays on (default), focus-grabbing turned off %>
<%= tag.div class: "max-width full-width", data: {
      action: "turbo:before-cache@document->dialog#close dialog:show@document->navigable-list#reset keydown->navigable-list#navigate filter:changed->navigable-list#reset",
      controller: "filter navigable-list assignment-limit",
      dialog_target: "dialog",
      navigable_list_focus_on_selection_value: false,
      navigable_list_actionable_items_value: true } do %>
```

And the inner card list inside each column, generated by a *helper* — the configuration is written in Ruby, once, not hand-copied per column (Fizzy):

```ruby
# columns_helper.rb — every column's card list is built here; vertical-only,
# the mirror image of the horizontal outer container
tag.section(id: id, class: classes, tabindex: "0", "aria-selected": selected, data: data, **properties) do
  tag.div(class: "cards__transition-container", data: {
    controller: "navigable-list css-variable-counter",
    css_variable_counter_property_name_value: "--card-count",
    navigable_list_supports_horizontal_navigation_value: "false",
    navigable_list_prevent_handled_keys_value: "true",
    navigable_list_auto_select_value: "false",
    navigable_list_actionable_items_value: "true",
    navigable_list_only_act_on_focused_items_value: "true",
    card_hotkeys_disabled: hotkeys_disabled,
    action: "keydown->navigable-list#navigate"
  }, &block)
end
```

The controller exposes a whole **vocabulary of toggles**, each a Stimulus value with a default:

| Toggle | What it varies |
|---|---|
| `supports_vertical_navigation` / `supports_horizontal_navigation` | The axis: columns are horizontal-only, cards vertical-only |
| `focus_on_selection` | Focus-quiet menus (don't scroll the page as you arrow through a dropdown) vs focus-following lists |
| `has_nested_navigation` | Whether selecting an item activates a list inside it (§4) |
| `auto_select` / `auto_scroll` | Whether the first item selects on activation; whether selection scrolls into view |
| `actionable_items` / `only_act_on_focused_items` | Whether Enter "acts on" the selected item, and when |
| `prevent_handled_keys` | Whether handled keystrokes stop propagating |
| `selection_attribute` | Which attribute carries the cursor (defaults to `aria-selected`, §3) |

Two mechanics make a toggle vocabulary cheap to own (Hotwire docs). Defaults are declared inline in the controller — `static values = { autoScroll: { type: Boolean, default: true }, selectionAttribute: { type: String, default: "aria-selected" } }` — so a view writes an attribute only to *deviate* from the default, and most markup stays short. And defining `[name]ValueChanged()` makes Stimulus call it at initialization and on every subsequent change to the `data-*-value` attribute — including writes the controller didn't make, like a morph rewriting the attribute. Derive behavior from the value write itself instead of remembering to call a refresh method after each mutation; it's derive-don't-store (§3) applied to the toggles themselves.

**Not:** You will be tempted to write `CardListController`, `ColumnListController`, `MenuController` — a fork per list, each with its axis and rules hard-coded, "because they're slightly different." Don't. Three forks become four, "fix the arrow-key bug" means fixing it in four files, and the fifth list someone adds gets none of the fixes.

**Why:** **Config over forks.** The variation is data the one mechanism reads, exactly like a scope dispatched by a URL token. Count the edge cases this absorbs: every future list gets every fix for free, and the *rules* of each list are legible in the view where a Rails developer reads them — not buried in a JS class hierarchy.

---

## 3. The DOM attribute IS the state: `aria-selected` as the cursor

**When:** Any selectable list — a cursor, a highlight, a "current item."

**Do:** Don't keep "which item is selected" in a JS variable. Write it into the DOM as the ARIA attribute that already *means* selected, and let everything derive from that one write (Fizzy):

```javascript
// navigable_list_controller.js — selecting an item is ONE attribute write.
// selectionAttributeValue defaults to "aria-selected".
async selectItem(item, skipFocus = false) {
  await this.#selectCurrentElementInParent()

  this.#clearSelection()                                     // remove the attribute everywhere else
  item.setAttribute(this.selectionAttributeValue, "true")    // ← the cursor IS this attribute
  this.currentItem = item
  this.#refreshActiveDescendant()

  await nextFrame()

  if (this.autoScrollValue) { this.currentItem.scrollIntoView({ block: "nearest", inline: "nearest" }) }
  if (this.hasNestedNavigationValue) { this.#activateNestedNavigableList() }

  if (!skipFocus && this.focusOnSelectionValue) { this.currentItem.focus({ preventScroll: !this.autoScrollValue }) }
}
```

The CSS highlight targets `[aria-selected="true"]`. The screen reader announces the element with `aria-selected="true"` — that is the attribute's literal job. The glow and the announcement read the **same fact**, so they cannot drift. This is accessibility **by construction**: there is no separate "make it accessible" pass, because the semantic representation *is* the implementation. In nested lists (§4) it holds at every level — the column `<section>` carries the column cursor's `aria-selected`, the cards inside carry their own.

**Not:** You will be tempted to keep a `@selected` index plus a `.highlighted` CSS class you paint by hand — and add ARIA later, as a third copy. Don't. Three representations of one fact, all hand-synced, is exactly the bug class that fails accessibility audits: the sighted user sees card #4 glowing while the screen reader announces card #1.

**Why:** **The DOM attribute IS the state** — derive, don't store, pointed at client state. Selection isn't something the controller *remembers* and then *reflects* into the DOM; it's something the controller *writes into* the DOM once, and the highlight, the announcement, and the scroll all derive from the single write. A stored copy is a second source of truth, and flags lie — JS-side too.

---

## 4. Nested lists: declared, not wired

**When:** A navigable list contains navigable lists — columns containing card lists, a menu with submenus.

**Do:** Declare the outer list nesting-capable (`navigable_list_has_nested_navigation_value: true` in the ERB, as in §2) and let the controller find its related list by walking the DOM and asking Stimulus for the controller on the element it finds:

```javascript
// The idiom: never import or hold a reference to the other list's controller.
// Walk the DOM to the element, then ask Stimulus for its controller instance.
#navigableListFor(element) {
  return this.application.getControllerForElementAndIdentifier(element, "navigable-list")
}
```

Selecting a column activates the nested card list's selection; a keystroke on the inner list relays back up to its parent — both directions resolved through the DOM tree at the moment of use, never cached.

**Not:** You will be tempted to wire the two lists together imperatively — pass the child controller into the parent, hold references, build a registry. Don't. Cached references go stale the moment a morph or a frame reload replaces the element.

**Why:** The DOM tree already encodes the parent/child relationship — it's one more fact you derive instead of store. The nesting is declared in markup where it's visible, and because the lookup happens fresh each time, it survives any DOM replacement for free.

---

## 5. Outlets: declared wires between controllers

**When:** One controller needs to reach another — board-level hotkeys need "the card list that currently has focus."

**Do:** Declare the relationship as a Stimulus **outlet** — a CSS selector in the ERB, not a reference in JS. From the columns container in §2: `card_hotkeys_navigable_list_outlet: ".cards__transition-container"` declares "the card-hotkeys controller can reach every navigable-list matching that selector." The hotkeys controller then queries its outlets at the moment of use (Fizzy):

```javascript
// card_hotkeys_controller.js — which card is the user on?
// Ask the outlets; take the one that has focus.
get #selectedCard() {
  const focusedList = this.navigableListOutlets.find(list => list.hasFocus)
  if (!focusedList) return null

  const currentItem = focusedList.currentItem
  if (currentItem?.classList.contains("card") && !this.#hotkeysDisabled(focusedList)) {
    return { card: currentItem, controller: focusedList }
  }
  return null
}
```

**Not:** You will be tempted to `document.querySelector` your way to the other widget, or have one controller `import` and instantiate another. Don't. The selector hard-coded in JS is configuration in the wrong layer; the import is a hard dependency only a refactor can change.

**Why:** The outlet is a **declared wire**: the view says which elements are reachable, the framework hands the controller live instances, and re-wiring is an ERB edit. The wire from "a key fired at board level" to "the one card the user is on" is data the server rendered — same doctrine as everything else in this file.

---

## 6. Hotkeys: read the URL off the element, POST, know nothing

**When:** Keyboard shortcuts that act on domain objects — `[` to postpone the focused card, `]` to close it, `m` to self-assign.

**Do:** Keep the key table dumb. Each key maps to "read a URL off the focused element and POST to it." The entire key table (Fizzy):

```javascript
// card_hotkeys_controller.js — the whole keymap. No domain verbs anywhere.
#keyHandlers = {
  "["(event) { this.#postponeCard(event) },
  "]"(event) { this.#closeCard(event) },
  m(event) { this.#assignToMe(event) }
}

async #postponeCard(event) {
  const selection = this.#selectedCard
  if (!selection) return

  const url = selection.card.dataset.cardNotNowUrl   // ← read the URL off the card itself
  if (url) {
    event.preventDefault()
    await this.#performCardAction(url, selection)
  }
}
```

The URLs are stamped onto each card by the server, in ERB, using ordinary `*_path` helpers:

```erb
<%# cards/display/_preview.html.erb — the server decides what each key MEANS, per card %>
<% if card.open? %>
  <% card_data[:card_not_now_url] = card_not_now_path(card) %>
  <% card_data[:card_closure_url] = card_closure_path(card) %>
  <% card_data[:card_assign_to_self_url] = card_self_assignment_path(card) %>
<% end %>
```

And each of those paths is a REST resource: postponing is `create` on a `NotNow`, closing is `create` on a `Closure`, self-assigning is `create` on a `SelfAssignment`. Verb-as-noun, unchanged — the keyboard is just **one more client of the routing table** the mouse and the drag already use (see `03-controllers-routing.md` for the noun discipline).

**Not:** You will be tempted to write `"["(event) { postpone(this.selectedCard) }` — a handler that calls a domain method, with the route shape (or worse, a bespoke `/api/keyboard` endpoint) encoded in JS. Don't. The keyboard layer now *knows the domain*, reusing those keys for a different action means forking the handler, and you've created a second place that encodes what "postpone" means.

**Why:** **The URL carries the contract.** The JS transports "the user pressed `[` on this element" to an address the server chose; the routing table holds the meaning. Stamp a different URL on a different kind of card and the same key does something different with zero JS changes. The hotkeys controller stays shippable-in-a-gem generic.

---

## 7. Capability subtracted in markup

**When:** A surface should support navigation but not actions — you can arrow through the "Done" tray, but `]` must not re-close a closed card.

**Do:** Subtract the capability in the view, as data, where the person building that surface can see it:

```erb
<%# boards/show/_closed.html.erb — the Done tray: navigable, but hotkey-inert %>
<%= column_tag id: "closed-cards", name: "Done", hotkeys_disabled: true, ... %>
```

The helper stamps `card_hotkeys_disabled: true` onto the list (§2's helper shows the slot), and the controller merely reads the flag — the `!this.#hotkeysDisabled(focusedList)` check in §5's `#selectedCard`.

**Not:** You will be tempted to special-case the trays inside the controller: `if (list.id === "closed-cards") return`. Don't. That's domain knowledge (which lists are action-exempt) leaking into the generic mechanism, invisible from the view.

**Why:** **Capability by subtraction**, the markup edition: the default is capable, the exemption is one declared attribute. The exemption lives next to the thing it exempts, and the controller needs no update when the next inert tray ships.

---

## 8. Cursor rehoming after a morph

**When:** A keyboard action removes the very row the cursor sits on — you postpone a card, the server responds, a morph deletes that card's element. (Morph mechanics: `06-morphing-live-updates.md`.)

**Do:** Remember only the index, wait for the morph with a *bounded* race, then re-derive a sane cursor from the fresh DOM (Fizzy):

```javascript
// card_hotkeys_controller.js — act, wait for the morph (but never hang), re-derive.
async #performCardAction(url, selection) {
  const { controller } = selection
  const visibleItems = controller.visibleItems
  const currentIndex = visibleItems.indexOf(selection.card)
  const wasLastItem = currentIndex === visibleItems.length - 1

  // The board wires turbo:morph@document->card-hotkeys#handleMorphComplete in its markup;
  // that handler resolves this promise when the morph actually finishes.
  this.morphCompletePromise = new Promise(resolve => {
    this.morphCompleteResolver = resolve
  })

  await post(url, { responseKind: "turbo-stream" })

  // Wait for the REAL morph signal, but bound it: 200ms fallback so the keyboard can never hang
  await Promise.race([
    this.morphCompletePromise,
    new Promise(resolve => setTimeout(resolve, 200))
  ])

  // Re-derive a sane cursor from the NEW list
  const newVisibleItems = controller.visibleItems
  if (newVisibleItems.length === 0) {
    controller.clearSelection()                      // column emptied → clear
    return
  }

  if (wasLastItem) {
    controller.selectLast()                          // was at the bottom → new last
  } else {
    const nextIndex = Math.min(currentIndex, newVisibleItems.length - 1)   // clamp
    if (newVisibleItems[nextIndex]) {
      await controller.selectItem(newVisibleItems[nextIndex])              // the card that slid up
    }
  }
}
```

Three judgments: **remember the index before acting** (the only state that crosses the round-trip, read from the live list, not stored); **race the real `turbo:morph` signal against a 200ms timeout** so the common case is exact and the worst case is bounded; **re-derive from the fresh DOM** — same index (the card that slid into the slot), clamp to last if you were at the bottom, clear if the list emptied.

**Not:** You will be tempted to re-select the first item after every action (yanks the user to the top while they work down a column), to leave the cursor alone (it now points at a deleted node; the keyboard is stranded), or to wait on the morph event with no bound (an action that triggers no morph hangs the keyboard forever). Don't, three times.

**Why:** This is `aria-selected`-as-cursor (§3) surviving a live refresh: the floor fell out, and the cursor steps to where the floor now is. Re-derive, don't restore. The bounded race is the liveness seatbelt — trust the happy path, bound the unhappy one.

---

## 9. Form widgets that stay plain-Rails on the wire

**When:** A rich form control — multi-select combobox, single-select dropdown, anything fancier than a bare input — needs to report its selection to the server.

**Do:** **The client invents no wire format.** The widget's entire job is to materialize ordinary form inputs inside a real form; `params` parses them like it's parsed forms since 2004. The blueprint for those inputs is a server-rendered `<template>` — an inert HTML fragment, parsed but not submitted, until cloned into the live document (Fizzy):

```erb
<%# filters/settings/_assignees.html.erb — the multi-select "Assigned to…" filter.
    The <template> is the hinge: the SERVER authors the field name and its array-ness. %>
<%= tag.div class: "quick-filter",
      data: {
        controller: "dialog filter multi-selection-combobox",
        multi_selection_combobox_no_selection_label_value: "Assigned to…",
        multi_selection_combobox_label_prefix_value: "Assigned to" } do %>
    <button type="button" class="btn input input--select" data-action="click->dialog#toggle:stop">
      <span class="overflow-ellipsis" data-multi-selection-combobox-target="label"></span>
    </button>

    <template data-multi-selection-combobox-target="hiddenFieldTemplate">
      <%= hidden_field_tag "assignee_ids[]", nil %>
    </template>
    <%# ...the checkable list of people follows... %>
<% end %>
```

The widget clones that blueprint once per selection and fills in the value — that's all it does:

```javascript
// multi_selection_combobox_controller.js — stamp out the server's blueprint per selection
#addHiddenFields() {
  this.#selectedValues().forEach(value => {
    const [ field ] = this.hiddenFieldTemplateTarget.content.cloneNode(true).children
    field.removeAttribute("id")
    field.value = value
    this.element.appendChild(field)
  })
}
```

Select Alice, Bob, and Carol, and the form literally contains — indistinguishable from three hand-typed checkboxes:

```html
<input type="hidden" name="assignee_ids[]" value="4">
<input type="hidden" name="assignee_ids[]" value="9">
<input type="hidden" name="assignee_ids[]" value="12">
```

On the server, ordinary strong parameters read it with **zero glue**:

```ruby
# The same side that authored the field name writes the permit list that reads it
PERMITTED_PARAMS = [
  :assignment_status,
  :indexed_by,
  assignee_ids: [],     # ← the standard "permit an array" idiom; params[:assignee_ids] == ["4","9","12"]
  tag_ids: [],
  terms: []
]
```

**Single-select is the same trick with a scalar name.** The status dropdown's template is `hidden_field_tag :indexed_by` — no `[]` — and the controller keeps exactly one cloned field, rewriting its `value` as the selection changes. The widget's single-vs-multi distinction **IS** Rails' scalar-vs-array param distinction (`name` vs `name[]`): one fact, expressed once, not two facts kept in sync.

**Not:** You will be tempted to have the widget POST a bespoke JSON body — `{"assignees":[4,9,12]}` — and hand-parse it server-side with `JSON.parse` and `is_a?(Array)` checks. Don't. You've invented a wire format that exists only in your head and that one parser; rename a key on one side and the other silently reads `nil`. You've thrown away `permit`, array coercion, and (on any mutating submit) the form-level CSRF token Rails stamps automatically. You will also be tempted to `createElement` the hidden inputs in JS — don't: the moment the client builds the input, the client owns the field's name and array-shape, and that knowledge now lives in two files that drift. Render the blueprint on the server; the client copies a decision, it never makes one.

**Why:** Count the edge cases `permit(assignee_ids: [])` absorbs for free: array coercion, scalar-vs-array, the whitelist, CSRF on mutating forms — all because the widget made real inputs and let `params` do its job. The field name is authored exactly once, **by the side that also writes the permit list reading it**. The widget got fancy; the wire stayed boring.

---

## 10. `requestSubmit()`, never `submit()`

**When:** Any code-triggered form submission — a widget that submits on change, a form that fires itself.

**Do:** Fizzy's entire `form` controller method:

```javascript
// form_controller.js — the one correct way to submit a form from code
submit() {
  this.element.requestSubmit()
}
```

**Not:** You will be tempted to call `form.submit()` — it looks identical. Don't. Raw `submit()` bypasses HTML's native validation **and** bypasses Turbo: the browser does a raw full-page navigation and every Hotwire benefit evaporates.

**Why:** `requestSubmit()` behaves exactly as if a real submit button were clicked — native `required`/validation fires, the `submit` event dispatches, Turbo intercepts. One word is the difference between "I stayed inside Rails-and-Hotwire" and "I left." The widget triggers a *real* submission; it never simulates one.

---

## 11. `data-action` pipelines: intent declared in ERB

**When:** One user gesture must trigger several controllers — picking a combobox option should close the dialog, record the change, and submit the form.

**Do:** Author the chain as a `data-action` pipeline in the markup, read left to right (Fizzy):

```erb
<%# A checkable option in the assignee combobox: four controllers, one declared pipeline,
    no controller imports or calls another %>
<button type="button" class="btn popup__btn"
        data-action="dialog#close multi-selection-combobox#change filter-settings#change form#submit">
```

Click → the dialog closes → the combobox materializes its hidden inputs (§9) → filter-settings reacts → the form `requestSubmit`s (§10). Each controller stays ignorant of the others; the *sequence* is data the server renders.

Notice the descriptors name no event: an event-less descriptor binds the element's *default* event — `button`/`a` → `click`, `input`/`textarea` → `input`, `select` → `change`, `form` → `submit`, `details` → `toggle` (Hotwire docs). That's why this pipeline fires on click here — and why the same shorthand pasted onto an `<input>` fires on every keystroke. Write the event explicitly when in doubt.

**Not:** You will be tempted to have the combobox hold a reference to the form and call `form.submit()` directly — a hard dependency baked into JS. Don't. Re-wiring "what happens when you pick someone" should be an ERB attribute edit, not a refactor of two JS classes.

**Why:** Declare intent as data on the wire; let the framework route it. Both 37signals products route widget intent as named events rather than direct calls — Campfire keeps an internal event bus where controllers `dispatch` events others listen for; Fizzy lifts the wiring all the way up into the `data-action` attribute the server renders, which makes the contract readable and editable in ERB. When both products reach for the same move, it's doctrine.

---

## 12. Behavior on Turbo's published lifecycle: wrap `event.detail.render`

**When:** A live update arriving over a stream needs client polish — autoscroll to the new row, play a sound, trim excess rows — but only sometimes (never yank the scroll while the user is reading history), and the broadcast must stay dumb: no scroll metadata, no sound flag, nothing. The model never learns a UI exists.

**Do:** Keep the wire a plain HTML append and bolt every behavior onto Turbo's own published event, `turbo:before-stream-render`. The subscription is the same declarative action string as §11 — pointed at a framework lifecycle event instead of a user gesture, no `addEventListener` anywhere (Campfire):

```ruby
# messages_helper.rb — the whole wiring, declared next to the markup it serves
def messages_actions
  "turbo:before-stream-render@document->messages#beforeStreamRender keydown.up@document->messages#editMyLastMessage"
end
```

The handler first guards that the incoming stream targets *its own* container — the event fires at `document` for every stream on the page — then pulls Turbo's render function out of `event.detail` and **wraps** it (Campfire):

```javascript
// messages_controller.js — autoscroll → render → reposition / sound / trim,
// or, if the user is scrolled up, leave them alone and reveal the pill
async beforeStreamRender(event) {
  const target = event.detail.newStream.getAttribute("target")
  if (target === this.messagesTarget.id) {           // not our container → not our business
    const render = event.detail.render
    const upToDate = this.#paginator.upToDate
    if (upToDate) {
      event.detail.render = async (streamElement) => {
        const didScroll = await this.#scrollManager.autoscroll(false, async () => {
          await render(streamElement)                 // Turbo still performs the actual append
          await nextEventLoopTick()
          this.#positionLastMessage()
          this.#playSoundForLastMessage()
          this.#paginator.trimExcessMessages(true)
        })
        if (!didScroll) {
          this.latestTarget.hidden = false            // reading history → "jump to newest" pill
        }
      }
    } else {
      this.latestTarget.hidden = false
    }
  }
}
```

Read the division of labor: the server broadcast carries zero UI knowledge — it's the same dumb append every other screen receives. All the nuance — "were you near the bottom?", the sound, the trim, the pill — lives client-side, layered onto the transport through an event Turbo publishes anyway. And when one *kind* of update genuinely needs different treatment (an edit must not scroll the way a new message does), the server stamps **intent as data on the wire** — `attributes: { maintain_scroll: true }` riding on the stream element — and this handler reads the attribute off `event.detail.newStream` and behaves accordingly. The stamping side of that contract is `05-turbo-frames-streams.md`'s "Intent as data on the wire"; this section is the Stimulus that honors it.

(A target mechanic worth knowing while reading handlers like this: a singular `this.fooTarget` *throws* if no matching element exists in the controller's scope — fine for required targets like `messagesTarget` here, but guard optional targets with `this.hasFooTarget` before touching them, and use `this.fooTargets` when several may match (Hotwire docs).)

**Not:** You will be tempted to make the broadcast carry the behavior — scroll instructions in the stream payload, a `"playSound": true` field in JSON, a bespoke stream action per nuance. Don't: the model now knows a UI exists, and every new client behavior means touching the broadcast. You will be tempted to `addEventListener("turbo:before-stream-render", …)` in `connect()` — don't; the declarative string is discoverable in the markup and Stimulus tears it down for you. And you will be tempted to skip the target guard — don't: the event fires for *every* stream render on the page, and an unguarded handler autoscrolls the chat because an unrelated sidebar updated.

**Why:** The transport stays generic — still just HTML at a target — so you can rewrite the scroll logic without touching the model, and vice versa. Wrapping `event.detail.render` (rather than reacting after the fact) puts behavior on *both sides* of the DOM write: measure before (near the bottom?), act after (position, sound, trim) — one ordered sequence, no race against the append. The model owns the consequence; the client owns the *presentation* of the consequence, attached at the seam the framework already published.

---

## 13. Self-submitting, self-erasing forms

**When:** A form with no user gesture at all — silently correcting a stale timezone, a one-shot confirmation.

**Do:** Attach a controller that submits on `connect()` and removes the form on confirmed success — the whole Turbo lifecycle as one self-erasing object (Fizzy):

```javascript
// auto_submit_controller.js — connect → submit → on success, delete yourself
connect() {
  this.element.addEventListener("turbo:submit-end", this.#handleSubmitEnd.bind(this), { once: true })
  this.submit()
}

submit() {
  this.#markAsBusy()
  this.#disableSubmit()
  this.element.requestSubmit()
}

#handleSubmitEnd(event) {
  if (event.detail.success) {
    this.element.remove()          // success → the form's job is done; it disappears
  } else {
    this.#clearBusy()
    this.#enableSubmit()           // failure → re-enable so it can retry
  }
}
```

Used at its minimum — a form that exists only long enough to fire (Fizzy):

```erb
<%# Browser timezone differs from the saved one? A buttonless form corrects it silently.
    Still a REAL PUT with a real hidden_field_tag, real params, real CSRF token. %>
<%= auto_submit_form_with url: my_timezone_path, method: :put do %>
  <%= hidden_field_tag :timezone_name, timezone_from_cookie.name %>
<% end %>
```

**Not:** You will be tempted to skip the form entirely and `fetch()` a hand-built request from JS. Don't. You'd reimplement CSRF, lose `params`, and create another bespoke wire format (§9's sin in a different hat).

**Why:** Self-submitting doesn't make the form special — it's the same boring Rails form, fired by `connect()` instead of a click, parsed by ordinary `params`. And the form's own `turbo:submit-end` is the deletion signal, so there's no controller waiting on it and no cleanup code: the lifecycle *is* the state machine.

---

## 14. Additive decorator helpers: never clobber `data-controller`

**When:** A helper attaches a Stimulus controller to a form (`auto-submit`, a native-bridge adapter) — and the caller may already have controllers and actions on that form.

**Do:** Write a decorator around `form_with` that **merges its contribution onto whatever's already there** (Fizzy):

```ruby
# forms_helper.rb — additive decorators. The helper's ONLY job is the merge.
def auto_submit_form_with(**attributes, &)
  data = attributes.delete(:data) || {}
  data[:controller] = "auto-submit #{data[:controller]}".strip   # PREPEND, never replace

  if block_given?
    form_with **attributes, data: data, &
  else
    form_with(**attributes, data: data) { }
  end
end

def bridged_form_with(**attributes, &)
  data = attributes.delete(:data) || {}
  controllers = [ data[:controller], "bridge--form" ].compact.join(" ").strip
  actions = [
    data[:action],
    "turbo:submit-start->bridge--form#submitStart",
    "turbo:submit-end->bridge--form#submitEnd"
  ].compact.join(" ").strip

  data[:controller] = controllers      # caller's controllers survive; ours are ADDED
  data[:action] = actions              # caller's actions survive; ours are ADDED
  form_with(**attributes, data: data, &)
end
```

`compact.join(" ")` is the whole pattern in one expression: take the caller's value (which may be `nil`), drop the nil, append your own, join. `compact` makes "the caller passed nothing" and "the caller passed three actions" the same code path — no `if data[:action].present?` branch.

**Not:** You will be tempted to write `data: { controller: "auto-submit form filter-settings" }` at every call site — the full list by hand. Don't. The day you add a controller and forget one call site, a widget silently goes dead; the day two helpers both set `data[:controller]` by assignment, the second clobbers the first.

**Why:** Independent Stimulus features must compose on one form without knowing about each other — that's what keeps each controller generic (§1). The call site reads as intent (`auto_submit_form_with`); the merge is the helper's problem, solved once. (Helpers-as-vocabulary is `04-views-helpers.md`'s beat; this is its Stimulus-glue special case.)

---

## 15. Autosave: the timer IS the dirty flag

**When:** A form should save itself after a pause in typing, and flush on the way out.

**Do:** Keep zero extra flags. "Is a save scheduled?" and "is there unsaved work?" are the same question — so the dirty bit *is* the pending timer (Fizzy):

```javascript
// auto_save_controller.js — no dirty boolean exists. The timer IS the dirty bit.
export default class extends Controller {
  #timer

  disconnect() {
    this.submit()                   // leaving the page / node morphed out → flush, for free
  }

  async submit() {
    if (this.#dirty) { await this.#save() }
  }

  change(event) {
    if (event.target.form === this.element && !this.#dirty) { this.#scheduleSave() }
  }

  #scheduleSave() {
    this.#timer = setTimeout(() => this.#save(), AUTOSAVE_INTERVAL)
  }

  async #save() {
    this.#resetTimer()              // clears the timer → no longer dirty
    await submitForm(this.element)
  }

  get #dirty() {
    return !!this.#timer            // "is a save pending?" IS "is there unsaved work?"
  }
}
```

**Not:** You will be tempted to keep a `dirty` boolean — set on keystroke, checked before save, cleared after. Don't. The flag and the work it describes are two states that drift the instant a save races a keystroke.

**Why:** Derive, don't store; flags lie. And look at `disconnect()`: Stimulus calls it exactly when the form leaves the page — navigation, the card closing, a morph removing the node — so "save on the way out" falls out of the framework's own teardown. The lifecycle gives you the flush for free; one source of truth gives you nothing to keep in sync.

The lifecycle rule underneath the free flush (Hotwire docs): `initialize()` runs once per controller instantiation; `connect()` and `disconnect()` run *every* time the element enters or leaves the document — a Turbo cache restore or a morph replacing the node re-fires `connect()`. So pair them: anything acquired in `connect()` — a timer, a polling loop, a manually attached listener — must be released in `disconnect()`, or the removed element keeps working in the background. The canonical failure is a content loader whose refresh interval starts in `connect()` and is never cleared: the element disappears, and the orphaned timer keeps issuing HTTP requests forever.

---

## 16. localStorage drafts: derive, don't store, at the client

**When:** Unsaved text must survive closing the editor, a navigation, or a live morph replacing the editor node.

**Do:** One localStorage slot is the single source of truth for unsaved text; the visible editor is *derived* from it. Three rules carry it (Fizzy):

```javascript
// local_save_controller.js — per-resource key, clear only on CONFIRMED success,
// re-derive after every morph
static values = { key: String }

connect() { this.restoreContent() }

submit({ detail: { success } }) {
  if (success) { this.#clear() }     // clear ONLY on a confirmed-successful turbo:submit-end
}

save() {
  const content = this.inputTarget.value
  if (content) { localStorage.setItem(this.keyValue, content) }
  else { this.#clear() }
}

async restoreContent() {
  await nextFrame()
  let saved = localStorage.getItem(this.keyValue)
  if (saved) { this.inputTarget.value = saved /* then re-fire the change event */ }
}
```

The configuration, as always, is in the view: the key is **per-resource** (`local_save_key_value: "card-#{@card.id}"` on the card editor, `"comment-#{card.id}"` on its comment box) so drafts can't collide; and the editor wires `turbo:morph-element->local-save#restoreContent`, so when a live refresh morphs the editor, the draft re-restores itself instead of being lost.

One detail is load-bearing: after restoring, **re-fire the change event**. Autosave (§15) and validation listen for the editor's change event, not for silent property writes — set the value silently and the restored draft is invisible to everything downstream. Client state flows through declared signals, not hidden writes.

**Not:** You will be tempted to clear the draft optimistically on submit (a failed save now eats the user's work), or never (a stale draft clobbers a saved record on next open), or to use one global key (two open cards overwrite each other's drafts). Don't, three times.

**Why:** This is the server-side durability discipline at the client: don't forget the fact until the consequence is confirmed durable (`event.detail.success`), keep one source of truth, and after any DOM upheaval re-derive the visible state from it. Derive, don't store — applied to the browser.

---

## 17. Asides: progressive enhancement, the DOM as source of truth, speaking Rails off the wire

Three grace notes that rhyme with everything above.

**JS-only affordances ship hidden and reveal themselves.** A control that only exists because JavaScript does — a copy-to-clipboard button — defaults to hidden in CSS; the controller feature-tests the API in `connect()` and adds a class to reveal it, so a browser without the API (or a page whose JS never loaded) shows a working baseline instead of a dead button (Hotwire docs). And the class *name* isn't hard-coded in JS: declare `static classes = [ "supported" ]`, stamp `data-clipboard-supported-class="clipboard--supported"` in the markup, and the controller adds `this.supportedClass` — the §1 doctrine (configuration lives in ERB, not JS) applied to class strings. When a controller must toggle a CSS class, the markup names the class; the controller only decides *when*.

**Autoresize without measuring.** To grow a textarea to fit its content, don't compute heights in JS. The controller's entire job is to keep one wrapper `data-*` attribute equal to the textarea's value; CSS sizes an invisible clone off that attribute and the layout falls out. JS syncs one fact into the DOM; the stylesheet derives the rest. The DOM attribute is the state, again.

**Port Rails helpers; don't invent vocabulary.** When Fizzy's combobox needs the label "Assigned to Alice, Bob, or Carol," it calls `toSentence(labels, { two_words_connector: " or ", last_word_connector: ", or " })` — a hand-rolled JS mirror of Rails' `Array#to_sentence`, down to the option names. Even display logic that never touches the wire declines to invent something new. **Speak Rails, even off the wire** — the widget never grows a vocabulary the rest of the app doesn't share, and any Rails developer reads the JS call sight-unseen.

---

## 18. The drag controller's client-side contract (recap)

The full drag-and-drop stack — derived order, drop-as-REST, the morph reply — is `06-morphing-live-updates.md`'s. What belongs *here* is the shape of its client contract, because it's this file's doctrine at full strength. The one generic drag controller knows exactly two things, both stamped on the DOM by the server:

1. **The URL with a hole in it.** Each drop container carries `data-drag-and-drop-url` holding a server-rendered path with an `__id__` placeholder. On drop, the controller swaps `__id__` for the dragged element's id and POSTs an empty body. It does not know whether that closes, postpones, or moves anything — the route is the meaning.
2. **One server-stamped placement bit.** The optimistic insert (move the node *before* the server answers) is positioned by reading a single boolean attribute (`data-drag-and-drop-top`, present iff the card is pinned-to-top) — the server telling the client which side of its one sort axis the card falls on, so the guess can't disagree with the truth and the morph reply is a no-op.

Generic mechanism, ERB configuration, server-owned meaning: the same three-line doctrine as §1, carrying the most tactile interaction in the product.

---

## 19. Red flags → fixes

| Red flag in code you're writing or reviewing | The fix |
|---|---|
| A Stimulus controller named after a domain noun doing generic work (`CardListController`, `AssigneePickerController`) | One generic controller (`navigable-list`, `combobox`); the domain enters as `data-*-value` config in ERB (§2) |
| `@selected` index, `.highlighted` class, ARIA added "later" | The cursor is `aria-selected`, written once; CSS and screen reader derive from it (§3) |
| Controllers importing each other, cached references to sibling controllers | `getControllerForElementAndIdentifier` walking the DOM (§4); outlets declared as selectors in ERB (§5) |
| A hotkey handler calling `postpone(card)` or encoding a route shape | Key table reads a server-stamped `data-*-url` off the element and POSTs (§6) |
| `if (list.id === "closed-cards") return` inside a controller | Capability subtracted in markup: `card_hotkeys_disabled: true` on the surface (§7) |
| After an action, cursor re-set to first item — or left on a deleted node — or an unbounded `await` on a morph event | Remember the index, `Promise.race` the real signal vs a 200ms fallback, re-derive: clamp / last / clear (§8) |
| Widget POSTs JSON; controller has `JSON.parse(request.body.read)` / `is_a?(Array)` checks | Widget clones a server-rendered `<template>` of `hidden_field_tag`s; `permit(ids: [])` reads it (§9) |
| `name="assignee_ids[]"` built with `createElement` in JS | The field name is authored once, server-side, in the `<template>` — by the side that writes the permit list (§9) |
| `form.submit()` anywhere | `form.requestSubmit()` — native validation + Turbo interception (§10) |
| One controller calling another's method to sequence a gesture | `data-action="a#x b#y form#submit"` pipeline in the ERB (§11) |
| Broadcast carries scroll/sound/UI flags; `addEventListener("turbo:before-stream-render")` in `connect()`; a document-level stream handler with no target guard | Dumb append on the wire; declarative `turbo:before-stream-render@document->…` action wraps `event.detail.render`, guarded on `event.detail.newStream`'s target (§12) |
| A `fetch()` for something a form could do; cleanup code waiting for a one-shot form | Self-submitting form: `connect()` → `requestSubmit()` → `remove()` on successful `turbo:submit-end` (§13) |
| `data[:controller] = "auto-submit"` (assignment) in a helper; full controller lists hand-written at call sites | Decorator helpers that merge: `"auto-submit #{data[:controller]}".strip`, `[data[:action], "..."].compact.join(" ")` (§14) |
| A `dirty` boolean beside the work it describes | The pending timer IS the dirty bit; `disconnect()` flushes (§15) |
| A timer, polling loop, or manual listener started in `connect()` with no `disconnect()` teardown | Pair acquire/release: `connect()`/`disconnect()` fire every time the element enters/leaves the document, and an unreleased resource outlives its element (§15) |
| Draft cleared on submit (not on *confirmed* success); one global draft key; draft lost after a morph | Per-resource key, clear only when `turbo:submit-end` reports success, `turbo:morph-element` → re-restore (§16) |
| JS measuring/computing what CSS can derive; a bespoke JS formatting vocabulary | One synced `data-*` attribute + CSS; port the Rails helper (`toSentence`) instead of inventing (§17) |

The summary judgment, for when you're tempted by React anyway: everything in this file — keyboard-first navigation with screen-reader-correct selection, domain-aware hotkeys, nested focus management, multi-select comboboxes, scroll-aware live updates with sound and a "jump to newest" pill, autosave, crash-safe drafts, optimistic drag-and-drop — runs on a handful of generic Stimulus controllers configured from ERB, with the server owning every field name, URL, and capability. There is no client state store because the DOM is the state; there is no API contract because the wire carries HTML and form params; there is no second renderer to keep in agreement with the first. That's not a workaround for not having React. It's the deletion of the entire problem React exists to manage.
