# Hotwire API Cheat Sheet

Read this when you need the exact API — attributes, events, actions, options. Doctrine lives in `05-turbo-frames-streams.md`, `06-morphing-live-updates.md`, and `07-stimulus-widgets.md`; this is the surface. Everything below is distilled verbatim from the official Turbo and Stimulus references (Hotwire docs) — that provenance applies to the whole file. For prose explanations, fetch the official handbooks at <https://turbo.hotwired.dev/handbook> and <https://stimulus.hotwired.dev/handbook>.

## Contents

- [Turbo: `data-turbo-*` attributes](#turbo-data-turbo--attributes)
- [Turbo: attributes Turbo adds for you](#turbo-attributes-turbo-adds-for-you)
- [Turbo: meta tags](#turbo-meta-tags)
- [Turbo: `<turbo-frame>`](#turbo-turbo-frame)
- [Turbo: frame-targeting rules](#turbo-frame-targeting-rules)
- [Turbo: `<turbo-stream>` actions](#turbo-turbo-stream-actions)
- [Turbo: event lifecycle](#turbo-event-lifecycle)
- [Turbo: JS API essentials](#turbo-js-api-essentials)
- [Stimulus: controller anatomy & naming](#stimulus-controller-anatomy--naming)
- [Stimulus: lifecycle callbacks](#stimulus-lifecycle-callbacks)
- [Stimulus: actions](#stimulus-actions)
- [Stimulus: targets](#stimulus-targets)
- [Stimulus: values](#stimulus-values)
- [Stimulus: outlets](#stimulus-outlets)
- [Stimulus: CSS classes](#stimulus-css-classes)
- [Stimulus: action params](#stimulus-action-params)
- [Stimulus: `dispatch` (cross-controller events)](#stimulus-dispatch-cross-controller-events)
- [Rails-side helpers](#rails-side-helpers)

---

## Turbo: `data-turbo-*` attributes

| Attribute | Put it on | Effect |
|---|---|---|
| `data-turbo="false"` | link, form, or ancestor | Disables Turbo Drive for the element and descendants; re-enable inside with `data-turbo="true"`. Won't re-enable a path Turbo is configured to ignore. |
| `data-turbo-track="reload"` | `<script>`, CSS `<link>` in `<head>` | Tracks the element's HTML; full page reload when it changes between responses (asset fingerprint changes). |
| `data-turbo-track="dynamic"` | `<style>`, `<link>` | Tracks the element; removes it when absent from a new HTML response. |
| `data-turbo-frame="id"` | link, form | Routes the navigation into the `<turbo-frame>` with that id. Special values: `_self` (this frame), `_top` (full page). |
| `data-turbo-action="advance"` / `"replace"` | link, form, or `<turbo-frame>` | Sets the Visit action (history behavior). On a frame or a link inside one, promotes the frame navigation to a page Visit with a URL change. |
| `data-turbo-method="delete"` (etc.) | link | Changes the link's request from `GET` to the given verb. Prefer a real form; use only where a form is impossible. |
| `data-turbo-confirm="…"` | form, or link with `data-turbo-method` | Presents a confirm dialog with the given text before proceeding. |
| `data-turbo-stream` | link, GET form | Allows a Turbo Stream response for `GET` requests (non-`GET` form submissions request streams automatically). |
| `data-turbo-submits-with="Saving…"` | `input`/`button` submitter | Swaps the submitter's text to this value while the form is in flight; restores it after. |
| `data-turbo-permanent` | any element with a unique `id` | Persists the element across page loads, and excludes it from morphing during page refreshes. |
| `data-turbo-temporary` | any element | Removed before the page is cached, so it never reappears in a restored/preview page. |
| `data-turbo-eval="false"` | inline `<script>` | Prevents the script from being re-evaluated on Turbo Visits. |
| `data-turbo-preload` | link | Pre-fetches the linked page into the cache before the user clicks. |
| `data-turbo-prefetch="false"` | link or ancestor | Disables prefetch-on-hover for the element. |
| `download` | link | Standard HTML attribute; opts the link out of Turbo (it's a file download, not navigation). |

## Turbo: attributes Turbo adds for you

State you read, never write — the DOM attribute IS the state (style busy/loading UI off these instead of toggling classes from JS):

| Attribute | Added to | When |
|---|---|---|
| `disabled` | form submitter | While the form request is in flight (prevents double submit). |
| `busy` | `<turbo-frame>` | While a navigation or form submission is in progress within the frame. |
| `complete` | `<turbo-frame>` | When the frame has finished navigating. |
| `aria-busy` | `<html>`, `<form>`, `<turbo-frame>` | While a visit / submission / frame request is in progress. |
| `data-turbo-preview` | `<html>` | While a cached preview is displayed during a Visit. |
| `data-turbo-visit-direction` | `<html>` | During a visit; value `forward`, `back`, or `none`. |

## Turbo: meta tags

All go in `<head>`:

| Meta tag | Effect |
|---|---|
| `<meta name="turbo-cache-control" content="no-preview">` | Cached copy never shown as a preview; used only for restoration visits. `content="no-cache"`: page never cached, always fetched fresh. |
| `<meta name="turbo-visit-control" content="reload">` | Full page reload whenever Turbo navigates to this page (including from inside a frame). |
| `<meta name="turbo-refresh-method" content="morph">` | Page refreshes render by morphing instead of body replacement (default `replace`). Set via `turbo_refreshes_with` — see `06-morphing-live-updates.md`. |
| `<meta name="turbo-refresh-scroll" content="preserve">` | Keeps scroll position across page refreshes (default `reset`). |
| `<meta name="view-transition" content="same-origin">` | Enables the View Transition API on browsers that support it. |
| `<meta name="turbo-prefetch" content="false">` | Disables prefetch-on-hover app-wide. |
| `<meta name="turbo-root" content="/app">` | Scopes Turbo Drive to a path prefix; visits outside it are full page loads. |

## Turbo: `<turbo-frame>`

HTML attributes:

| Attribute | Values | Effect |
|---|---|---|
| `id` | required, unique | The frame's identity. Responses must contain a frame with a matching id, or `turbo:frame-missing` fires. |
| `src` | URL or path | Loads the frame's content from this URL. Changing `src` navigates the frame. |
| `loading` | `eager` (default) / `lazy` | `eager`: `src` changes navigate immediately. `lazy`: navigation deferred until the frame is visible in the viewport. |
| `disabled` | boolean | Prevents any navigation of the frame. |
| `target` | frame id or `_top` | Default destination for navigations initiated by descendant links. `_top` navigates the whole window. |
| `refresh` | `morph` | The frame reloads with morphing during page refreshes and on explicit `.reload()`. |
| `autoscroll` | boolean | Scrolls the frame into view after loading. Tune with `data-autoscroll-block` (`end` default, `start`, `center`, `nearest`) and `data-autoscroll-behavior` (`auto` default, `smooth`). |
| `recurse` | frame id | Lets Turbo extract the named frame from a response that nests it inside this frame's content rather than containing it directly. |
| `busy` / `complete` | boolean (read-only) | State flags added by Turbo — see table above. |

`FrameElement` JS properties and functions:

| Member | Meaning |
|---|---|
| `frame.src` | Get/set the URL; setting navigates (deferred until visible when lazy). |
| `frame.disabled` | Get/set whether the frame will load. |
| `frame.loading` | Get/set `"eager"` / `"lazy"`. |
| `frame.loaded` | A `Promise` that resolves when the current navigation completes. |
| `frame.complete` | Read-only boolean: finished navigating. |
| `frame.autoscroll` | Get/set scroll-into-view after load. |
| `frame.isActive` | Read-only: frame is loaded and interactive. |
| `frame.isPreview` | Read-only: the containing document is a cached preview. |
| `frame.reload()` | Re-fetches the frame from its `src`. |

## Turbo: frame-targeting rules

Where a navigation lands, in precedence order:

1. `data-turbo-frame` on the clicked link / submitted form wins: that frame id, or `_self` (the enclosing frame), or `_top` (full page Visit).
2. Otherwise the enclosing frame's `target` attribute: another frame id, or `_top`.
3. Otherwise, a link or form inside a `<turbo-frame>` navigates that frame.
4. Outside any frame: a normal page Visit. A link outside a frame can still drive one with `data-turbo-frame="id"`.

Frame navigations don't change the URL unless promoted with `data-turbo-action="advance"` (or `replace`). The response must contain a `<turbo-frame>` whose id matches the navigated frame; only that element's content is swapped, everything else in the response is discarded.

## Turbo: `<turbo-stream>` actions

Shape: `<turbo-stream action="…" target="dom_id"><template>…</template></turbo-stream>`. The target is a plain element addressed by DOM id — `dom_id` is the address. Use `targets="css selector"` (plural) instead of `target` to hit multiple elements with one action.

| Action | Semantics |
|---|---|
| `append` | Appends template content inside the target. If the template's first element has an id already used by a direct child of the target, that child is **replaced instead of appended** (free idempotence — re-delivered broadcasts don't duplicate rows). |
| `prepend` | Prepends inside the target; same replace-if-id-exists rule as `append`. |
| `replace` | Replaces the target element itself. Add `method="morph"` to swap by morphing instead of removal+insertion (preserves focus, scroll, and `data-turbo-permanent` elements). |
| `update` | Replaces the target's **children**, keeping the element. Add `method="morph"` to morph only the children. |
| `remove` | Removes the target element. No `<template>` needed. |
| `before` | Inserts template content before the target element (as a sibling). |
| `after` | Inserts template content after the target element (as a sibling). |
| `refresh` | Initiates a page refresh. `request-id="…"` debounces — the initiating tab skips its own refresh. `method="morph"` and `scroll="preserve"` set refresh behavior. This is the action `broadcasts_refreshes` emits — see `06-morphing-live-updates.md`. |

Stream elements are interpreted wherever they connect to the DOM, then removed — so a `<turbo-stream>` rendered inside ordinary page or frame HTML executes as a side effect. Any stream source works: connect with `Turbo.session.connectStreamSource(source)` / `disconnectStreamSource(source)`, or hand raw stream HTML to `Turbo.renderStreamMessage(html)`.

## Turbo: event lifecycle

Page navigation, in firing order. Fire on `document.documentElement` (the `<html>` element) except where noted.

| # | Event | Fires on | Cancelable | Use it for |
|---|---|---|---|---|
| 1 | `turbo:click` | the link | yes — click falls through to the browser as normal navigation | Intercept a Turbo-enabled link click; `detail.url`. |
| 2 | `turbo:before-visit` | `<html>` | yes — prevents the navigation | Veto a visit (unsaved changes guard); `detail.url`. Doesn't fire for history navigation. |
| 3 | `turbo:visit` | `<html>` | no | Know a visit started; `detail.url`, `detail.action` (`advance`/`replace`/`restore`). |
| 4 | `turbo:before-cache` | `<html>` | no | Clean up the page before it's cached (reset forms, close menus). No `detail`. |
| 5 | `turbo:before-render` | `<html>` | pausable — `preventDefault()` then `detail.resume()` | Last hook before the new body lands; `detail.newBody`, `detail.renderMethod` (`replace`/`morph`), override `detail.render(currentBody, newBody)` for custom rendering. |
| 6 | `turbo:render` | `<html>` | no | After render; fires twice on a cached visit (preview, then fresh). `detail.renderMethod`. |
| 7 | `turbo:load` | `<html>` | no | Once on initial load, again after every visit. `detail.url`, `detail.timing.*`. The Turbo-era `DOMContentLoaded`. |
| — | `turbo:reload` | `<html>` | no | Just before Turbo gives up and full-page reloads; `detail.reason` (e.g. `turbo_disabled`, `tracked_element_mismatch`). |

Page refresh / morphing events:

| Event | Fires on | Cancelable | Use it for |
|---|---|---|---|
| `turbo:morph` | `<html>` | no | After the page morphs; `detail.currentElement`, `detail.newElement`. |
| `turbo:before-morph-element` | the element being morphed | yes — element is preserved untouched | Exempt one element from a morph (the JS-owned widget escape hatch — see `06-morphing-live-updates.md`). `detail.newElement`. |
| `turbo:before-morph-attribute` | the element | yes — attribute keeps its current value | Preserve one attribute through a morph; `detail.attributeName`, `detail.mutationType` (`update`/`remove`). |
| `turbo:morph-element` | the morphed element | no | React after an element morphs (e.g. cursor rehoming — `07-stimulus-widgets.md`); `detail.newElement`. |

Form events (fire on the `<form>`):

| Event | Cancelable | Use it for |
|---|---|---|
| `turbo:submit-start` | no — but abort with `detail.formSubmission.stop()` | Disable UI / final validation as submission begins. |
| `turbo:submit-end` | no | React to the outcome: `detail.success`, `detail.fetchResponse` (present even on failure responses), `detail.error` (network errors only). |

Frame events (fire on the `<turbo-frame>`):

| Event | Cancelable | Use it for |
|---|---|---|
| `turbo:before-frame-render` | pausable — `preventDefault()` + `detail.resume()` | Hook before the frame swaps; `detail.newFrame`, override `detail.render(currentFrame, newFrame)`. |
| `turbo:frame-render` | no | After the frame renders; `detail.fetchResponse`. |
| `turbo:frame-load` | no | Frame finished navigating and loading (after `turbo:frame-render`). No `detail`. |
| `turbo:frame-missing` | yes — overrides the default error | Response had no matching frame; default writes an error into the frame and throws. `detail.response`, `detail.visit(location, visitOptions)` to redirect page-wide instead (the session-expiry break-out — `05-turbo-frames-streams.md`). |

Stream events (fire on the `<turbo-stream>`):

| Event | Cancelable | Use it for |
|---|---|---|
| `turbo:before-stream-render` | yes (override behavior) | Intercept any incoming stream action; `detail.newStream`, override `detail.render(currentElement)` to implement custom actions. |

HTTP request events (fire on the initiating `<turbo-frame>`, `<form>`, or `<html>`):

| Event | Cancelable | Use it for |
|---|---|---|
| `turbo:before-fetch-request` | pausable — `preventDefault()` + `detail.resume()` | Mutate outgoing requests (add a header); `detail.fetchOptions`, `detail.url`. |
| `turbo:before-fetch-response` | no | Inspect the response before Turbo processes it; `detail.fetchResponse`. |
| `turbo:before-prefetch` | yes — prevents the prefetch | Veto hover prefetching per link (the link is `event.target`). |
| `turbo:fetch-request-error` | yes | Network failure (not HTTP error status); `detail.request`, `detail.error`. |

## Turbo: JS API essentials

The handful worth knowing exist — reaching for these is rare in 37signals code; most days the declarative surface above is the whole API:

| API | What it does |
|---|---|
| `Turbo.visit(location, { action, frame })` | Programmatic navigation. `action`: `"advance"` (default) or `"replace"`. `frame`: navigate that frame instead of the page (falls back to a page visit if the frame isn't found). Cross-origin or outside `turbo-root` → full page load. |
| `Turbo.renderStreamMessage(streamActionHTML)` | Apply turbo-stream HTML from any source (a fetch you made yourself, a non-MessageEvent transport). |
| `Turbo.session.connectStreamSource(source)` / `disconnectStreamSource(source)` | Wire any MessageEvent-emitting object (WebSocket, EventSource) in as a stream source. `turbo_stream_from` does this for you over Action Cable. |
| `Turbo.cache.clear()` | Empty the page cache after client-visible server state changed. |
| `Turbo.session.drive = false` | Turn Drive off globally; opt back in per element with `data-turbo="true"`. |
| `Turbo.config.drive.progressBarDelay = ms` | Progress bar appearance delay (default 500ms). |
| `Turbo.config.forms.confirm = fn` | Replace `window.confirm` for `data-turbo-confirm`; `fn` returns a `Promise<boolean>`. |
| `event.detail.render` override | On `turbo:before-render` / `turbo:before-frame-render` / `turbo:before-stream-render`: swap in your own render function. The custom-action / custom-rendering hook. |

---

## Stimulus: controller anatomy & naming

```js
// app/javascript/controllers/clipboard_controller.js
import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [ "source" ]                  // → this.sourceTarget …
  static values  = { url: String }               // → this.urlValue …
  static classes = [ "loading" ]                 // → this.loadingClass …
  static outlets = [ "user-status" ]             // → this.userStatusOutlet …

  copy() { /* an action method */ }
}
```

Built-in instance properties: `this.element` (the controller's element), `this.identifier`, `this.application`, plus `this.dispatch(...)` (below).

Filename → identifier (one class per file, default export, in `controllers/`):

| File | Identifier |
|---|---|
| `clipboard_controller.js` | `clipboard` |
| `date_picker_controller.js` | `date-picker` |
| `local-time-controller.js` | `local-time` |
| `users/list_item_controller.js` | `users--list-item` |

Casing rules everywhere: **camelCase** in JS (methods, action names, target/value/class logical names), **kebab-case** in HTML (identifiers, value/class data attributes), snake_case or kebab-case filenames.

Attach with `data-controller="clipboard"`; space-separate for multiple controllers on one element (`data-controller="clipboard list-item"`). Scope = the element plus descendants, **excluding** the scope of any nested controller with the same identifier.

Registration is automatic under Rails with importmap (or webpack + `@hotwired/stimulus-webpack-helpers`). Manual: `application.register("clipboard", ClipboardController)`. Escape hatches: `static get shouldLoad() { return false }` to skip registration conditionally; `static afterLoad(identifier, application)` runs as soon as the controller registers, even with no matching elements in the DOM.

## Stimulus: lifecycle callbacks

In firing order around connection:

| Order | Method | Invoked |
|---|---|---|
| 1 | `initialize()` | Once, when the controller is first instantiated. |
| 2 | `[name]TargetConnected(target)` | Any time a `[name]` target connects — **before** `connect()` when both happen together. |
| 3 | `connect()` | Any time the controller's element connects to the document. |
| 4 | `disconnect()` | Any time the element disconnects. |
| 5 | `[name]TargetDisconnected(target)` | Any time a `[name]` target disconnects — **after** `disconnect()` when both happen together. |
| — | `[name]OutletConnected(outlet, element)` / `[name]OutletDisconnected(outlet, element)` | When a matching outlet appears on / leaves the page. |
| — | `[name]ValueChanged(value, previousValue)` | After `initialize`, and on every change to the value's data attribute (including via its setter). |

Connection facts that matter: callbacks fire asynchronously (MutationObserver, next microtask). A Turbo page change that installs a new `<body>` disconnects everything — `connect()` will run again on every visit, so it must be idempotent. Re-attached elements **reuse the same controller instance**: `initialize` once, `connect`/`disconnect` many times, always alternating. During `[name]TargetConnected`/`Disconnected`, observers are paused — adding/removing a same-named target inside the callback will not re-trigger it.

## Stimulus: actions

Descriptor anatomy, full form:

```
event.filter@global->controller-identifier#methodName:option
└─┬─┘ └─┬──┘ └─┬───┘  └──────┬───────────┘ └───┬────┘ └─┬──┘
event  key    window/      identifier         method    options
       filter document
```

`data-action` is a space-separated list of descriptors; multiple actions on one event run **left to right**, and `event.stopImmediatePropagation()` inside a method halts the rest of the chain.

Event shorthand — omit `event->` on these element/event pairs:

| Element | Default event |
|---|---|
| `a` | `click` |
| `button` | `click` |
| `input type=submit` | `click` |
| `details` | `toggle` |
| `form` | `submit` |
| `input` | `input` |
| `textarea` | `input` |
| `select` | `change` |

Keyboard filters (`keydown.esc->modal#close` — keyboard events only):

| Filter | Key | | Filter | Key |
|---|---|---|---|---|
| `enter` | Enter | | `up` / `down` / `left` / `right` | Arrow keys |
| `tab` | Tab | | `home` / `end` | Home / End |
| `esc` | Escape | | `page_up` / `page_down` | PageUp / PageDown |
| `space` | `" "` | | `[a-z]`, `[0-9]` | that character |

Compound modifiers: `keydown.ctrl+a->listbox#selectAll`. Supported: `alt` (option on macOS), `ctrl`, `meta` (command on macOS), `shift`. Extend key names via a custom schema's `keyMappings` passed to `Application.start`.

Globals: append `@window` or `@document` to listen there — `resize@window->gallery#layout`, `clipboard:copy@window->effects#flash`.

Options (suffix after the method, stackable):

| Option | Effect |
|---|---|
| `:stop` | `stopPropagation()` before invoking the method |
| `:prevent` | `preventDefault()` before invoking the method |
| `:self` | invoke only if the event's target is the element itself |
| `:capture` | listener `{ capture: true }` |
| `:once` | listener `{ once: true }` |
| `:passive` / `:!passive` | listener `{ passive: true }` / `{ passive: false }` |

Custom options: `application.registerActionOption("open", ({ event, value }) => boolean)` — return `false` to drop the event; `:!open` yields `value: false`.

Action methods receive the event: `event.target` (dispatcher), `event.currentTarget` (element holding `data-action`, or window/document), `event.params` (see params section), plus standard `preventDefault()`/`stopPropagation()`. Name methods after the outcome (`#showDialog`), never after the event (`#click`, `#handleClick`).

## Stimulus: targets

```html
<div data-controller="search">
  <input data-search-target="query">
</div>
```

`static targets = [ "query" ]` generates, per name:

| Property | Returns |
|---|---|
| `this.queryTarget` | First matching target in scope — **throws** if none |
| `this.queryTargets` | Array of all matching targets in scope |
| `this.hasQueryTarget` | Boolean — guard optional targets with this before touching the singular |

The target attribute value is a space-separated list of names, and one element can carry target attributes for several controllers (`data-search-target="projects" data-checkbox-target="input"`). Element callbacks `[name]TargetConnected(element)` / `[name]TargetDisconnected(element)` fire on every add/remove — including ones caused by Turbo swaps — which makes them the hook for keeping derived DOM state correct without re-running setup by hand.

## Stimulus: values

```html
<div data-controller="loader" data-loader-url-value="/messages" data-loader-interval-value="5">
```

Value data attributes (and class/outlet attributes) must sit **on the same element** as `data-controller`. Attribute naming: `data-[identifier]-[name]-value`, kebab-case (`contentType` → `data-loader-content-type-value`).

```js
static values = {
  url: String,                                 // simple form
  interval: { type: Number, default: 5 },      // expanded form with default
}
```

Types and transcoding:

| Type | Encoded as | Decoded as | Default when attribute absent |
|---|---|---|---|
| `String` | itself | itself | `""` |
| `Number` | `number.toString()` | `Number(value.replace(/_/g, ""))` | `0` |
| `Boolean` | `boolean.toString()` | `!(value == "0" \|\| value == "false")` | `false` |
| `Array` | `JSON.stringify` | `JSON.parse` | `[]` |
| `Object` | `JSON.stringify` | `JSON.parse` | `{}` |

Generated properties per value:

| Property | Effect |
|---|---|
| `this.urlValue` | Reads + decodes the data attribute (or returns the default) |
| `this.urlValue =` | Writes the data attribute; assign `undefined` to remove it |
| `this.hasUrlValue` | Attribute present on the element? |
| `urlValueChanged(value, previousValue)` | Callback: after initialize and on every attribute change — the re-render hook when server-sent HTML (a morph, a frame swap) rewrites the attribute |

## Stimulus: outlets

Reference other controller **instances** anywhere on the page (targets are scoped elements; outlets are unscoped controllers):

```html
<div data-controller="user-status" class="online-user">…</div>

<div data-controller="chat" data-chat-user-status-outlet=".online-user">…</div>
```

Declaration: `data-[identifier]-[outlet]-outlet="[CSS selector]"` on the host's element; `static outlets = [ "user-status" ]` in the host class. The outlet name **must equal the target controller's identifier**, and every element the selector matches must actually carry `data-controller="user-status"` — otherwise Stimulus throws (`Missing outlet element …` / `Missing "data-controller=user-status" attribute …`).

Generated properties per outlet (name camelized; for namespaced identifiers drop the delimiter — `admin--user-status` → `adminUserStatusOutlets`, not `admin__UserStatus…`):

| Property | Returns |
|---|---|
| `this.userStatusOutlet` | First matching `Controller` instance — throws if none |
| `this.userStatusOutlets` | `Array<Controller>` of all matches |
| `this.userStatusOutletElement` / `…OutletElements` | The controller `Element`(s) instead |
| `this.hasUserStatusOutlet` | Boolean — guard optional outlets |
| `userStatusOutletConnected(outlet, element)` / `…Disconnected(outlet, element)` | Add/remove callbacks |

An outlet gives you the full controller: its methods, `idValue`, `imageTarget`, `activeClasses` — everything. Doctrine on when outlets beat events: `07-stimulus-widgets.md`.

## Stimulus: CSS classes

Class names live in HTML, logical names in JS — no hard-coded class strings in controllers:

```html
<form data-controller="search"
      data-search-loading-class="search--busy"
      data-search-no-results-class="search--empty">
```

```js
static classes = [ "loading", "noResults" ]

this.element.classList.add(...this.loadingClasses)
```

Attribute: `data-[identifier]-[logical-name]-class`, on the `data-controller` element, value = one class or a space-separated list.

| Property | Returns |
|---|---|
| `this.loadingClass` | The attribute value — first class only, if a list. Throws if the attribute is absent. |
| `this.loadingClasses` | Array of all classes in the attribute (spread into `classList.add(...)`) |
| `this.hasLoadingClass` | Attribute present? |

## Stimulus: action params

Extra data riding on the action's submitter element — format `data-[identifier]-[param-name]-param`, on the **same element** as the `data-action`:

```html
<button data-action="item#upvote spinner#start"
        data-item-id-param="12345"
        data-item-url-param="/votes"
        data-item-payload-param='{"value":"1234567"}'
        data-item-active-param="true">…</button>
```

Each action method reads only **its own controller's** params via `event.params` — here `ItemController#upvote` gets `{ id: 12345, url: "/votes", payload: { value: 1234567 }, active: true }` and `SpinnerController#start` gets `{}`. Typecast is inferred from the value:

| Attribute value | Becomes | Type |
|---|---|---|
| `"12345"` | `12345` | Number |
| `"/votes"` | `"/votes"` | String |
| `'{"value":"1234567"}'` | `{ value: 1234567 }` | Object |
| `"true"` | `true` | Boolean |

Destructure when the event isn't otherwise needed: `upvote({ params: { id, url } })`.

## Stimulus: `dispatch` (cross-controller events)

`this.dispatch(eventName, options)` fires a `CustomEvent` named `[identifier]:[eventName]` and returns it (check `event.defaultPrevented` to make the behavior vetoable by listeners). Route it on the **receiving** controller's element: `data-action="clipboard:copy->effects#flash"` — add `@window` when the receiver isn't an ancestor of the emitter.

| Option | Default | Notes |
|---|---|---|
| `detail` | `{}` | the payload; read as `event.detail` |
| `target` | `this.element` | element the event dispatches from |
| `prefix` | `this.identifier` | falsy → bare `eventName`; string → `prefix:eventName` |
| `bubbles` | `true` | |
| `cancelable` | `true` | |

Last resort when events can't work: `this.application.getControllerForElementAndIdentifier(element, "other")` returns the live controller instance on that element.

## Rails-side helpers

The turbo-rails surface you'll actually type. One line each; usage doctrine lives in the named file.

| Helper | One line | Doctrine |
|---|---|---|
| `turbo_frame_tag id, src:, loading:` | Renders `<turbo-frame>`; accepts a record or `[record, :suffix]` and derives the id via `dom_id`. | `05-turbo-frames-streams.md` |
| `turbo_stream_from streamables` | Subscribes the page to a signed Action Cable stream — the entire client-side real-time wiring, one line. | `05-turbo-frames-streams.md` |
| `turbo_stream.append / .replace(..., method: :morph) / …` | Builds stream actions in `.turbo_stream.erb` responses; one builder per action in the table above. | `05-turbo-frames-streams.md`, `06-morphing-live-updates.md` |
| `broadcast_append_to / broadcast_replace_to / broadcast_remove_to / …` (and `_later` variants) | Model-side push of one stream action to a channel; defaults to rendering the model's own partial — one renderer. | `05-turbo-frames-streams.md` |
| `broadcasts_refreshes` | Model macro: broadcast a `refresh` stream action on every create/update/touch/destroy — replaces the whole `broadcast_*_to` matrix. | `06-morphing-live-updates.md` |
| `turbo_refreshes_with method: :morph, scroll: :preserve` | Layout-side: emits the `turbo-refresh-method` / `turbo-refresh-scroll` meta tags, once, in `<head>`. | `06-morphing-live-updates.md` |
| `dom_id(record, prefix = nil)` | `dom_id(card)` → `"card_42"`, `dom_id(card, :edit)` → `"edit_card_42"` — the address both HTTP and broadcast paths must derive, never hand-type. | `05-turbo-frames-streams.md` |
