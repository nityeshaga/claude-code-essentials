# Hotwire Native: The Mobile Apps You Get From the Web App You Already Have

Read this when the task says "mobile app," "iOS," "Android," "app store," or "we need this on phones" — before you reach for React Native, Flutter, or a parallel native codebase, and while you build or extend a Hotwire Native shell.

## Contents

1. [The position: mobile is the same one renderer](#1-the-position-mobile-is-the-same-one-renderer)
2. [The architecture in one diagram](#2-the-architecture-in-one-diagram)
3. [Navigation: web semantics, native chrome](#3-navigation-web-semantics-native-chrome)
4. [Path configuration: navigation policy as server data](#4-path-configuration-navigation-policy-as-server-data)
5. [Bridge components: HTML drives native UI](#5-bridge-components-html-drives-native-ui)
6. [Native screens: the escape hatch, with a server-side undo](#6-native-screens-the-escape-hatch-with-a-server-side-undo)
7. [What changes in the Rails app: almost nothing](#7-what-changes-in-the-rails-app-almost-nothing)
8. [When to build mobile apps at all — and what not to build](#8-when-to-build-mobile-apps-at-all--and-what-not-to-build)
9. [Red flags → fixes](#9-red-flags--fixes)

Scope: this file owns the mobile doctrine. The web-side worldview it extends is `00-frontend-first-principles.md`; the RESTful routing it depends on is `03-controllers-routing.md`; the Turbo and Stimulus mechanics it rides are `05-turbo-frames-streams.md`, `06-morphing-live-updates.md`, `07-stimulus-widgets.md`; where mobile sits in an app's life is `12-app-blueprint.md`.

---

## 1. The position: mobile is the same one renderer

**When:** any request to put the product on phones.

**Do:** wrap the server-rendered web app in a Hotwire Native shell. The screens ARE the web app — whatever HTML and CSS your server renders, displayed inside a native shell that intercepts link taps and presents each page on a real native navigation stack, with platform-specific animations, interactive pop gestures, pull-to-refresh, and cached screenshots for instant back navigation (Hotwire docs). The shell is a thin native program — a `Navigator` managing one shared `WKWebView` across view controllers on iOS, one shared `WebView` across fragments on Android — plus a JSON config file and a handful of bridge components. Everything else is the Rails app you already have.

What this buys, concretely:

- **One codebase, every platform.** A new screen in the app is a new page in the web app. Ship a fix with `kamal deploy` and every iOS and Android client has it the moment they next load the page — no app-store review, no version skew, no "which client build is this user on?" matrix (Hotwire docs).
- **App-store presence preserved.** It is a real native app — real binary, real navigation controllers, real push-notification entitlements. Users install it from the store and cannot tell the content is web; the navigation is all native (Hotwire docs).
- **Progressive enhancement, per screen.** Web-first means going native is never all-or-nothing: any single screen, or any single *component* on a screen, can be upgraded to Swift/Kotlin when fidelity demands it, while everything else stays web (Hotwire docs).

**Not:** you will be tempted to reach for React Native or Flutter, or to start a parallel SwiftUI/Compose app "done properly" — don't. Count what each of those is: a **second renderer** (and with two mobile platforms plus web, a third), a JSON API to feed it, a client state store, a client router, and a payload contract every codebase must honor forever. That is the exact drift war `00-frontend-first-principles.md` exists to refuse, re-declared on two more platforms — every row of its cost table, multiplied. And the mobile version is worse than the SPA version: every fix now waits on an app-store review cycle, and old binaries with old contract expectations stay alive in the field for months.

**Why:** the frontend question was never "web or native" — it is **one renderer or two**. Hotwire Native keeps the answer at one: the server renders HTML, the wire carries HTML, not data, and the phone displays it inside chrome the platform provides. The subsystems you never build (API, store, second router, reconciliation, three release pipelines) dwarf the native polish you give up — and the polish you actually need comes back per-screen via bridge components and native screens, paid for only where it matters. 37signals ships HEY and Basecamp to both app stores this way.

---

## 2. The architecture in one diagram

```
                    ┌─────────────────────────────────────────┐
                    │            NATIVE SHELL (thin)           │
                    │                                          │
                    │  Navigation stack · tabs · modals        │
                    │  push / pop animations · gestures        │
                    │  pull-to-refresh · error + retry screens │
                    │                                          │
                    │   ┌──────────────────────────────────┐   │
  link tap ───────▶ │   │   ONE SHARED WKWebView / WebView │   │
  intercepted by    │   │                                  │   │
  the Navigator,    │   │   server-rendered HTML + CSS     │   │
  screen pushed     │   │   Turbo Drive · Frames · Streams │   │
  natively, page    │   │   Stimulus · morphing            │   │
  loaded inside ──▶ │   │   = the web app, unmodified      │   │
  the web view      │   └──────────────────────────────────┘   │
                    │                                          │
                    │  path-configuration.json  ◀── also served │
                    │  (which URLs are modals,      remotely by │
                    │   tabs, native screens…)      the server  │
                    │                                          │
                    │  bridge components (Swift/Kotlin) ◀──▶    │
                    │  paired Stimulus controllers in the HTML │
                    └────────────────────┬─────────────────────┘
                                         │ plain HTTPS — HTML over the wire
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │     THE RAILS APP — none the wiser       │
                    │  same routes · same controllers · same   │
                    │  partials · same broadcasts. One branch: │
                    │  hotwire_native_app?  (user-agent check) │
                    └─────────────────────────────────────────┘
```

The shell intercepts a link tap, screenshots the current page, pushes a new screen onto the native stack with the platform's animation, then asks the shared web view to load the new URL. Going back pops natively against the cached screenshot — the interactive iOS pop gesture works exactly as expected (Hotwire docs). The server sees ordinary Turbo requests.

---

## 3. Navigation: web semantics, native chrome

**When:** reasoning about how users move between screens in the native app — and why you write zero navigation code for the common cases.

**Do:** let the web's link semantics drive the native stack. The defaults (Hotwire docs):

| Web event | Native behavior |
|---|---|
| Tap a link | **Push** a new screen onto the stack, animated |
| Navigate to the *current* page's path again | **Replace** the screen instead of pushing |
| Navigate to the *previous* page's path | **Pop** back to it |
| `data-turbo-action="replace"` on a link or form | Replace instead of push — the web attribute is honored natively |
| Link to a URL **off your domain** | Treated as *external*: opens in an in-app browser (`SFSafariViewController` on iOS, Custom Tabs on Android), outside the native stack |
| `sms:` / `mailto:` and other non-http schemes | Handed to the system |

Two consequences that are doctrine:

- **Keep every app screen on one domain.** External-URL handling means a screen served from a second domain falls out of the native stack into a browser sheet. If you need to customize what counts as routable, the shell registers `RouteDecisionHandler` instances, consulted in order, first match wins — `Hotwire.registerRouteDecisionHandlers([...])` (Hotwire docs). That's a rare shell-level decision, not a per-link one.
- **You don't decorate links with native instructions.** When a screen needs non-default presentation (modal, pop, clear the stack), that's a *rule about a URL pattern*, declared once in the path configuration — next section. Individually annotating links would be a maintenance nightmare, which is exactly why the framework abstracts the rules out (Hotwire docs).

Within a fully native screen, manual navigation exists — `navigator.route(url)`, `navigator.pop()`, `navigator.clearAll()` on both platforms (Hotwire docs) — but note what even the escape hatch routes through: a URL.

**Not:** you will be tempted to grab the navigation controller and push view controllers yourself, or to build a native tab/router layer that owns the screen graph — don't. The docs advise against it explicitly, even for native screens (Hotwire docs). The moment navigation logic lives in the binary, changing a flow means an app-store release, and the web and native screen graphs begin to drift.

**Why:** your `routes.rb` is already a complete, forced-readable screen graph (`03-controllers-routing.md`). Reusing it as the native navigation contract means there is exactly one map of the app, and every entry in it is testable with `curl`. **The URL carries the contract** — on mobile, literally: the URL *is* the screen identity, the stack instruction, and the rollback lever.

---

## 4. Path configuration: navigation policy as server data

**When:** any screen needs non-default native presentation — forms as modals, screens without pull-to-refresh, a native screen swapped in for a URL — or you're tempted to put a navigation decision in Swift/Kotlin.

**Do:** declare it in the *path configuration* — a JSON file with two top-level keys, `settings` (app-level data: feature flags, anything you want to control remotely) and `rules` (regex URL patterns → presentation properties). Rules apply **sequentially**: the first rule sets the default for `.*`, later rules override for specific patterns (Hotwire docs).

The canonical configuration — this exact shape is the docs' own example, and it should be your starting point:

```json
{
  "settings": {},
  "rules": [
    {
      "patterns": [".*"],
      "properties": {
        "context": "default",
        "pull_to_refresh_enabled": true
      }
    },
    {
      "patterns": ["/new$"],
      "properties": {
        "context": "modal",
        "pull_to_refresh_enabled": false
      }
    }
  ]
}
```

(Hotwire docs.) Read the second rule slowly, because it is the whole doctrine in four lines: *every form screen in the entire app* presents as a native modal, with pull-to-refresh disabled so the gesture can't fight the dismiss swipe or wipe a half-entered form. One rule, every form, forever — including forms you haven't built yet. It works only because resourceful routing puts every form at a `/new` path. RESTful route discipline (`03-controllers-routing.md`) is literally what makes the native app configurable: sloppy routes (`/createWidget`, `post :open_form`) are unmatchable, and each would need its own rule or its own native code.

The properties the framework understands out of the box (Hotwire docs):

| Property | Values | What it controls |
|---|---|---|
| `context` | `default` · `modal` | Push on the stack vs. present modally |
| `presentation` | `default` · `push` · `pop` · `replace` · `replace_root` · `clear_all` · `refresh` · `none` | Stack manipulation on visit |
| `pull_to_refresh_enabled` | bool | Defaults: `true` iOS, `false` Android |
| `animated` | bool | Transition animation |
| iOS: `view_controller`, `modal_style` (`large`/`medium`/`full`/`page_sheet`/`form_sheet`), `modal_dismiss_gesture_enabled` | | Native-screen routing and modal chrome |
| Android: `uri` (required; maps to a registered fragment), `fallback_uri`, `title` | | Fragment routing |

You may add your own properties; the framework ignores what it doesn't know (Hotwire docs).

**Where it lives — both places, deliberately.** Ship a copy bundled in the binary AND serve one from your Rails app; the shell loads bundled file first, then a cached copy of the server version, then downloads a fresh one and caches it for next launch (Hotwire docs):

```swift
Hotwire.loadPathConfiguration(from: [
    .file(localPathConfigURL),
    .server(URL(string: "https://example.com/configurations/ios_v1.json")!)
])
```

```kotlin
Hotwire.loadPathConfiguration(
    context = this,
    location = PathConfiguration.Location(
        assetFilePath = "json/configuration.json",
        remoteFileUrl = "https://example.com/configurations/android_v1.json"
    )
)
```

Version the remote filenames per platform — `ios_v1.json`, `android_v1.json` — and when a new app build needs breaking changes, point it at `_v2.json` while old clients keep reading `_v1.json` (Hotwire docs). Patterns match path *and* query string by default; wrap query matches in `.*` on both sides so parameter order can't break them, or disable with `Hotwire.config.pathConfiguration.matchQueryStrings = false` (Hotwire docs).

**Not:** you will be tempted to hardcode navigation rules in the app binary — a Swift `switch` on URL paths, per-screen booleans — because it's "just one screen." Don't. Every rule in the binary is a rule you need an app-store review to change; every rule in the JSON is a rule you change by deploying your Rails app. The same instinct that says **config over forks** for Stimulus controllers (`07-stimulus-widgets.md`) says it here: the native client is one generic shell, varied by data the server controls.

**Why:** navigation policy as server-controllable data is the asymmetry that makes the whole approach safe. New screen behaves badly as a push? Make it a modal by editing JSON. Feature needs to disappear tonight? `"presentation": "none"`. Count the edge cases the remote config absorbs: emergency rollbacks, A/B presentation changes, per-version compatibility — all without touching the binary, all reversible in one deploy.

---

## 5. Bridge components: HTML drives native UI

**When:** a web screen is right, but one element on it needs native fidelity — a real bar-button in the navigation chrome, a native menu sheet, a native form-submit affordance. The siloed web view can't reach those; bridge components are the sanctioned channel (Hotwire docs).

**Do:** build the paired component. A bridge component is two small parts speaking one message protocol (Hotwire docs):

- a **web component**: a Stimulus controller subclassing `BridgeComponent` (from `@hotwired/hotwire-native-bridge` — pin it alongside Stimulus with `./bin/importmap pin @hotwired/stimulus @hotwired/hotwire-native-bridge`), living in your Rails app;
- a **native component**: a Swift/Kotlin class with the *same name*, registered with the shell.

The contract shape: the web side declares `static component = "name"`; the native side declares the matching `name`. The web side calls `this.send(event, data, callback)` — event name, JSON payload, and a callback that runs when the native side replies. The native side implements `onReceive(message:)`, unpacks `message.data()`, builds native UI, and calls `reply(to:)` (iOS) / `replyTo(...)` (Kotlin) to fire the web callback (Hotwire docs). Data rides `data-bridge-*` attributes on the HTML, read through `BridgeElement` — `bridgeAttribute("title")`, with `data-bridge-title` falling back to `aria-label` then `textContent` (Hotwire docs).

The worked example from the docs — a native bar button that "clicks" a web link:

```html
<a href="/profile" data-controller="button" data-bridge-title="Profile">
  View profile
</a>
```

```javascript
// app/javascript/controllers/bridge/button_controller.js
import { BridgeComponent } from "@hotwired/hotwire-native-bridge"

export default class extends BridgeComponent {
  static component = "button"

  connect() {
    super.connect()

    const element = this.bridgeElement
    const title = element.bridgeAttribute("title")
    this.send("connect", {title}, () => {
      this.element.click()
    })
  }
}
```

```swift
final class ButtonComponent: BridgeComponent {
    override class var name: String { "button" }

    override func onReceive(message: Message) {
        guard let viewController else { return }
        addButton(via: message, to: viewController)
    }

    private var viewController: UIViewController? {
        delegate?.destination as? UIViewController
    }

    private func addButton(via message: Message, to viewController: UIViewController) {
        guard let data: MessageData = message.data() else { return }

        let action = UIAction { [unowned self] _ in
            self.reply(to: "connect")
        }
        let item = UIBarButtonItem(title: data.title, primaryAction: action)
        viewController.navigationItem.rightBarButtonItem = item
    }
}

private extension ButtonComponent {
    struct MessageData: Decodable {
        let title: String
    }
}
```

(Hotwire docs.) Register natively once at startup: `Hotwire.registerBridgeComponents([ButtonComponent.self])` on iOS, `Hotwire.registerBridgeComponents(BridgeComponentFactory("button", ::ButtonComponent))` on Android (Hotwire docs).

Trace the flow and notice who owns what: the **HTML declares** there is a profile action and what it's called; the **native side decorates** — it renders that declaration as a `UIBarButtonItem`; the tap **replies back into the web**, where `this.element.click()` performs the real navigation through the real link. The native component never knows what "profile" means, holds no state, and triggers no behavior of its own — it is a thin decorator over an element the server rendered. HTML remains the source of truth.

The finishing discipline (all from the docs):

- **Hide the web fallback with scoped CSS, not by deleting it.** The native frameworks append the registered component list to the user agent, and the bridge stamps it on the page — so this selector hides the web element *only* when the running app actually supports the component:

  ```css
  [data-bridge-components~="button"]
  [data-controller~="button"] {
    display: none;
  }
  ```

  Web users — and old app versions that lack the component — keep the working web element. Graceful degradation is structural, not coded.
- **House bridge controllers in a `bridge/` subdirectory** of your Stimulus controllers, isolated from domain controllers (Hotwire docs). They are a different species: domain-blind adapters, not widgets (`07-stimulus-widgets.md` — its `bridged_form_with` helper composes the `bridge--form` controller this way).
- **Per-platform and per-version guards are attributes, not conditionals:** `data-controller-optout-ios` / `data-controller-optout-android` disable an instance per platform; `this.enabled` tells the web component whether the running native app supports it at all (Hotwire docs).

**Not:** you will be tempted to widen the channel — send domain objects over the bridge, keep a native-side copy of list state, implement the action natively "since we're here." Don't. A bridge message carrying domain state is a payload contract with a second renderer — the thing this whole architecture exists to not have. If a component needs more than decoration-grade data (a title, a disabled flag, a list of menu-item labels each pointing back at a web element), the screen is outgrowing the bridge; that's a native-screen decision (§6), made deliberately, not a fatter message.

**Why:** the bridge inverts the usual hybrid-app failure. In most hybrid architectures the native layer owns behavior and the web view is an embedded afterthought; here the web owns all behavior and the native layer borrows *labels* to draw platform chrome. Count the edge cases the inversion absorbs: no state to reconcile (there is none natively), no version-skew protocol (unsupported components fall back to visible web elements automatically), no per-feature native release (a new menu is new HTML; the existing menu component renders it).

---

## 6. Native screens: the escape hatch, with a server-side undo

**When:** a screen genuinely cannot be a document — maximum-fidelity interactions or native SDK access: a live map, a camera/barcode-scanner flow, platform-integration surfaces. Neither web content nor bridge components are enough (Hotwire docs).

**Do:** build it in Swift/Kotlin — but keep it *inside* the URL contract. Every native screen keeps a corresponding URL and routes through the path configuration; the docs strongly advise this even though you could push view controllers manually (Hotwire docs).

iOS: conform the controller to `PathConfigurationIdentifiable`, match the identifier in a rule's `view_controller` property, and instantiate it in the `NavigatorDelegate`'s proposal hook (Hotwire docs):

```swift
class NumbersViewController: UITableViewController, PathConfigurationIdentifiable {
    static var pathConfigurationIdentifier: String { "numbers" }
}
```

```json
{ "patterns": ["/numbers$"], "properties": { "view_controller": "numbers" } }
```

```swift
extension SceneDelegate: NavigatorDelegate {
    func handle(proposal: VisitProposal, from navigator: Navigator) -> ProposalResult {
        switch proposal.viewController {
        case NumbersViewController.pathConfigurationIdentifier:
            return .acceptCustom(NumbersViewController(url: proposal.url))
        default:
            return .accept
        }
    }
}
```

Android: annotate a fragment with `@HotwireDestinationDeepLink(uri = "hotwire://fragment/numbers")`, point a rule's `uri` property at it, and register it with `Hotwire.registerFragmentDestinations(HotwireWebFragment::class, NumbersFragment::class)` — never forgetting `HotwireWebFragment`, the destination every ordinary URL still needs (Hotwire docs).

Once routed, Hotwire Native handles presentation — push, replace, modal, animations — exactly as if it were a web screen (Hotwire docs). Links into it are plain `<a>` tags; links out of it go through `navigator.route(url)`.

**The undo is the point.** Because even native screens resolve through the remotely-served path configuration, a broken native screen rolls back by *deleting one property from JSON*: remove `view_controller` (iOS) / `uri` (Android) and the shell presents a web view loading `/numbers` instead — a page you fully control, shipped from your server, no app-store review (Hotwire docs). Build the boring web version of the screen *first*, so the fallback exists before the native screen does. This is a positive-asymmetry shot by construction: capped downside (revert is a JSON edit), native upside.

**Not:** you will be tempted to take this hatch for screens that are forms, lists, or live views of shared data — "the settings screen would feel nicer native," "the feed should be a native list." Don't. The yardstick from `00-frontend-first-principles.md` §6 applies unchanged on mobile: is the user editing a *canvas*, or looking at a *document that changes*? A native screen is two implementations (Swift AND Kotlin), each needing specialized platform experience, each future change waiting on app-store review (Hotwire docs) — per screen, forever. A web screen is one ERB template. The docs' own examples of justified native screens are maps and camera flows, not CRUD.

**Why:** the per-screen ladder — web screen → bridge component → fully native — is the same escalation discipline as Hotwire's own rung ladder (`00-frontend-first-principles.md` §4): reach for the lowest rung that does the job, and most screens never leave rung one. That's how a one-person team (or one agent) ships full products to both app stores: high-fidelity native only where it matters, the web app for everything else (Hotwire docs).

---

## 7. What changes in the Rails app: almost nothing

**When:** adapting the existing web app to serve native clients.

**Do:** lean on the user agent. Native clients identify themselves: the shell prepends your `Hotwire.config.applicationUserAgentPrefix` and the substring `"Hotwire Native iOS; Turbo Native iOS;"` (Android: `"Hotwire Native Android; Turbo Native Android;"`), plus `"bridge-components: [your bridge components];"`, to the web view's default user agent — which is what powers turbo-rails' `hotwire_native_app?` helper on the server (Hotwire docs). That one predicate is the entire server-side integration surface. Use it three ways:

**1 — Hide web chrome for native.** The native shell already draws the top bar, the back button, the tabs. The web layout shouldn't:

```erb
<%# app/views/layouts/application.html.erb %>
<% unless hotwire_native_app? %>
  <%= render "shared/navbar" %>
<% end %>
```

When the divergence outgrows an `unless`, promote it to a variant — set `request.variant = :native` in a `before_action` guarded by `hotwire_native_app?`, and Rails picks `_navbar.html+native.erb` over `_navbar.html.erb` by file naming. Same partials, same controllers; the variant is a rendering detail, not a fork. Keep the branch count honest: if you're variant-ing every view, you're building a second app in disguise — most screens should render identically.

**2 — Drive the native stack from controller responses.** After a form submitted from a native modal, the web answer ("redirect to the show page") is wrong — the native answer is "dismiss the modal." turbo-rails ships historical-location helpers for exactly this; the iOS and Android frameworks (1.2.0+) honor them automatically, and on the plain web each falls back to an ordinary redirect (Hotwire docs):

| Helper | Native behavior |
|---|---|
| `recede_or_redirect_to(url)` | Pop any modal, then pop the visible screen |
| `refresh_or_redirect_to(url)` | Pop any modal, then reload the visible screen, invalidating cache |
| `resume_or_redirect_to(url)` | Pop any modal; nothing further |

```ruby
def create
  @boost = @message.boosts.create!(boost_params)
  refresh_or_redirect_to message_url(@message)
end
```

Closing a native modal after create is a one-word controller change — not Swift, not Kotlin, not a bridge message. Navigation stays server-driven even when the screens are native-presented.

**3 — Serve the path configuration.** It's a JSON file at a URL — a route and a static file (or a controller action, if `settings` should vary). Updating the app's navigation policy is now a deploy of *this* app.

What does NOT change: authentication and sessions. The shell is a real browser engine loading your real domain over plain HTTPS — your existing cookie-based session (`12-app-blueprint.md` §7) works as-is; the signed session cookie rides every web-view request like any other browser's. The login form is a web screen. If shell-level code must share the web view's cookie space, iOS exposes `Hotwire.config.makeCustomWebView` to supply a `WKWebView` with a shared `WKProcessPool` (Hotwire docs) — a shell concern, not a Rails one. Two platform notes from the docs while you're in the shell: camera/microphone access via `<input type="file">` needs `NSCameraUsageDescription` (and `NSMicrophoneUsageDescription` for video) in the iOS `Info.plist` or the app crashes; on Android, stamp `data-native-prevent-pull-to-refresh` on web elements whose drag/swipe gestures fight the native pull-to-refresh (Hotwire docs).

**Not:** you will be tempted to build token auth "because mobile apps use tokens" — JWT issuance, refresh flows, an `Authorization` header pipeline. Don't. That reflex belongs to API-consuming native apps; this app consumes pages, and pages already have a session. You'd be rebuilding, in two more codebases, the auth duplication row from the SPA cost table.

**Why:** everything the native app needs, it asks for in the same language the browser uses — URLs, cookies, HTML, redirects. **Rails stays small because each layer trusts a convention at its boundary**, and the native shell is just one more client honoring the same boundary. Count the edge cases `hotwire_native_app?` + three redirect helpers absorb: no per-client endpoints, no content negotiation matrix, no auth fork, no mobile team waiting on backend tickets.

---

## 8. When to build mobile apps at all — and what not to build

**When:** scoping mobile into a product's life.

**Do:** sequence it the 37signals way — **web first, apps after the product is proven.** The web app is where you find the product: fastest iteration, no review gates, one deploy surface, and every screen you ship there is, by construction, already most of the mobile app. When usage justifies app-store presence, the incremental cost of Hotwire Native is the thin shell: a `Navigator` and a start URL (the docs' entire iOS getting-started is one `SceneDelegate`; Android, one `HotwireActivity` with a `NavigatorConfiguration`), a path configuration whose first draft is the canonical two rules of §4, and bridge components added one at a time as screens earn them. `12-app-blueprint.md`'s build order doesn't grow a step — mobile is a new *client* of steps you already finished, not a new feature pipeline.

What you do NOT build for the apps:

- **No API layer.** The apps consume the same server-rendered HTML as the browser — the wire carries HTML, not data. The "premature API" refusal of `12-app-blueprint.md` §9 survives first contact with mobile, *because of* this architecture: the HTML controllers ARE the API, and the native shell is just another thing with a user agent.
- **No mobile backend, no BFF, no serializers, no client SDK.** Each is machinery for feeding a second renderer you decided not to have.
- **No parallel design system.** The CSS is the design system; bridge components borrow native chrome where platform feel matters.
- **No per-platform feature work.** A feature ships when the web page ships; iOS and Android get it simultaneously and instantly.

**Not:** you will be tempted to start the native apps early — "we'll need them eventually, and native takes longer, so start now." Don't. Starting early forces you to stabilize screens (and, if you defected to an API, contracts) before the product has settled, and every pre-PMF pivot now costs three codebases plus review cycles. The whole point of this architecture is that "later" is cheap: the apps are mostly already built, because they're the web app.

**Why:** the asymmetry. Web-first costs you nothing on mobile-day-one (the shell wraps whatever exists) and saves you the entire drift war if the product pivots. Apps-first costs you the war up front for an app you haven't validated. Take the bet with capped downside.

---

## 9. Red flags → fixes

| Red flag | The fix |
|---|---|
| React Native / Flutter / a parallel SwiftUI-Compose app for a server-rendered product | Hotwire Native shell — the screens are the web app; one renderer, every platform (§1) |
| Building a JSON API "for the mobile app" | The apps consume the same server-rendered HTML; the HTML controllers ARE the API (§8, `12-app-blueprint.md` §9) |
| Writing a screen natively that's just a form, list, or live document | It's a web screen; the canvas-vs-document yardstick applies on mobile unchanged (§6, `00-frontend-first-principles.md` §6) |
| Hardcoding navigation rules in the app binary (URL switches, per-screen flags in Swift/Kotlin) | Path configuration rules — navigation policy is server-controllable data (§4) |
| Path configuration bundled only locally, or served only remotely | Both: bundled for offline first-launch, remote for live control; versioned `ios_v1.json` / `android_v1.json` (§4) |
| Decorating individual links with native presentation instructions | One regex rule per URL *pattern* — `"/new$"` → modal covers every form in the app (§4) |
| Forms as pushed screens with pull-to-refresh enabled | `context: modal`, `pull_to_refresh_enabled: false` — the gesture fights the dismiss swipe and eats user input (§4) |
| Bridge messages carrying domain state or behavior | Bridge data is decoration-grade (titles, flags); behavior stays in the HTML the native side clicks back into (§5) |
| Deleting the web element a bridge component replaces | Hide via `[data-bridge-components~=…]`-scoped CSS so unsupported clients keep the working web fallback (§5) |
| Bridge controllers mixed in with domain Stimulus controllers | `bridge/` subdirectory; they're domain-blind adapters, a different species (§5, `07-stimulus-widgets.md`) |
| Pushing native view controllers / fragments manually around the Navigator | Route everything — even native screens — through the path configuration via `view_controller` / `uri` (§3, §6) |
| Native screen shipped with no web fallback page | Build the web version first; rollback is then deleting one JSON property, no app-store review (§6) |
| Token/JWT auth flows built for the apps | The shell is a browser on your domain; the existing cookie session works as-is (§7) |
| Controller redirects that strand native modals open after form submit | `recede_or_refresh_or_resume_or_redirect_to` family — the server drives the native stack (§7) |
| `hotwire_native_app?` branches multiplying through every view | Hide chrome and little else; if every view forks, you're building a second app in disguise — promote to variants sparingly (§7) |
| App screens served from a second domain | Off-domain is *external*: it falls out of the native stack into an in-app browser; keep one domain (§3) |
| Starting the native apps before the web product is proven | Web first; the shell wraps whatever exists, later, cheaply (§8) |

---

**The bottom line:** mobile is not a second product — it is the same one renderer, wearing platform chrome. The server keeps rendering every screen, the URL keeps carrying the contract (now all the way into the navigation stack), and the native code you write is a thin shell plus small decorators, all of it overridable from the server you already deploy. The discipline this file demands — RESTful routes, one domain, one renderer, HTML as the source of truth — is the same discipline the rest of the skill already demanded. The apps are the reward for having followed it.
