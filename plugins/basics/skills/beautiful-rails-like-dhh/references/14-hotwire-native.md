# Hotwire Native: Mobile Apps From the Web App You Already Have

Read this when the task says "mobile app," "iOS," "Android," "app store," or "we need this on phones" — before reaching for React Native, Flutter, or a parallel native codebase.

Related: `00-frontend-first-principles.md` (the worldview), `03-controllers-routing.md` (RESTful routing it depends on), `05-turbo-frames-streams.md` / `06-morphing-live-updates.md` / `07-stimulus-widgets.md` (the mechanics it rides), `12-app-blueprint.md`.

---

## 1. The position: mobile is the same one renderer

The frontend question was never "web or native" — it's **one renderer or two**. Hotwire Native keeps the answer at one.

**Do:** wrap your existing server-rendered web app in a thin Hotwire Native shell. The screens ARE the web app — the HTML/CSS your server renders, inside a native shell that intercepts link taps and pushes each page onto a real native navigation stack (platform animations, interactive pop gestures, pull-to-refresh, cached screenshots for instant back-nav). The shell is a `Navigator` managing one shared `WKWebView` (iOS) / `WebView` (Android), a JSON config file, and a few bridge components. Everything else is the Rails app you already have.

What it buys:
- **One codebase, every platform.** New screen = new page. `kamal deploy` and every client has it on next load — no app-store review, no version skew.
- **Real native app.** Real binary, nav controllers, push entitlements, store install; navigation is all native.
- **Per-screen progressive enhancement.** Any single screen — or one component on it — upgrades to Swift/Kotlin when fidelity demands; everything else stays web.

**Don't:** reach for React Native/Flutter or a parallel SwiftUI/Compose app. Each is a second renderer (a third, with two mobile platforms) plus a JSON API, client state store, router, and payload contract every codebase honors forever — the drift war from `00-frontend-first-principles.md`, re-declared on two more platforms, and worse: every fix waits on app-store review, and old binaries with old contract expectations live in the field for months.

37signals ships HEY and Basecamp to both stores this way.

---

## 2. The architecture

```
┌─────────────────────────────────────────┐
│            NATIVE SHELL (thin)           │
│  nav stack · tabs · modals · gestures    │
│  pull-to-refresh · error + retry screens │
│   ┌──────────────────────────────────┐   │
│   │   ONE SHARED WKWebView / WebView  │   │
│   │   server-rendered HTML + CSS,     │   │
│   │   Turbo · Stimulus · morphing     │   │
│   │   = the web app, unmodified       │   │
│   └──────────────────────────────────┘   │
│  path-configuration.json (also served    │
│    remotely): which URLs are modals,      │
│    tabs, native screens…                  │
│  bridge components (Swift/Kotlin) ◀──▶    │
│    paired Stimulus controllers in HTML    │
└────────────────────┬─────────────────────┘
                     │ plain HTTPS — HTML over the wire
                     ▼
┌─────────────────────────────────────────┐
│     THE RAILS APP — none the wiser       │
│  same routes · controllers · partials ·  │
│  broadcasts. One branch:                 │
│  hotwire_native_app? (user-agent check)  │
└─────────────────────────────────────────┘
```

Link tap → screenshot current page → push a new screen with the platform animation → shared web view loads the new URL. Back pops natively against the cached screenshot. The server sees ordinary Turbo requests.

---

## 3. Navigation: web semantics, native chrome

You write zero navigation code for the common cases. Web link semantics drive the native stack:

| Web event | Native behavior |
|---|---|
| Tap a link | **Push** a new screen, animated |
| Navigate to the *current* path again | **Replace** the screen |
| Navigate to the *previous* path | **Pop** back |
| `data-turbo-action="replace"` | Replace instead of push |
| Link **off your domain** | *External*: opens in-app browser (`SFSafariViewController` / Custom Tabs), outside the stack |
| `sms:` / `mailto:` / non-http schemes | Handed to the system |

Doctrine:
- **Keep every app screen on one domain** — a second domain falls out of the native stack into a browser sheet. To customize routability, the shell registers `RouteDecisionHandler`s (`Hotwire.registerRouteDecisionHandlers([...])`, first match wins) — a rare shell-level decision, not per-link.
- **Don't decorate links with native instructions.** Non-default presentation (modal, pop, clear-stack) is a *rule about a URL pattern*, declared once in the path configuration (§4).

