# Stimulus & Rich Widgets the 37signals Way

Read before writing any client-side behavior — keyboard nav, hotkeys, combobox, multi-select, autosave, drafts, auto-submitting forms — especially when richness makes you think "this needs React." It doesn't.

Scope: this file owns the Stimulus layer. Morph mechanics, `broadcasts_refreshes`, multiplayer, and the full drag-and-drop stack live in `06-morphing-live-updates.md`. The server-vs-client worldview lives in `00-frontend-first-principles.md`.

---

## 1. The doctrine

One division of labor, applied everywhere:

| Layer | Owns |
|---|---|
| **Stimulus (JS)** | A generic mechanism — "navigate a list," "submit on connect," "save after a pause." No domain noun, route, or field name. |
| **ERB / helpers** | The configuration — `data-*-value` toggles, `data-action` pipelines, stamped URLs, `<template>` blueprints, capability flags. |
| **Server** | All domain knowledge — what a hotkey means, what a field is named, what a drop does, who's allowed. |

The test: **could this controller ship in a gem, with zero knowledge of your app?** If it knows a route, model, field name, or what a key "means," domain knowledge has leaked client-side. The payoff: a Rails dev builds rich keyboard-driven, multi-select, autosaving UIs by editing data attributes in views — without writing JavaScript.

---

## 2. Config over forks: one controller, a vocabulary of toggles

**When:** Several UI surfaces share a mechanism but differ in the rules — a vertical card list, a horizontal column row, a dropdown, all "navigable."

**Do:** Write ONE generic controller; express every variation as Stimulus values in the view or a helper. Fizzy has one `navigable-list` for cards, columns, and menus.

The board's columns (horizontal, nesting card lists):

```erb
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

The assignee dropdown — same controller, vertical menu, focus-quiet:

```erb
<%= tag.div data: {
      controller: "filter navigable-list assignment-limit",
      navigable_list_focus_on_selection_value: false,
      navigable_list_actionable_items_value: true } do %>
```

The toggle vocabulary (each a Stimulus value with a default): axis (`supports_vertical_navigation` / `supports_horizontal_navigation`), `focus_on_selection`, `has_nested_navigation`, `auto_select` / `auto_scroll`, `actionable_items` / `only_act_on_focused_items`, `prevent_handled_keys`, `selection_attribute`.

Two mechanics make toggles cheap. Declare defaults inline so a view writes an attribute only to *deviate*: `static values = { autoScroll: { type: Boolean, default: true }, selectionAttribute: { type: String, default: "aria-selected" } }`. And defining `[name]ValueChanged()` makes Stimulus call it at init and on every change to the attribute — including writes the controller didn't make, like a morph. Derive behavior from the value write instead of remembering to refresh.

**Why:** Forks multiply — three become four, "fix the arrow-key bug" means four files, the fifth list gets none of the fixes. With config, every future list gets every fix free, and the rules are legible in the view.

---

## 3. The DOM attribute IS the state: `aria-selected` as the cursor

**When:** Any selectable list — a cursor, highlight, "current item."

**Do:** Don't keep "which item is selected" in a JS variable. Write it into the DOM as the ARIA attribute that already *means* selected; derive everything from that one write.

```javascript
// navigable_list_controller.js — selecting is ONE attribute write.
async selectItem(item, skipFocus = false) {
  await this.#selectCurrentElementInParent()
  this.#clearSelection()                                     // remove everywhere else
  item.setAttribute(this.selectionAttributeValue, "true")    // ← the cursor IS this attribute
  this.currentItem = item
  this.#refreshActiveDescendant()
  await nextFrame()
  if (this.autoScrollValue) { this.currentItem.scrollIntoView({ block: "nearest", inline: "nearest" }) }
  if (this.hasNestedNavigationValue) { this.#activateNestedNavigableList() }
  if (!skipFocus && this.focusOnSelectionValue) { this.currentItem.focus({ preventScroll: !this.autoScrollValue }) }
}
```

CSS targets `[aria-selected="true"]`; the screen reader announces the same element. The glow and the announcement read the **same fact**, so they can't drift — accessibility by construction, no separate "make it accessible" pass.

**Why:** A `@selected` index + a hand-painted `.highlighted` class + ARIA-added-later is three copies of one fact, hand-synced — the bug class that fails accessibility audits (sighted user sees card #4 glowing, screen reader announces card #1). Derive, don't store, pointed at client state.

---

## 4. Nested lists: declared, not wired

**When:** A navigable list contains navigable lists — columns containing card lists.

**Do:** Declare the outer list nesting-capable (`navigable_list_has_nested_navigation_value: true`, §2); let the controller find its related list by walking the DOM and asking Stimulus for the controller on it:

```javascript
#navigableListFor(element) {
  return this.application.getControllerForElementAndIdentifier(element, "navigable-list")
}
```

Resolved through the DOM tree at the moment of use, never cached — cached references go stale the moment a morph replaces the element. The DOM tree already encodes the parent/child relationship; the lookup survives any DOM replacement free.

---

## 5. Outlets: declared wires between controllers

**When:** One controller needs to reach another — board hotkeys need "the card list that currently has focus."

**Do:** Declare the relationship as a Stimulus **outlet** — a CSS selector in the ERB. `card_hotkeys_navigable_list_outlet: ".cards__transition-container"` (§2) declares which navigable-lists the hotkeys controller can reach. Query outlets at the moment of use:

```javascript
// card_hotkeys_controller.js — which card is the user on? Ask the outlets.
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

