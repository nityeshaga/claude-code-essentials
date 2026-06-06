---
source: https://native.hotwired.dev/overview/how-it-works
fetched: 2026-06-06
---

# How it works

Hotwire Native displays whatever HTML and CSS your server renders within a native shell and will react to intercepted link taps. This makes your mobile web content feel at home on Android and iOS by using standard, platform-specific navigation and animations.

<figure>
  <img src="https://native.hotwired.dev/assets/native-vs-web-ios.jpg" width="1200" alt="Native vs. web">
  Content is all web. Navigation is all native.
</figure>

Hotwire Native intercepts link taps and passes control off to a native adapter. This adapter makes sure the experience is seamless: it screenshots the current page before pushing (or presenting) new screens on the native stack with a default, platform-specific animation. It will then request the web content for this new screen and render it via the web view.

If the user navigates "back" to a previous screen Hotwire Native will use cached screenshots, and because we are using native navigation controls, interactive pop gestures work exactly as expected. Even the most tech-savvy users will have a hard time believing it's not a fully native app!

Yet, the core of Hotwire Native is still a web browser which makes adding new screens as straightforward as building new pages in your web app. Your Android and iOS clients see updates as soon as you deploy. All without new submissions to the app stores.

Hotwire Native's web-first approach means upgrading to native isn’t an all-or-nothing decision. You are free to choose specific screens or even specific *components* to write natively in Swift or Kotlin when you’re ready. It truly is progressive enhancement.
