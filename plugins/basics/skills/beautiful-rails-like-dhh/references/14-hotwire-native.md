# Hotwire Native: Mobile Apps From the Web App You Already Have

Read this when the task says "mobile app," "iOS," "Android," "app store," or "we need this on phones" — before you reach for React Native, Flutter, or a parallel native codebase.

Related: `00-frontend-first-principles.md` (the worldview this extends), `03-controllers-routing.md` (the RESTful routing it depends on), `05-turbo-frames-streams.md` / `06-morphing-live-updates.md` / `07-stimulus-widgets.md` (the mechanics it rides), `12-app-blueprint.md` (where mobile sits in an app's life).

---

## 1. The position: mobile is the same one renderer

The frontend question was never "web or native" — it's **one renderer or two**. Hotwire Native keeps the answer at one.

**Do:** wrap your existing server-rendered web app in a thin Hotwire Native shell. The screens ARE the web app — the HTML/CSS your server renders, displayed inside a native shell that intercepts link taps and pushes each page onto a real native navigation stack (platform animations, interactive pop gestures, pull-to-refresh, cached screenshots for instant back-nav). The shell is a `Navigator` managing one shared `WKWebView` (iOS) / `WebView` (Android), a JSON config file, and a few bridge components. Everything else is the Rails app you already have.

What it buys:
- **One codebase, every platform.** New screen = new page. `kamal deploy` and every client has it on next load — no app-store review, no version skew.
- **Real native app.** Real binary, real nav controllers, real push entitlements. Users install from the store; navigation is all native.
- **Per-screen progressive enhancement.** Any single screen — or one component on a screen — can be upgraded to Swift/Kotlin when fidelity demands; everything else stays web.

**Don't:** reach for React Native/Flutter or a parallel SwiftUI/Compose app. Each is a **second renderer** (a third, with two mobile platforms), plus a JSON API, a client state store, a client router, and a payload contract every codebase honors forever — the exact drift war `00-frontend-first-principles.md` refuses, re-declared on two more platforms. And it's worse than the SPA version: every fix waits on app-store review, and old binaries with old contract expectations live in the field for months.

37signals ships HEY and Basecamp to both stores this way.

---

## 2. The architecture

```
                    ┌─────────────────────────────────────────┐
                    │            NATIVE SHELL (thin)           │
                    │  Navigation stack · tabs · modals        │
                    │  push/pop animations · gestures          │
                    │  pull-to-refresh · error + retry screens │
                    │   ┌──────────────────────────────────┐   │
  link tap ───────▶ │   │   ONE SHARED WKWebView / WebView  │   │
  intercepted,      │   │   server-rendered HTML + CSS      │   │
  screen pushed     │   │   Turbo Drive · Frames · Streams  │   │
  natively, page    │   │   Stimulus · morphing             │   │
  loaded inside ──▶ │   │   = the web app, unmodified       │   │
                    │   └──────────────────────────────────┘   │
                    │  path-configuration.json  ◀── also served │
                    │  (which URLs are modals,      remotely    │
                    │   tabs, native screens…)                  │
                    │  bridge components (Swift/Kotlin) ◀──▶    │
                    │  paired Stimulus controllers in the HTML │
                    └────────────────────┬─────────────────────┘
                                         │ plain HTTPS — HTML over the wire
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │     THE RAILS APP — none the wiser       │
                    │  same routes · controllers · partials ·  │
                    │  broadcasts. One branch:                 │
                    │  hotwire_native_app?  (user-agent check) │
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

**Don't** grab the nav controller and push view controllers yourself, or build a native router that owns the screen graph — the docs advise against it even for native screens. Navigation in the binary means an app-store release per flow change, and the web/native graphs drift.

**Why:** your `routes.rb` is already a complete screen graph, testable with `curl`. Reusing it as the native nav contract means one map of the app. On mobile, the URL literally *is* the screen identity, the stack instruction, and the rollback lever.

---

## 4. Path configuration: navigation policy as server data

Declare any non-default presentation here, not in Swift/Kotlin. A JSON file with two keys: `settings` (app-level data / feature flags, remotely controllable) and `rules` (regex URL patterns → presentation properties). Rules apply **sequentially**: first rule sets the `.*` default, later rules override.

```json
{
  "settings": {},
  "rules": [
    { "patterns": [".*"],     "properties": { "context": "default", "pull_to_refresh_enabled": true } },
    { "patterns": ["/new$"],  "properties": { "context": "modal",   "pull_to_refresh_enabled": false } }
  ]
}
```

The second rule is the whole doctrine: *every form screen in the app* presents as a native modal (pull-to-refresh off so the gesture can't fight the dismiss swipe or wipe a half-entered form) — one rule, every form, including forms you haven't built. It works only because resourceful routing puts every form at `/new`. Sloppy routes (`/createWidget`, `post :open_form`) are unmatchable and would each need their own rule or native code.

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

**Don't** hardcode nav rules in the binary (a Swift `switch` on paths, per-screen booleans) — every binary rule needs an app-store review to change; every JSON rule changes by deploying Rails. Same instinct as **config over forks** for Stimulus (`07-stimulus-widgets.md`): one generic shell, varied by server-controlled data.

**Why:** emergency rollbacks, A/B presentation changes, per-version compatibility — all absorbed by remote config, reversible in one deploy. Screen behaves badly as a push? Make it a modal in JSON. Needs to vanish tonight? `"presentation": "none"`.

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

Who owns what: HTML **declares** the action; native **decorates** (renders a `UIBarButtonItem`); the tap **replies into the web**, where `this.element.click()` performs real navigation via the real link. The native component holds no state and triggers no behavior of its own — a thin decorator over server-rendered HTML, which stays the source of truth.

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

**The undo is the point.** Because native screens resolve through the remotely-served path config, a broken one rolls back by deleting one JSON property: remove `view_controller` (iOS) / `uri` (Android) and the shell loads `/numbers` as a web view — a page you control, no app-store review. So build the boring web version *first*; the fallback exists before the native screen does. Capped downside (revert is a JSON edit), native upside.

**Don't** take this hatch for forms, lists, or live views of shared data ("settings would feel nicer native," "the feed should be a native list"). The yardstick from `00-frontend-first-principles.md` §6 holds on mobile: is the user editing a *canvas*, or looking at a *document that changes*? A native screen is two implementations (Swift AND Kotlin), each needing platform expertise, each change waiting on review — per screen, forever. A web screen is one ERB template. The docs' justified examples are maps and camera flows, not CRUD.

**Why:** the per-screen ladder — web screen → bridge component → fully native — is the same escalation discipline as Hotwire's rung ladder (`00-frontend-first-principles.md` §4): reach for the lowest rung; most screens never leave rung one. That's how one person (or one agent) ships full products to both stores.

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

**Don't** build token/JWT auth "because mobile apps use tokens" — that reflex belongs to API-consuming native apps; this app consumes pages, and pages already have a session.

**Why:** everything the native app needs, it asks for in the browser's language — URLs, cookies, HTML, redirects. The native shell is just one more client honoring the same boundary: no per-client endpoints, no content-negotiation matrix, no auth fork.

---

## 8. When to build mobile apps — and what not to build

**Sequence it web-first, apps after the product is proven.** The web app is where you find the product (fastest iteration, no review gates, one deploy), and every screen you ship there is already most of the mobile app. When usage justifies store presence, the incremental cost is the thin shell: a `Navigator` + start URL (iOS getting-started is one `SceneDelegate`; Android one `HotwireActivity` + `NavigatorConfiguration`), a path config whose first draft is the canonical two rules of §4, and bridge components added as screens earn them. Mobile is a new *client* of steps you already finished, not a new feature pipeline.

What you do NOT build:
- **No API layer** — the apps consume the same server-rendered HTML; the HTML controllers ARE the API.
- **No mobile backend, BFF, serializers, or client SDK** — all machinery for feeding a second renderer you don't have.
- **No parallel design system** — the CSS is the design system; bridge components borrow native chrome where it matters.
- **No per-platform feature work** — a feature ships when the web page ships; both platforms get it instantly.

**Don't start the native apps early** ("we'll need them eventually"). Starting early forces you to stabilize screens (and contracts, if you defected to an API) before the product settles; every pre-PMF pivot then costs three codebases plus review cycles. "Later" is cheap here: the apps are mostly already built, because they're the web app.

**Why:** web-first costs nothing on mobile-day-one (the shell wraps whatever exists) and saves the entire drift war if the product pivots. Take the bet with capped downside.

---

## 9. Red flags → fixes

| Red flag | The fix |
|---|---|
| React Native / Flutter / parallel SwiftUI-Compose for a server-rendered product | Hotwire Native shell — the screens are the web app; one renderer, every platform (§1) |
| Building a JSON API "for the mobile app" | Apps consume the same HTML; the HTML controllers ARE the API (§8, `12-app-blueprint.md` §9) |
| Writing a screen natively that's just a form, list, or live document | It's a web screen; canvas-vs-document yardstick holds on mobile (§6, `00-frontend-first-principles.md` §6) |
| Hardcoding nav rules in the binary (URL switches, per-screen flags) | Path configuration rules — nav policy is server-controllable data (§4) |
| Path config bundled only locally, or served only remotely | Both: bundled for offline first-launch, remote for live control; versioned `ios_v1.json` / `android_v1.json` (§4) |
| Decorating individual links with native presentation | One regex rule per URL *pattern* — `"/new$"` → modal covers every form (§4) |
| Forms as pushed screens with pull-to-refresh on | `context: modal`, `pull_to_refresh_enabled: false` — the gesture fights the dismiss swipe and eats input (§4) |
| Bridge messages carrying domain state or behavior | Bridge data is decoration-grade (titles, flags); behavior stays in the HTML the native side clicks into (§5) |
| Deleting the web element a bridge component replaces | Hide via `[data-bridge-components~=…]`-scoped CSS so unsupported clients keep the fallback (§5) |
| Bridge controllers mixed with domain Stimulus controllers | `bridge/` subdirectory; domain-blind adapters, a different species (§5) |
| Pushing native view controllers / fragments manually | Route everything — even native screens — through path config via `view_controller` / `uri` (§3, §6) |
| Native screen shipped with no web fallback | Build the web version first; rollback is then deleting one JSON property (§6) |
| Token/JWT auth flows built for the apps | The shell is a browser on your domain; the cookie session works as-is (§7) |
| Controller redirects stranding native modals after submit | `recede_or_refresh_or_resume_or_redirect_to` family — the server drives the native stack (§7) |
| `hotwire_native_app?` branches multiplying through every view | Hide chrome and little else; if every view forks, you're building a second app — promote to variants sparingly (§7) |
| App screens served from a second domain | Off-domain is *external* — it falls into an in-app browser; keep one domain (§3) |
| Starting native apps before the web product is proven | Web first; the shell wraps whatever exists, later, cheaply (§8) |

---

**Bottom line:** mobile is not a second product — it's the same one renderer, wearing platform chrome. The server keeps rendering every screen, the URL keeps carrying the contract (now into the navigation stack), and the native code is a thin shell plus small decorators, all overridable from the server you already deploy. The discipline — RESTful routes, one domain, one renderer, HTML as source of truth — is the same the rest of the skill demanded. The apps are the reward for having followed it.