**Why:** A `document.querySelector` in JS is configuration in the wrong layer; an `import` of another controller is a hard dependency only a refactor changes. The outlet is a declared wire — re-wiring is an ERB edit.

---

## 6. Hotkeys: read the URL off the element, POST, know nothing

**When:** Keyboard shortcuts acting on domain objects — `[` to postpone, `]` to close, `m` to self-assign.

**Do:** Each key reads a URL off the focused element and POSTs to it. No domain verbs:

```javascript
// card_hotkeys_controller.js — the whole keymap.
#keyHandlers = {
  "["(event) { this.#postponeCard(event) },
  "]"(event) { this.#closeCard(event) },
  m(event) { this.#assignToMe(event) }
}

async #postponeCard(event) {
  const selection = this.#selectedCard
  if (!selection) return
  const url = selection.card.dataset.cardNotNowUrl   // ← read the URL off the card
  if (url) {
    event.preventDefault()
    await this.#performCardAction(url, selection)
  }
}
```

The server stamps the URLs in ERB with ordinary `*_path` helpers, each a REST resource (postpone = `create` on `NotNow`, etc.):

```erb
<% if card.open? %>
  <% card_data[:card_not_now_url] = card_not_now_path(card) %>
  <% card_data[:card_closure_url] = card_closure_path(card) %>
  <% card_data[:card_assign_to_self_url] = card_self_assignment_path(card) %>
<% end %>
```

**Why:** The URL carries the contract. The keyboard is one more client of the routing table the mouse and drag already use (see `03-controllers-routing.md`). Stamp a different URL on a different card and the same key does something different with zero JS changes.

---

## 7. Capability subtracted in markup

**When:** A surface supports navigation but not actions — arrow through the "Done" tray, but `]` must not re-close a closed card.

**Do:** Subtract the capability in the view, as data:

```erb
<%= column_tag id: "closed-cards", name: "Done", hotkeys_disabled: true, ... %>
```

The helper stamps `card_hotkeys_disabled: true`; the controller reads the flag (the `!this.#hotkeysDisabled(focusedList)` check in §5).

**Why:** `if (list.id === "closed-cards") return` is domain knowledge leaking into the generic mechanism, invisible from the view. The default is capable; the exemption is one declared attribute next to the thing it exempts.

---

## 8. Cursor rehoming after a morph

**When:** A keyboard action removes the row the cursor sits on — postpone a card, the morph deletes its element.

**Do:** Remember only the index, race the real morph signal against a bounded timeout, re-derive a sane cursor from the fresh DOM:

