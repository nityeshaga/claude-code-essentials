---
source: https://native.hotwired.dev/overview/path-configuration
fetched: 2026-06-06
---

# Path Configuration

Advanced navigation in Hotwire Native apps can be configured via a JSON file called the *path configuration*. The *path configuration* is broken down into two top-level objects: `settings` and `rules`. An empty path configuration requires both keys, as follows:

```json
{
  "settings": {},
  "rules": []
}
```

`settings` contains app-level configuration items. These settings can be read when the *path configuration* is first loaded; common use cases include feature-flags or custom app information that you want to control remotely.

`rules` contains entries that define navigation within the Hotwire app. Each entry contains regex patterns used to identify URLs and then apply the specified behavior on navigation. In the following example, all URLs matching the regex `/new$` will open up in a modal screen, rather than being pushed onto the default navigation stack:

```json
{
  "settings": {
    "feature_flags": [
        {
          "name": "new_onboarding_flow",
          "enabled": true
        }
      ]
  },
  "rules": [
    {
      "patterns": [
        "/new$"
      ],
      "properties": {
        "context": "modal"
      }
    },
  ]
}
```

It's recommended that the *path configuration* file exists both locally (bundled with your app's binary) and remotely (on your server). The local *path configuration* ensures a smooth initial launch, while the remote *path configuration* unlocks a powerful perk: you can change the app's behavior from your server without needing to publish a new app update.

## Versioning

It is recommended to version your path configuration file names and use a unique resource for each OS platform, like so:

* `/configurations/ios_v1.json`
* `/configurations/android_v1.json`

This allows forward and backward compatibility with new app versions that you release. If you make breaking changes in a new version of your app, point to `*_v2.json` for the new build. Keep old versions available on your server so older clients can continue to work properly until the user's app is updated on their device.

See the [iOS](/ios/path-configuration)- and [Android](/android/path-configuration)-specific pages on path configuration for more details and examples.

The [path configuration reference](/reference/path-configuration) provides more information including all the behavior Hotwire Native provides out of the box.
