---
source: https://native.hotwired.dev/android/native-screens
fetched: 2026-06-06
---
# Native Screens

To render a native screen on Android you need match an identifier in the [path configuration](https://native.hotwired.dev/overview/path-configuration) with your fragment.

First, create a URL path pattern and set its `uri` property. This path configuration routes all URLs ending in `/numbers`. You can also set a `title` to set the native title when the fragment is presented.

```json
{
  "settings": {},
  "rules": [
    {
      "patterns": [
        "/numbers$"
      ],
      "properties": {
        "uri": "hotwire://fragment/numbers",
        "title": "Numbers"
      }
    }
  ]
}
```

When a link is intercepted by Hotwire Native, it will go through its usual process of matching the link's URL path to all rules in the app's Path Configuration. When it matches the above rule, it will propose a `visit` and resolve the matching `HotwireDestination` whose `uri` matches `"hotwire://fragment/numbers"`.

Create a new fragment and provide a matching `HotwireDestinationDeepLink` annotation.

```kotlin
@HotwireDestinationDeepLink(uri = "hotwire://fragment/numbers")
class NumbersFragment : HotwireFragment() {
    // ...
}
```

Finally, register this fragment with Hotwire Native to use it when the URL path matches. See the [configuration](https://native.hotwired.dev/android/configuration) docs for a recommendation on where to register fragments in your code.

Note that if you decide to register your own fragments, you must also register `HotwireWebFragment` for URL paths that do not match your custom fragment's path.

```kotlin
Hotwire.registerFragmentDestinations(
    HotwireWebFragment::class, // Don't forget to register this for regular destinations
    NumbersFragment::class
)
```

## Progressive Rollout

In a purely native app, if a new screen presented an issue you'd be unable to react immediately. The usual process would be to rush out bug fixes and hope for a quick review. If the bug was severe or your team needed more time to fix a critical issue, you'd have to rollback to a previous app version and submit that to the Play Store for review.

Since even native screens are routed through Hotwire Native, the Path Configuration is a powerful ally when it comes to rolling out your native screens. If you were to find a critical issue with your native screen, you could easily update your remote Path Configuration and either point to your web content so users don't lose functionality, or immediately disable the screen altogether – no app store review required.

Simply remove the `"uri"` property and Hotwire Native will stop using your native screen, instead presenting a web view controller which loads `"/numbers"`: a web page you fully control.

```json
{
  "settings": {},
  "rules": [
    {
      "patterns": [
        "/numbers$"
      ],
      "properties": { }
    }
  ]
}
```

Check out the [demo app](https://github.com/hotwired/hotwire-native-android/tree/main/demo) to see how everything is wired up and for more complex examples.
