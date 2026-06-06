---
source: https://native.hotwired.dev/reference/navigation
fetched: 2026-06-06
---

# Navigation

Navigating between screens is a core concept of building Hotwire Native apps. By default, all screens will be pushed onto the main navigation stack with animation. You can customize the navigation behavior by providing path configuration rules or manually routing in Swift or Kotlin.

## Routing

Set `context` or `presentation` to a [path configuration](/reference/path-configuration) rule to apply the logic in the following table.

* **State** describes what state the app is currently in: `modal` if a modal is presented, `default` otherwise.
* **Context** is the value of the `context` property on the tapped link: `modal` or `default`. No value defaults to `default`.
* **Presentation** is the value of the `presentation` property on the tapped link: `replace`, `pop`, `refresh`, `clear_all`, `replace_root`, `none`, or `default`. No value defaults to `default`.

<table>
  <thead>
    <tr>
      <th>State</th>
      <th>Context</th>
      <th>Presentation</th>
      <th>Behavior</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>default</code></td>
      <td><code>default</code></td>
      <td><code>default</code></td>
      <td>
        Push on main stack (or)<br>
        Replace if visiting same page (or)<br>
        Pop then visit if previous screen is same URL
      </td>
    </tr>
    <tr>
      <td><code>default</code></td>
      <td><code>default</code></td>
      <td><code>replace</code></td>
      <td>Replace screen on main stack</td>
    </tr>
    <tr>
      <td><code>default</code></td>
      <td><code>modal</code></td>
      <td><code>default</code></td>
      <td>Present a modal with only this screen</td>
    </tr>
    <tr>
      <td><code>default</code></td>
      <td><code>modal</code></td>
      <td><code>replace</code></td>
      <td>Present a modal with only this screen</td>
    </tr>
    <tr>
      <td><code>modal</code></td>
      <td><code>default</code></td>
      <td><code>default</code></td>
      <td>Dismiss then Push on main stack</td>
    </tr>
    <tr>
      <td><code>modal</code></td>
      <td><code>default</code></td>
      <td><code>replace</code></td>
      <td>Dismiss then Replace on main stack</td>
    </tr>
    <tr>
      <td><code>modal</code></td>
      <td><code>modal</code></td>
      <td><code>default</code></td>
      <td>Push on the modal stack</td>
    </tr>
    <tr>
      <td><code>modal</code> </td>
      <td><code>modal</code></td>
      <td><code>replace</code></td>
      <td>Replace screen on modal stack</td>
    </tr>
    <tr>
      <td><code>default</code></td>
      <td>(any)</td>
      <td><code>pop</code></td>
      <td>Pop screen off main stack</td>
    </tr>
    <tr>
      <td><code>default</code></td>
      <td>(any)</td>
      <td><code>refresh</code></td>
      <td>Pop on main stack then</td>
    </tr>
    <tr>
      <td><code>modal</code></td>
      <td>(any)</td>
      <td><code>pop</code></td>
      <td>
        Pop screen off modal stack (or)<br>
        Dismiss if one modal screen
      </td>
    </tr>
    <tr>
      <td><code>modal</code></td>
      <td>(any)</td>
      <td><code>refresh</code></td>
      <td>
        Pop screen off modal stack then<br>
        Refresh last screen on modal stack<br>
        (or)<br>
        Dismiss if one modal screen then<br>
        Refresh last screen on main stack
      </td>
    </tr>
    <tr>
      <td>(any)</td>
      <td>(any)</td>
      <td><code>clear_all</code></td>
      <td>
        Dismiss if modal screen then<br>
        Pop to root then<br>
        Refresh root screen on main stack
      </td>
    </tr>
    <tr>
      <td>(any)</td>
      <td>(any)</td>
      <td><code>replace_root</code></td>
      <td>
        Dismiss if modal screen then<br>
        Pop to root then<br>
        Replace root screen on main stack
      </td>
    </tr>
    <tr>
      <td>(any)</td>
      <td>(any)</td>
      <td><code>none</code></td>
      <td>Nothing</td>
    </tr>
  </tbody>
</table>

### Server-Driven Routing in Rails

If you're using Ruby on Rails, the [turbo-rails](https://github.com/hotwired/turbo-rails) gem provides the following additional historical location routes. Use these to manipulate the navigation stack for Hotwire Native apps, falling back to redirecting elsewhere.

* `recede_or_redirect_to(url, **options)` - First, pops any modal screen (if present) off the navigation stack. Then, pops the visible screen off of the navigation stack.
* `refresh_or_redirect_to(url, **options)` - First, pops any modal screen (if present) off the navigation stack. Then, reloads the visible screen by performing a new web request and invalidating the cache.
* `resume_or_redirect_to(url **options)` - Pops any modal screen (if present) off the navigation stack. No further action is taken.

The iOS and Android frameworks (starting in version `1.2.0`) automatically support these historical location urls.

## Route Decision Handlers

By default, all external urls outside of your app's domain open externally. The specific behavior can be customized, though. Out-of-the-box, Hotwire Native registers these route decision handlers to control how urls are routed:
- `AppNavigationRouteDecisionHandler`: Routes all internal urls on your app's domain through your app.
- `SafariViewControllerRouteDecisionHandler`: **(iOS Only)** Routes all external `http`/`https` urls to a [SFSafariViewController](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller) in your app.
- `BrowserTabRouteDecisionHandler`: **(Android Only)** Routes all external `http`/`https` urls to a [Custom Tab](https://developer.chrome.com/docs/android/custom-tabs) in your app.
- `SystemNavigationRouteDecisionHandler`: Routes all remaining external urls (such as `sms:` or `mailto:`) through device's system navigation.

If you'd like to customize this behavior you can subclass the `RouteDecisionHandler` class in your app to provide your own implementation(s). Register your app's decision handlers in order of importance. To decide how a url should be routed, the registered `RouteDecisionHandler` instances are called in order. When a matching `RouteDecisionHandler` is found for a given url, its `handle()` function is called and no other `RouteDecisionHandler` instances will be subsequently called.

**Example for iOS:**
```swift
Hotwire.registerRouteDecisionHandlers([
    AppNavigationRouteDecisionHandler(),
    MyCustomExternalRouteDecisionHandler()
])
```

**Example for Android:**
```kotlin
Hotwire.registerRouteDecisionHandlers(
    AppNavigationRouteDecisionHandler(),
    MyCustomExternalRouteDecisionHandler()
)
```

## Manual Navigation

`Navigator` can be used to navigate from a [native screen](/overview/native-screens) to another native screen or back to a web context.

### iOS

```swift
let rootURL = URL(string: "...")!
let navigator = Navigator()

// Visit a new page.
navigator.route(rootURL.appending(path: "foo"))

// Pop the top controller off the stack.
navigator.pop()

// Pop the entire stack of controllers.
navigator.clearAll()
```

Disable the animation via the optional `animated` parameter.

```swift
navigator.route(rootURL.appending(path: "foo"), animated: false)
navigator.pop(animated: false)
navigator.clearAll(animated: false)
```

### Android

Inside of a `HotwireActivity` class:

```kotlin
val location = "https://..."
val navigator = delegate.currentNavigator

// Visit a new page.
navigator?.route("$location/foo")

// Pop the backstack to the previous destination.
navigator?.pop()

// Clear the navigation backstack to the start destination.
navigator?.clearAll()
```

Inside of a `HotwireFragment` class:

```kotlin
val location = "https://..."

// Visit a new page.
navigator.route("$location/foo")

// Pop the backstack to the previous destination.
navigator.pop()

// Clear the navigation backstack to the start destination.
navigator.clearAll()
```
