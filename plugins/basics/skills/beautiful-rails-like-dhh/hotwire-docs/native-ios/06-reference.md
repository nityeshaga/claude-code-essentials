---
source: https://native.hotwired.dev/ios/reference
fetched: 2026-06-06
---

# Reference

There are a few main types in Hotwire Native iOS, most notably `Navigator` and `Visitable`.

## Navigator

The `Navigator` is the central coordinator in a Hotwire Native iOS application. Each `Navigator` manages the stack of screens via a `UINavigationController` with a single, shared `WKWebView` instance. It lets your app choose how to handle link taps, present view controllers, and deal with errors.

### Creating a `Navigator`

Create with no parameters to use the default configuration:

```swift
let navigator = Navigator()
```

Provide optional [path configuration](path-configuration) to configure settings and path rules:

```swift
let navigator = Navigator(pathConfiguration: pathConfiguration)
```

Provide an optional [delegate](#navigatordelegate) to configure how different URLs, errors, and external links are handled:

```swift
let navigator = Navigator(delegate: delegate)

extension SceneController: NavigatorDelgate {
    // ...
}
```

Customize the underlying `WKWebView` and configuration with a block. For example, to use a custom `WKProcessPool` to share cookies from web views outside of Hotwire Native:

```swift
Hotwire.config.makeCustomWebView = { config in
    config.processPool = processPool
    return WKWebView(frame: .zero, configuration: config)
}
```

## `NavigatorDelegate`

The delegate is an optional interface you can implement to customize behavior of the `Navigator`.

### Handling Proposals

Hotwire Native iOS calls the `handle(proposal:)` method before every visit, such as when you tap a Turbo-enabled link or call `Turbo.visit(...)` in your web application. Implement this function to choose how to handle the specified URL and action. This is called a *proposal* since your application is not required to complete the visit.

Return one of the following three `ProposalResult` cases:
* `accept`: Proposals are accepted and a new [`HotwireWebViewController`](#hotwirewebviewcontroller) is displayed.
* `acceptCustom(UIViewController)`: Provide a custom view controller to be displayed.
* `reject`: No changes to navigation occur, the visit is effectively cancelled.

### Handling External URLs

Implement `handle(externalURL:)` to customize the behavior when an external URL is visited. URLs are considered "external" if they do not match the same domain as the first visited link. By default, this will present a [`SFSafariViewController`](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller) modally.

### Handling Errors

Network errors and responses with HTTP status codes outside of the 200 range are considered errors. By default a native screen with the error's localized description and a Retry button is presented.

Customize this behavior by implementing `visitableDidFailRequest(_:error:retryHandler:)`. Call `retryHandler()` to attempt the network request again.

## `HotwireWebViewController`

A `HotwireWebViewController` is a `UIViewController` that can be visited by a `Navigator`. Each view controller provides a `VisitableView` instance, which acts as a container for the shared `WKWebView`. The `VisitableView` optionally has a pull-to-refresh control and an activity indicator. It also automatically displays a screenshot of its contents when the web view moves to another `VisitableView`.

Most applications will probably want to subclass `HotwireWebViewController` to customize its layout or add additional views. If your application’s design prevents you from subclassing `HotwireWebViewController`, you can implement the `Visitable` and `BridgeDestination` protocols yourself.

Note: Custom `Visitable` view controllers must notify their delegate of their `viewWillAppear` and `viewDidAppear` methods through the `VisitableDelegate`'s `visitableViewWillAppear` and `visitableViewDidAppear` methods. The `Navigator` uses these hooks to know when it should move the `WKWebView` from one `VisitableView` to another.

## Enable camera access

To enable camera access via `<input type="file">`, add the [`NSCameraUsageDescription`](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription) key to your app’s `Info.plist` with a `String` value explaining why your app needs access to the camera. Add [`NSMicrophoneUsageDescription`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription) as well to allow recording audio when capturing video. Without adding these, your app will crash when you try to use the camera.