Manual nav exists inside native screens (`navigator.route(url)`, `navigator.pop()`, `navigator.clearAll()`) — but even the escape hatch routes through a URL.

**Don't** push view controllers yourself or build a native router that owns the screen graph (the docs advise against it even for native screens): a nav change in the binary means an app-store release per flow change, and the web/native graphs drift. Your `routes.rb` is already a complete screen graph, testable with `curl` — reuse it as the native nav contract. On mobile the URL literally *is* the screen identity, the stack instruction, and the rollback lever.

---

## 4. Path configuration: navigation policy as server data

Declare any non-default presentation here, not in Swift/Kotlin. A JSON file with two keys: `settings` (app-level data / feature flags, remotely controllable) and `rules` (regex URL patterns → presentation properties). Rules apply **sequentially**: first sets the `.*` default, later rules override.

```json
{
  "settings": {},
  "rules": [
    { "patterns": [".*"],     "properties": { "context": "default", "pull_to_refresh_enabled": true } },
    { "patterns": ["/new$"],  "properties": { "context": "modal",   "pull_to_refresh_enabled": false } }
  ]
}
```

The second rule is the whole doctrine: *every form screen in the app* presents as a native modal (pull-to-refresh off so the gesture can't fight the dismiss swipe or wipe a half-entered form) — one rule, every form, including ones you haven't built. It works only because resourceful routing puts every form at `/new`. Sloppy routes (`/createWidget`, `post :open_form`) are unmatchable and each need their own rule or native code.

Properties the framework understands:

| Property | Values | Controls |
|---|---|---|
| `context` | `default` · `modal` | Push vs. present modally |
| `presentation` | `default`·`push`·`pop`·`replace`·`replace_root`·`clear_all`·`refresh`·`none` | Stack manipulation on visit |
| `pull_to_refresh_enabled` | bool | Default `true` iOS, `false` Android |
| `animated` | bool | Transition animation |
| iOS: `view_controller`, `modal_style` (`large`/`medium`/`full`/`page_sheet`/`form_sheet`), `modal_dismiss_gesture_enabled` | | Native-screen routing, modal chrome |
| Android: `uri` (required; maps to a registered fragment), `fallback_uri`, `title` | | Fragment routing |

You may add your own properties; the framework ignores what it doesn't know.

**Ship it in both places.** Bundle a copy in the binary AND serve one from Rails; the shell loads bundled first, then a cached server copy, then downloads fresh and caches for next launch:

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
        remoteFileUrl = "https://example.com/configurations/android_v1.json"))
