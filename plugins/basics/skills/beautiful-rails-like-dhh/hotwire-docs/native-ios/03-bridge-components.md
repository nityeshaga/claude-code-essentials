---
source: https://native.hotwired.dev/ios/bridge-components
fetched: 2026-06-06
---

# Bridge Components

Hotwire Native abstracts the integration with its corresponding web bridge (formerly [Strada](https://dev.37signals.com/announcing-strada/)), making it even faster to get started. This assumes you've already installed the [Hotwire Native Bridge javaScript package](/reference/bridge-installation) on your server.

Let's walk through how to create a new component on iOS.

The component will add a native bar button item to the right side of the navigation bar. Tapping it will "click" the associated link in the HTML.

<figure>
    <img src="https://native.hotwired.dev/assets/bridge-ios-button.png" width="500" alt="Native button component on iOS">
    Native button component on iOS
</figure>

Components are made of three parts: the HTML markup, a `BridgeComponent` [Stimulus](https://stimulus.hotwired.dev) controller, and the native code. The HTML configures Stimulus which passes messages to Swift.

## Stimulus Controller

On your server, add the data attributes needed to wire up the Stimulus controller.

```html
<a href="/profile" data-controller="button" data-bridge-title="Profile">
  View profile
</a>
```

Then, create a new JavaScript `BridgeComponent` controller with the following.

```javascript
import { BridgeComponent } from "@hotwired/hotwire-native-bridge"

export default class extends BridgeComponent {
  static component = "button"

  connect() {
    super.connect()

    const element = this.bridgeElement
    const title = element.bridgeAttribute("title")
    this.send("connect", {title}, () => {
      this.element.click()
    })
  }
}
```

This component identifies itself as `"button"` via the static `component` property. It will pass all messages to a native bridge component identified with the same name.

When `data-controller="button"` is found in the DOM then `connect()` is fired. This function calls `send()` which passes the `title` of the button in JSON to its native bridge component counterpart.

The third parameter of send, the callback block, is executed when the bridge component replies back to the message, which is explained below. Here, the button is clicked.

## Swift Component

In Xcode, create a new Swift file with the following.

```swift
import HotwireNative
import UIKit

final class ButtonComponent: BridgeComponent {
    override class var name: String { "button" }

    override func onReceive(message: Message) {
        guard let viewController else { return }
        addButton(via: message, to: viewController)
    }

    private var viewController: UIViewController? {
        delegate?.destination as? UIViewController
    }

    private func addButton(via message: Message, to viewController: UIViewController) {
        guard let data: MessageData = message.data() else { return }

        let action = UIAction { [unowned self] _ in
            self.reply(to: "connect")
        }
        let item = UIBarButtonItem(title: data.title, primaryAction: action)
        viewController.navigationItem.rightBarButtonItem = item
    }
}

private extension ButtonComponent {
    struct MessageData: Decodable {
        let title: String
    }
}
```

First, the component identifies itself as `"button"` via `name` to match the Stimulus controller.

`onReceive(message:)` is called when a message is received from Stimulus. Here, the `{title}` object is unpacked to add a native button to the right side of the screen. When it's tapped, the `UIAction` is fired, replying to the message and calling the callback block, clicking the button.

Finally, register the component in `AppDelegate.swift`. This ensures that Hotwire is configured before the first URL is routed.

```swift
import HotwireNative
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        Hotwire.registerBridgeComponents([
            ButtonComponent.self
        ])
        return true
    }
}
```

## Add CSS to Hide Bridged Elements

We've now set up `"button"` components in the web and native apps. Whenever a native app supports the `"button"` component, it'll receive a message from the web component and display its native button.

There's one final piece to finish. We want to hide the web button when a native button is being displayed in the native app. It's easy to write scoped css that is only applied if:
- A particular version of the native app supports the `"button"` component
- A particular element in your app is connected to a `"button"` component

```css
[data-bridge-components~="button"]
[data-controller~="button"] {
  display: none;
}
```
