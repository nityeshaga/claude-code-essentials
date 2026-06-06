---
source: https://native.hotwired.dev/ios/native-screens
fetched: 2026-06-06
---

# Native Screens

If you need to go fully native, we've got you covered: it's easy to integrate native screens to Hotwire Native's navigation flow. Even though you may be tempted to get a reference to Hotwire Native's navigation controller and push/present yourself, we strongly advise against it. It's better to leverage the power of Hotwire Native's [Path Configuration](/ios/path-configuration), even for native screens.

First, conform your view controller to `PathConfigurationIdentifiable` and provide a matching `pathConfigurationIdentifier`. When Hotwire Native intercepts a link, the identifier is used to resolve that a native view controller was requested.

```swift
class NumbersViewController: UITableViewController, PathConfigurationIdentifiable {
    static var pathConfigurationIdentifier: String { "numbers" }

    init(url: URL) {
        self.url = url
    }

    // ...
}
```

Next, create a URL path pattern to match against, and set its `view_controller` property. This path configuration routes all URLs ending in `/numbers`:

```json
{
  "settings": {},
  "rules": [
    {
      "patterns": [
        "/numbers$"
      ],
      "properties": {
        "view_controller": "numbers"
      }
    }
  ]
}
```

When a link is intercepted by Hotwire Native, it will go through its usual process of matching the link's URL path to all rules in the app's Path Configuration. When it matches the above rule, it will create a `VisitProposal` and will set this `view_controller` property to `"numbers"`.

You can inspect this property when `handle(proposal:)` is called on `Navigator`'s delegate and instantiate your own view controller there. That's it! Hotwire Native will handle presentation (push/replace and animations) as if it were a web view controller.

```swift
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    private lazy var navigator = Navigator(
        configuration: .init(name: "main", startLocation: rootURL),
        delegate: self
    )

    // ...
}

extension SceneDelegate: NavigatorDelegate {
    func handle(proposal: VisitProposal, from navigator: Navigator) -> ProposalResult {
        switch proposal.viewController {
        case NumbersViewController.pathConfigurationIdentifier:
            let numbersViewController = NumbersViewController(url: proposal.url)
            return .acceptCustom(numbersViewController)
        default:
            return .accept
        }
    }
}
```

## Progressive Rollout

In a purely native app, if a new screen presented an issue you'd be unable to react immediately. The usual process would be to rush out bug fixes and hope for a quick review. If the bug was severe or your team needed more time to fix a critical issue, you'd have to rollback to a previous app version and submit that to the App Store, probably with an expedited review.

Since even native screens are routed through Hotwire Native, the Path Configuration is a powerful ally when it comes to rolling out your native screens. If you were to find a critical issue with your native screen, you could easily update your remote Path Configuration and either point to your web content so users don't lose functionality, or immediately disable the screen altogether – no app store review required.

Simply remove the `"view_controller"` property and Hotwire Native will stop using your native screen, instead presenting a web view controller which loads `"/numbers"`: a web page you fully control.

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

Check out the [demo app](https://github.com/hotwired/hotwire-native-ios/tree/main/Demo) to see how everything is wired up and for more complex examples.