```

Version remote filenames per platform (`ios_v1.json`); point a new build at `_v2.json` while old clients keep `_v1.json`. Patterns match path *and* query string by default; wrap query matches in `.*` both sides, or disable with `Hotwire.config.pathConfiguration.matchQueryStrings = false`.

**Don't** hardcode nav rules in the binary (a Swift `switch` on paths, per-screen booleans) — every binary rule needs an app-store review to change; every JSON rule changes by deploying Rails. Same instinct as **config over forks** for Stimulus (`07-stimulus-widgets.md`). Emergency rollbacks, A/B presentation changes, per-version compatibility are all absorbed by remote config, reversible in one deploy: bad as a push? make it a modal in JSON. Vanish tonight? `"presentation": "none"`.

---

## 5. Bridge components: HTML drives native UI

**When:** a web screen is right but one element needs native fidelity — a real nav bar-button, a native menu sheet, a native submit affordance.

A bridge component is two parts speaking one message protocol:
- **web**: a Stimulus controller subclassing `BridgeComponent` (from `@hotwired/hotwire-native-bridge`; pin with `./bin/importmap pin @hotwired/stimulus @hotwired/hotwire-native-bridge`), in your Rails app;
- **native**: a Swift/Kotlin class with the *same* `name`, registered with the shell.

Contract: web declares `static component = "name"` and calls `this.send(event, data, callback)`. Native implements `onReceive(message:)`, unpacks `message.data()`, builds native UI, and calls `reply(to:)` (iOS) / `replyTo(...)` (Kotlin) to fire the web callback. Data rides `data-bridge-*` attributes, read via `bridgeAttribute("title")` (falls back `data-bridge-title` → `aria-label` → `textContent`).

Worked example — a native bar button that "clicks" a web link:

```html
<a href="/profile" data-controller="button" data-bridge-title="Profile">View profile</a>
```
```javascript
// app/javascript/controllers/bridge/button_controller.js
import { BridgeComponent } from "@hotwired/hotwire-native-bridge"
export default class extends BridgeComponent {
  static component = "button"
  connect() {
    super.connect()
    const title = this.bridgeElement.bridgeAttribute("title")
    this.send("connect", {title}, () => { this.element.click() })
  }
}
```
```swift
final class ButtonComponent: BridgeComponent {
    override class var name: String { "button" }
    override func onReceive(message: Message) {
        guard let vc = delegate?.destination as? UIViewController,
              let data: MessageData = message.data() else { return }
        let action = UIAction { [unowned self] _ in self.reply(to: "connect") }
        vc.navigationItem.rightBarButtonItem = UIBarButtonItem(title: data.title, primaryAction: action)
    }
    struct MessageData: Decodable { let title: String }
}
```

Register once at startup: `Hotwire.registerBridgeComponents([ButtonComponent.self])` (iOS) / `Hotwire.registerBridgeComponents(BridgeComponentFactory("button", ::ButtonComponent))` (Android).

Who owns what: HTML **declares** the action; native **decorates** (renders a `UIBarButtonItem`); the tap **replies into the web**, where `this.element.click()` performs real navigation via the real link. The native component holds no state — a thin decorator over server-rendered HTML, which stays the source of truth.

Finishing discipline:
- **Hide the web fallback with scoped CSS, not by deleting it.** The bridge stamps the supported-component list on the page, so this hides the web element *only* when the running app supports the component — web users and old app versions keep the working element:
  ```css
  [data-bridge-components~="button"] [data-controller~="button"] { display: none; }
  ```
- **House bridge controllers in a `bridge/` subdirectory**, isolated from domain controllers — they're domain-blind adapters, not widgets (`07-stimulus-widgets.md`).
- **Per-platform/version guards are attributes:** `data-controller-optout-ios` / `-android` disable an instance per platform; `this.enabled` reports whether the running app supports it.

**Don't** widen the channel — no domain objects over the bridge, no native-side copy of list state, no implementing behavior natively. A bridge message carrying domain state is a payload contract with a second renderer. If a component needs more than decoration-grade data (a title, a flag, menu-item labels each pointing back at a web element), the screen is outgrowing the bridge — that's a native-screen decision (§6), not a fatter message.

---

## 6. Native screens: the escape hatch, with a server-side undo

**When:** a screen genuinely can't be a document — a live map, a camera/barcode flow, platform-SDK surfaces. Neither web content nor bridge components suffice.

Build it in Swift/Kotlin, but keep it *inside* the URL contract: every native screen keeps a URL and routes through the path configuration.

iOS — conform to `PathConfigurationIdentifiable`, match the identifier in a rule's `view_controller`, instantiate in the `NavigatorDelegate` proposal hook:
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
        default: return .accept
        }
    }
}
```

Android — annotate a fragment `@HotwireDestinationDeepLink(uri = "hotwire://fragment/numbers")`, point a rule's `uri` at it, register `Hotwire.registerFragmentDestinations(HotwireWebFragment::class, NumbersFragment::class)` — never forgetting `HotwireWebFragment`, which every ordinary URL still needs.

Links *into* it are plain `<a>`; links *out* go through `navigator.route(url)`.

**The undo is the point.** Because native screens resolve through the remotely-served path config, a broken one rolls back by deleting one JSON property: remove `view_controller` (iOS) / `uri` (Android) and the shell loads `/numbers` as a web view — no app-store review. So build the boring web version *first*; the fallback exists before the native screen does.

**Don't** take this hatch for forms, lists, or live views of shared data ("settings would feel nicer native"). The yardstick from `00-frontend-first-principles.md` §6 holds on mobile: is the user editing a *canvas*, or looking at a *document that changes*? A native screen is two implementations (Swift AND Kotlin), each needing platform expertise, each change waiting on review — per screen, forever. A web screen is one ERB template. The docs' justified examples are maps and camera flows, not CRUD. The per-screen ladder (web → bridge component → fully native) is the same escalation discipline as Hotwire's rung ladder (`00-frontend-first-principles.md` §4): reach for the lowest rung; most screens never leave rung one.