```javascript
// card_hotkeys_controller.js
async #performCardAction(url, selection) {
  const { controller } = selection
  const visibleItems = controller.visibleItems
  const currentIndex = visibleItems.indexOf(selection.card)
  const wasLastItem = currentIndex === visibleItems.length - 1

  // markup wires turbo:morph@document->card-hotkeys#handleMorphComplete to resolve this
  this.morphCompletePromise = new Promise(resolve => { this.morphCompleteResolver = resolve })

  await post(url, { responseKind: "turbo-stream" })

  // wait for the real morph, but bound it: 200ms fallback so the keyboard can't hang
  await Promise.race([
    this.morphCompletePromise,
    new Promise(resolve => setTimeout(resolve, 200))
  ])

  const newVisibleItems = controller.visibleItems
  if (newVisibleItems.length === 0) { controller.clearSelection(); return }   // emptied
  if (wasLastItem) {
    controller.selectLast()                                                   // was at bottom
  } else {
    const nextIndex = Math.min(currentIndex, newVisibleItems.length - 1)      // clamp
    if (newVisibleItems[nextIndex]) { await controller.selectItem(newVisibleItems[nextIndex]) }
  }
}
```

Three judgments: remember the index before acting (the only state crossing the round-trip); race the real `turbo:morph` signal against a 200ms timeout (common case exact, worst case bounded); re-derive from the fresh DOM (same index = the card that slid up, clamp to last, clear if emptied).

**Why:** This is `aria-selected`-as-cursor (§3) surviving a live refresh: re-derive, don't restore. Re-selecting the first item yanks the user to the top; leaving the cursor strands it on a deleted node; an unbounded `await` hangs the keyboard if the action triggers no morph.

---

## 9. Form widgets that stay plain-Rails on the wire

**When:** A rich form control — combobox, multi-select — must report its selection to the server.

**Do:** **The client invents no wire format.** The widget materializes ordinary form inputs inside a real form; `params` parses them like any form since 2004. The blueprint is a server-rendered `<template>` — the server authors the field name and its array-ness:

```erb
<%= tag.div class: "quick-filter", data: {
      controller: "dialog filter multi-selection-combobox",
      multi_selection_combobox_no_selection_label_value: "Assigned to…" } do %>
    <button type="button" class="btn input input--select" data-action="click->dialog#toggle:stop">
      <span data-multi-selection-combobox-target="label"></span>
    </button>
    <template data-multi-selection-combobox-target="hiddenFieldTemplate">
      <%= hidden_field_tag "assignee_ids[]", nil %>
    </template>
<% end %>
```

The widget clones the blueprint once per selection and fills the value:

```javascript
// multi_selection_combobox_controller.js
#addHiddenFields() {
  this.#selectedValues().forEach(value => {
    const [ field ] = this.hiddenFieldTemplateTarget.content.cloneNode(true).children
    field.removeAttribute("id")
    field.value = value
    this.element.appendChild(field)
  })
}
```

The form then literally contains inputs indistinguishable from hand-typed checkboxes, read by ordinary strong params with zero glue:

```ruby
PERMITTED_PARAMS = [ :assignment_status, assignee_ids: [], tag_ids: [], terms: [] ]
# params[:assignee_ids] == ["4","9","12"]
```

**Single-select is the same trick with a scalar name** — `hidden_field_tag :indexed_by` (no `[]`), one cloned field whose value is rewritten. The widget's single-vs-multi distinction IS Rails' scalar-vs-array param distinction (`name` vs `name[]`).

**Why:** A bespoke JSON body (`{"assignees":[4,9,12]}`) invents a wire format that exists only in your head and one parser; rename a key and the other side reads `nil`. You'd throw away `permit`, array coercion, and CSRF. Building the inputs with `createElement` moves field-name ownership into JS, where it drifts from the permit list. Render the blueprint server-side; the client copies a decision, never makes one.

---

## 10. `requestSubmit()`, never `submit()`

**When:** Any code-triggered form submission.

```javascript
// form_controller.js
submit() { this.element.requestSubmit() }
```

Raw `submit()` bypasses HTML validation **and** Turbo — a full-page navigation, every Hotwire benefit gone. `requestSubmit()` behaves as if a real submit button were clicked: native validation fires, the `submit` event dispatches, Turbo intercepts.

---

## 11. `data-action` pipelines: intent declared in ERB

**When:** One gesture triggers several controllers — picking a combobox option closes the dialog, records the change, submits the form.

**Do:** Author the chain as a `data-action` pipeline, read left to right:

```erb
<button type="button"
        data-action="dialog#close multi-selection-combobox#change filter-settings#change form#submit">
```

Each controller stays ignorant of the others; the sequence is data the server renders. Re-wiring is an ERB edit, not a refactor of two JS classes.

