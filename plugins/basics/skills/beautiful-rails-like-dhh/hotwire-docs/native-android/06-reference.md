---
source: https://native.hotwired.dev/android/reference
fetched: 2026-06-06
---
# Reference

## Navigator

The `Navigator` is the central coordinator in a Hotwire Native Android application. Each `NavigatorHost` in your Activity maintains a `Navigator` instance, which manages the stack of `HotwireFragment` screens with a single, shared `WebView` instance. It lets your app choose how to handle link taps, present new screens, and deal with errors.

## Custom WebView

You can customize and subclass the `HotwireWebView` class to provide custom behaviors in your app:

```kotlin
Hotwire.config.makeCustomWebView = { context ->
    MyCustomWebView(context, null)
}
```

## Custom HTML data attributes

- `data-native-prevent-pull-to-refresh`: Apply to any element in your web app whose touch events conflict with the native pull-to-refresh behavior in the `WebView`. By default, scrollable elements prevent pull-to-refresh, but you may need to apply this custom attribute to elements that have draggable or swipeable behaviors.
