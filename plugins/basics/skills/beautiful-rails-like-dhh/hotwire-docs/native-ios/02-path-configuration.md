---
source: https://native.hotwired.dev/ios/path-configuration
fetched: 2026-06-06
---

# Path Configuration

Building on the [overview of path configuration](/overview/path-configuration), here's an example for an iOS app.

```json
{
  "settings": {},
  "rules": [
    {
      "patterns": [
        ".*"
      ],
      "properties": {
        "context": "default",
        "pull_to_refresh_enabled": true
      }
    },
    {
      "patterns": [
        "/new$"
      ],
      "properties": {
        "context": "modal",
        "pull_to_refresh_enabled": false
      }
    }
  ]
}
```

This configuration does two things:

1. Sets *all* URL path patterns with pull-to-refresh enabled.
1. Overrides URL path patterns *ending* in `/new` to be presented as a modal with pull-to-refresh disabled. It is helpful to disable pull-to-refresh in modals so it doesn't interfere with the dismiss gesture or clear form data that a user may have entered.

## Sources

Path configuration has an array of `sources`. You can configure the source to be a locally bundled file, a remote file available from your server, or both. We recommend always including a bundled version even when loading remotely, so it will be available in case your app is offline.

Set up your path configuration in `AppDelegate.swift`. This ensures that Hotwire is configured before the first URL is routed.

```swift
import HotwireNative
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let localPathConfigURL = Bundle.main.url(forResource: "path-configuration", withExtension: "json")!
        let remotePathConfigURL = URL(string: "https://example.com/configurations/ios_v1.json")!

        Hotwire.loadPathConfiguration(from: [
            .file(localPathConfigURL),
            .server(remotePathConfigURL)
        ])

        return true
    }
}
```

If you provide both a file and a server location, the path configuration will be loaded asynchronously in the following order:
1. The local file bundled with your app.
2. A locally cached copy of the server configuration (if a successful download occurred on a previous app launch).
3. A newly downloaded copy of the server configuration. (Once this has downloaded successfully, it will be cached and used in step 2 on the next app launch.) 

## Query String Matching

By default, path patterns match against the path component *and* query string of the URL.

To ensure the order of query string parameters don't affect matching, a wildcard `.*` before and after the match is recommended, like so:

```
{
  "patterns": [".*\\?.*foo=bar.*"],
  "properties": {
    "foo": "bar"
  }
}
```

Disable query string matching via:

```swift
Hotwire.config.pathConfiguration.matchQueryStrings = false
```

The [path configuration reference](/reference/path-configuration) provides more information, including all the behavior Hotwire Native provides out of the box.