An event-less descriptor binds the element's *default* event — `button`/`a`→`click`, `input`/`textarea`→`input`, `select`→`change`, `form`→`submit`, `details`→`toggle`. The same shorthand on an `<input>` fires on every keystroke; write the event explicitly when in doubt.

(Both products route widget intent as named events: Campfire via an internal event bus; Fizzy lifts the wiring into the `data-action` attribute. When both reach for the same move, it's doctrine.)

---

## 12. Behavior on Turbo's lifecycle: wrap `event.detail.render`

**When:** A live stream update needs client polish — autoscroll, sound, trim — but only sometimes (never yank scroll while reading history), and the broadcast must stay a dumb HTML append.

**Do:** Subscribe to Turbo's `turbo:before-stream-render` with the same declarative action string (no `addEventListener`), guard that the stream targets your own container, then wrap Turbo's render function:

```ruby
# messages_helper.rb
def messages_actions
  "turbo:before-stream-render@document->messages#beforeStreamRender keydown.up@document->messages#editMyLastMessage"
end
```

```javascript
// messages_controller.js
async beforeStreamRender(event) {
  const target = event.detail.newStream.getAttribute("target")
  if (target !== this.messagesTarget.id) return            // not our container
  const render = event.detail.render
  if (!this.#paginator.upToDate) { this.latestTarget.hidden = false; return }  // reading history → pill

  event.detail.render = async (streamElement) => {
    const didScroll = await this.#scrollManager.autoscroll(false, async () => {
      await render(streamElement)                           // Turbo still performs the append
      await nextEventLoopTick()
      this.#positionLastMessage()
      this.#playSoundForLastMessage()
      this.#paginator.trimExcessMessages(true)
    })
    if (!didScroll) { this.latestTarget.hidden = false }    // → "jump to newest" pill
  }
}
```

The broadcast carries zero UI knowledge; all nuance lives client-side, layered onto an event Turbo publishes anyway. When one *kind* of update needs different treatment, the server stamps **intent as data on the wire** (`attributes: { maintain_scroll: true }` on the stream element; stamping side is `05-turbo-frames-streams.md`), and this handler reads it off `event.detail.newStream`.

Wrapping `render` (not reacting after) puts behavior on both sides of the DOM write: measure before (near bottom?), act after (position, sound, trim) — one ordered sequence, no race. The event fires for *every* stream on the page, so the target guard is mandatory or an unrelated sidebar update autoscrolls the chat.

(Target mechanic: singular `this.fooTarget` *throws* if absent — fine for required targets; guard optional ones with `this.hasFooTarget`, use `this.fooTargets` when several match.)

---

## 13. Self-submitting, self-erasing forms

**When:** A form with no user gesture — silently correcting a stale timezone, a one-shot confirmation.

```javascript
// auto_submit_controller.js — connect → submit → on success, delete yourself
connect() {
  this.element.addEventListener("turbo:submit-end", this.#handleSubmitEnd.bind(this), { once: true })
  this.submit()
}
submit() { this.#markAsBusy(); this.#disableSubmit(); this.element.requestSubmit() }
#handleSubmitEnd(event) {
  if (event.detail.success) { this.element.remove() }       // job done → disappear
  else { this.#clearBusy(); this.#enableSubmit() }          // failure → retry
}
```

```erb
<%= auto_submit_form_with url: my_timezone_path, method: :put do %>
  <%= hidden_field_tag :timezone_name, timezone_from_cookie.name %>
<% end %>
```

It's the same boring Rails form — real PUT, real params, real CSRF — fired by `connect()` instead of a click. The form's own `turbo:submit-end` is the deletion signal: the lifecycle *is* the state machine. A hand-built `fetch()` would reimplement CSRF and lose `params` (§9's sin in a different hat).

---

## 14. Additive decorator helpers: never clobber `data-controller`

**When:** A helper attaches a controller to a form the caller may already have controllers/actions on.

**Do:** Decorate `form_with` by **merging** your contribution onto whatever's there:

```ruby
# forms_helper.rb
def auto_submit_form_with(**attributes, &)
  data = attributes.delete(:data) || {}
  data[:controller] = "auto-submit #{data[:controller]}".strip   # PREPEND, never replace
  block_given? ? form_with(**attributes, data: data, &) : form_with(**attributes, data: data) { }
end

def bridged_form_with(**attributes, &)
  data = attributes.delete(:data) || {}
  data[:controller] = [ data[:controller], "bridge--form" ].compact.join(" ").strip
  data[:action] = [
    data[:action],
    "turbo:submit-start->bridge--form#submitStart",
    "turbo:submit-end->bridge--form#submitEnd"
  ].compact.join(" ").strip
  form_with(**attributes, data: data, &)
end
```

`compact.join(" ")` makes "caller passed nothing" and "caller passed three actions" the same code path. Assigning `data[:controller] = "auto-submit"` clobbers the caller's controllers; hand-writing the full list at every call site means one missed site silently kills a widget. Independent Stimulus features must compose on one form without knowing about each other.

---

## 15. Autosave: the timer IS the dirty flag

**When:** A form saves itself after a pause, flushes on exit.

**Do:** Keep zero extra flags. "Is a save scheduled?" and "is there unsaved work?" are the same question — so the dirty bit *is* the pending timer:

```javascript
// auto_save_controller.js — no dirty boolean exists.
export default class extends Controller {
  #timer
  disconnect() { this.submit() }                  // leaving / morphed out → flush, free
  async submit() { if (this.#dirty) { await this.#save() } }
  change(event) { if (event.target.form === this.element && !this.#dirty) { this.#scheduleSave() } }
  #scheduleSave() { this.#timer = setTimeout(() => this.#save(), AUTOSAVE_INTERVAL) }
  async #save() { this.#resetTimer(); await submitForm(this.element) }   // resetTimer → no longer dirty
  get #dirty() { return !!this.#timer }
}
```

A `dirty` boolean and the work it describes drift the instant a save races a keystroke. Derive, don't store.

**Lifecycle rule:** `initialize()` runs once per instantiation; `connect()`/`disconnect()` run *every* time the element enters/leaves the document (a Turbo cache restore or morph re-fires `connect()`). Pair them: anything acquired in `connect()` — timer, polling loop, manual listener — must be released in `disconnect()`, or the removed element keeps working in the background. The canonical failure is a refresh interval started in `connect()` and never cleared, issuing HTTP requests forever.

---

## 16. localStorage drafts: derive, don't store, at the client

**When:** Unsaved text must survive closing the editor, a navigation, or a morph replacing the node.

**Do:** One localStorage slot is the single source of truth; the visible editor is *derived* from it. Per-resource key, clear only on confirmed success, re-derive after every morph:

```javascript
// local_save_controller.js
static values = { key: String }
connect() { this.restoreContent() }
submit({ detail: { success } }) { if (success) { this.#clear() } }   // clear ONLY on confirmed success
save() {
  const content = this.inputTarget.value
  if (content) { localStorage.setItem(this.keyValue, content) } else { this.#clear() }
}
async restoreContent() {
  await nextFrame()
  let saved = localStorage.getItem(this.keyValue)
  if (saved) { this.inputTarget.value = saved /* then re-fire the change event */ }
}
```

Configuration is in the view: the key is per-resource (`local_save_key_value: "card-#{@card.id}"`) so drafts can't collide; the editor wires `turbo:morph-element->local-save#restoreContent` so a live refresh re-restores the draft.

**Load-bearing:** after restoring, re-fire the change event. Autosave (§15) and validation listen for the editor's change event, not silent property writes — set the value silently and the restored draft is invisible downstream.

Clearing optimistically on submit eats the user's work if the save fails; never clearing lets a stale draft clobber a saved record; one global key lets two open cards overwrite each other. Per-resource key, clear on `event.detail.success`, re-derive after DOM upheaval.

---

## 17. Asides

**JS-only affordances ship hidden and reveal themselves.** A copy-to-clipboard button defaults hidden in CSS; the controller feature-tests the API in `connect()` and adds a class to reveal it — a browser without the API shows a working baseline. The class *name* is in the markup, not JS: `static classes = [ "supported" ]` + `data-clipboard-supported-class="..."`; the controller adds `this.supportedClass`. The controller decides *when*, the markup names the class.

**Autoresize without measuring.** To grow a textarea, keep one wrapper `data-*` attribute equal to the textarea's value; CSS sizes an invisible clone off that attribute. JS syncs one fact into the DOM; the stylesheet derives the rest.

**Speak Rails, even off the wire.** Fizzy's combobox label calls `toSentence(labels, { two_words_connector: " or ", last_word_connector: ", or " })` — a JS mirror of Rails' `Array#to_sentence`. Even display logic declines to invent vocabulary the rest of the app doesn't share.

---

## 18. The drag controller's client-side contract (recap)

The full stack is `06-morphing-live-updates.md`'s. The one generic drag controller knows exactly two things, both server-stamped on the DOM:

1. **The URL with a hole in it.** Each drop container carries `data-drag-and-drop-url` with an `__id__` placeholder. On drop, the controller swaps `__id__` for the dragged element's id and POSTs an empty body. It doesn't know whether that closes, postpones, or moves — the route is the meaning.
2. **One server-stamped placement bit.** The optimistic insert is positioned by reading a single boolean (`data-drag-and-drop-top`) — the server telling the client which side of its sort axis the card falls on, so the guess can't disagree with the truth and the morph reply is a no-op.

Generic mechanism, ERB configuration, server-owned meaning — §1 at full strength.

---

## 19. Red flags → fixes

| Red flag | The fix |
|---|---|
| A controller named after a domain noun doing generic work (`CardListController`, `AssigneePickerController`) | One generic controller; the domain enters as `data-*-value` config in ERB (§2) |
| `@selected` index, `.highlighted` class, ARIA added "later" | The cursor is `aria-selected`, written once; CSS and screen reader derive (§3) |
| Controllers importing each other; cached references to siblings | `getControllerForElementAndIdentifier` walking the DOM (§4); outlets as selectors in ERB (§5) |
| A hotkey handler calling `postpone(card)` or encoding a route shape | Key table reads a server-stamped `data-*-url` off the element and POSTs (§6) |
| `if (list.id === "closed-cards") return` inside a controller | Capability subtracted in markup: `card_hotkeys_disabled: true` (§7) |
| Cursor re-set to first item, or left on a deleted node, or an unbounded `await` on a morph | Remember index, `Promise.race` the real signal vs 200ms fallback, re-derive: clamp/last/clear (§8) |
| Widget POSTs JSON; controller has `JSON.parse` / `is_a?(Array)` checks | Widget clones a server-rendered `<template>` of `hidden_field_tag`s; `permit(ids: [])` reads it (§9) |
| `name="assignee_ids[]"` built with `createElement` in JS | Field name authored once, server-side, in the `<template>` (§9) |
| `form.submit()` anywhere | `form.requestSubmit()` — native validation + Turbo interception (§10) |
| One controller calling another's method to sequence a gesture | `data-action="a#x b#y form#submit"` pipeline in ERB (§11) |
| Broadcast carries scroll/sound/UI flags; `addEventListener` in `connect()`; document-level handler with no target guard | Dumb append; declarative `turbo:before-stream-render@document->…` wraps `event.detail.render`, guarded on target (§12) |
| A `fetch()` for what a form could do; cleanup waiting on a one-shot form | Self-submitting form: `connect()` → `requestSubmit()` → `remove()` on success (§13) |
| `data[:controller] = "auto-submit"` (assignment); full controller lists hand-written at call sites | Decorator helpers that merge: `"auto-submit #{data[:controller]}".strip`, `[...].compact.join(" ")` (§14) |
| A `dirty` boolean beside the work it describes | The pending timer IS the dirty bit; `disconnect()` flushes (§15) |
| A timer/loop/listener started in `connect()` with no `disconnect()` teardown | Pair acquire/release; an unreleased resource outlives its element (§15) |
| Draft cleared on submit (not *confirmed* success); one global key; draft lost after a morph | Per-resource key, clear only on `turbo:submit-end` success, `turbo:morph-element` → re-restore (§16) |
| JS measuring what CSS can derive; a bespoke JS formatting vocabulary | One synced `data-*` attribute + CSS; port the Rails helper (`toSentence`) (§17) |

When tempted by React anyway: everything here — keyboard nav with screen-reader-correct selection, domain-aware hotkeys, nested focus, multi-select comboboxes, scroll-aware live updates, autosave, crash-safe drafts, optimistic drag-and-drop — runs on a handful of generic Stimulus controllers configured from ERB, server-owning every field name, URL, and capability. No client state store (the DOM is the state), no API contract (the wire carries HTML and form params), no second renderer to keep in sync. That's not a workaround for not having React — it's the deletion of the problem React exists to manage.