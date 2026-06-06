---
source: https://native.hotwired.dev/overview/basic-navigation
fetched: 2026-06-06
---

# Basic Navigation

Being a web-first framework means Hotwire Native adapts to your web content and how users navigate between screens: via links. Like the web, every page can link to another. Hotwire Native intercepts link taps and hands them over to its native counterpart which presents them natively – with platform-specific animations.

When a user taps on a link, here's what's happening:

1. A new screen is pushed onto the navigation stack with a native animation.
1. A spinner appears indicating the page is loading.
1. The page contents render inside the web view.

<figure>
  <img src="https://native.hotwired.dev/assets/basic-navigation.png" width="800" alt="Basic navigation">
  Hotwire Native coordinates web-to-native navigation including gestures and animations.
</figure>

## Replacing Screens

By default, every tapped link _pushes_ a new screen onto the native stack. Hotwire Native uses platform-specific animations and native components so interactions feel smooth. To users, it feels like a native app because it _is_ a native app!

The framework also applies a few sane defaults. Navigating to the _current_ page's URL path (again) will _replace_ the screen on the stack. You can also manually trigger a _replace_ action by adding `data-turbo-action="replace"` to links and forms. This will cause the visited page to replace the current screen (rather than pushing a new one) and load the new contents.

## Caching

 Navigating to the _previous_ page's URL path will _pop_ the screen off the stack back to the previous screen. This animation uses a cached screenshot, further blending the gap to native screens. On iOS, the interactive pop gesture – dragging your finger from the far left of the screen – is also supported and feels great.

## External Links

Note that if the URL of a tapped link is _not_ on the same domain as the current page it is considered _external_. External links are not routed through Hotwire Native. They instead open via an in-app web browser. iOS uses an [`SFSafariViewController`](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller) and Android uses [Custom Tabs](https://developer.chrome.com/docs/android/custom-tabs).

See the <a href="/reference/navigation#route-decision-handlers">Route Decision Handler</a> documentation to learn how urls are routed and how to customize the default behavior.

## Advanced Navigation

Hotwire Native supports a bunch of other navigation patterns like popping the entire stack and manually refreshing the current page. But individually decorating each link would create a maintenance nightmare.

So we've abstracted these _rules_ into something called the [Path Configuration](/overview/path-configuration).