---

## 7. What changes in the Rails app: almost nothing

Native clients identify via user agent — the shell adds `"Hotwire Native iOS; Turbo Native iOS;"` (Android: `"Hotwire Native Android; …"`) plus `"bridge-components: […];"`, which powers turbo-rails' `hotwire_native_app?` helper. That predicate is the entire server-side integration surface. Three uses:

**1 — Hide web chrome for native** (the shell draws the top bar, back button, tabs):
```erb
<% unless hotwire_native_app? %>
  <%= render "shared/navbar" %>
<% end %>
```
When divergence outgrows an `unless`, promote to a variant: `request.variant = :native` in a `before_action` guarded by `hotwire_native_app?`, and Rails picks `_navbar.html+native.erb`. Same partials, same controllers. If you're variant-ing every view, you're building a second app — most screens should render identically.

**2 — Drive the native stack from controller responses.** After a native-modal form submit, the web answer ("redirect to show") is wrong; the native answer is "dismiss the modal." turbo-rails helpers (honored by iOS/Android 1.2.0+, falling back to plain redirect on web):

| Helper | Native behavior |
|---|---|
| `recede_or_redirect_to(url)` | Pop any modal, then pop the visible screen |
| `refresh_or_redirect_to(url)` | Pop any modal, then reload the screen, invalidating cache |
| `resume_or_redirect_to(url)` | Pop any modal; nothing further |

```ruby
def create
  @boost = @message.boosts.create!(boost_params)
  refresh_or_redirect_to message_url(@message)
end
```
Closing a native modal is a one-word controller change — not Swift, not Kotlin, not a bridge message.

**3 — Serve the path configuration** — a route + static file (or a controller action if `settings` varies). Updating nav policy is a deploy of this app.

**What does NOT change: auth and sessions.** The shell is a real browser loading your real domain over HTTPS — your existing cookie session (`12-app-blueprint.md` §7) works as-is; the signed cookie rides every web-view request. The login form is a web screen. If shell code must share the web view's cookies, iOS exposes `Hotwire.config.makeCustomWebView` for a `WKWebView` with a shared `WKProcessPool` — a shell concern, not Rails'. Two platform notes: camera/mic via `<input type="file">` needs `NSCameraUsageDescription` (+ `NSMicrophoneUsageDescription`) in iOS `Info.plist`; on Android, stamp `data-native-prevent-pull-to-refresh` on elements whose gestures fight pull-to-refresh.

**Don't** build token/JWT auth "because mobile apps use tokens" — that reflex belongs to API-consuming native apps; this app consumes pages, and pages already have a session. Everything the native app needs, it asks for in the browser's language: URLs, cookies, HTML, redirects. No per-client endpoints, no content-negotiation matrix, no auth fork.

---

## 8. When to build mobile apps — and what not to build

**Sequence it web-first, apps after the product is proven.** The web app is where you find the product (fastest iteration, no review gates, one deploy), and every screen you ship there is already most of the mobile app. When usage justifies store presence, the incremental cost is the thin shell: a `Navigator` + start URL (iOS getting-started is one `SceneDelegate`; Android one `HotwireActivity` + `NavigatorConfiguration`), a path config whose first draft is the canonical two rules of §4, and bridge components added as screens earn them.

What you do NOT build:
- **No API layer** — the apps consume the same server-rendered HTML; the HTML controllers ARE the API.
- **No mobile backend, BFF, serializers, or client SDK** — machinery for a second renderer you don't have.
- **No parallel design system** — the CSS is the design system; bridge components borrow native chrome where it matters.
- **No per-platform feature work** — a feature ships when the web page ships; both platforms get it instantly.

**Don't start the native apps early** ("we'll need them eventually"). Starting early forces you to stabilize screens (and contracts, if you defected to an API) before the product settles; every pre-PMF pivot then costs three codebases plus review cycles. "Later" is cheap: the apps are mostly already built, because they're the web app.