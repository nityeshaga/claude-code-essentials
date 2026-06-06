---
source: https://native.hotwired.dev/reference/bridge-components
fetched: 2026-06-06
---

# Bridge Components

## Web Components

The `BridgeComponent` class is an extension of a Stimulus [Controller](https://stimulus.hotwired.dev/reference/controllers). You have everything available in a standard `Controller` in addition to the following Hotwire Native-specific bridge functionality:

* `static component`: The unique name of the component. This must match the name you use for the corresponding native component.
* `this.platformOptingOut`: Specifies whether the controller is opted out for the current platform using the `data-controller-optout-<platform>` attribute.
* `this.enabled`: Specifies whether the component is enabled and supported by the current version of the native app.
* `this.bridgeElement`: Provides `this.element` for the component instance wrapped in a `BridgeElement`.
* `this.send(event, data = {}, callback)`: Sends a message to the native component with the `event` name, optional JSON `data`, and a `callback` to be run when the native component replies to the message.

For example, to create a `"form"` component that displays a native submit button in your native app, you'd add the following controller, target, and title attributes to your web `<form>`:

```html
<form
  method="post"
  data-controller="bridge--form">

  <!-- form elements -->

  <button
    class="button"
    type="submit"
    data-bridge--form-target="submit"
    data-bridge-title="Submit">
    Submit Form
  </button>

</form>
```

Next, create a `BridgeComponent` with named `"form"` that sends a message to the native component with `data` that contains the form's `submitTitle`. Provide a callback to run when the native component replies to the message.

```javascript
// bridge/form_controller.js

import { BridgeComponent, BridgeElement } from "@hotwired/hotwire-native-bridge"

export default class extends BridgeComponent {
  static component = "form"
  static targets = [ "submit" ]

  submitTargetConnected(target) {
    const submitButton = new BridgeElement(target)
    const submitTitle = submitButton.title

    this.send("connect", { submitTitle }, () => {
      target.click()
    })
  }
}
```

_Note: It's recommended to place your bridge components in a `/bridge` subdirectory where your Stimulus controllers live to make them easily identifiable and isolated from your other Stimulus controllers._

## Bridge Elements

The `BridgeElement` class lets you easily use bridge-specific data and behaviors on elements in your components. You can wrap any element in a `new BridgeElement(myElement)` within your bridge components to access the following:

* `title`: Returns the title of the element, attempting to use a `data-bridge-title` value first, the `aria-label` value second, then otherwise falling back to the element's `textContent` or `value`.
* `disabled`: Returns whether the element is disabled with the `data-bridge-disabled` attribute.
* `enabled`: Returns the opposite of `disabled`.
* `enableForComponent(component)`: Removes the `data-bridge-disabled` attribute on the element.
* `hasClass(className)`: Returns whether the element has a particular class in its `classList`.
* `attribute(name)`: Returns the value of an attribute on the element.
* `bridgeAttribute(name)`: Returns the value of a `data-bridge-<name>` attribute on the element.
* `setBridgeAttribute(name, value)`: Sets the value of a `data-bridge-<name>` attribute on the element.
* `removeBridgeAttribute(name)`: Removes the `data-bridge-<name>` attribute on the element.
* `click()`: Performs a click on the element.

## Data Attributes

The following data attributes can be applied to any element accessed via the `BridgeElement` class:

* `data-bridge-title="My Title"`: Specifies a custom bridge title for your element.
* `data-bridge-disabled`: Specifies whether the bridge element should be enabled or disabled for a particular platform. Values must be `"true"`, `"false"`, `"ios"`, or `"android"`.
* `data-bridge-*`: Specifies arbitrary attributes prefixed with `data-bridge-` whose values are accessible from a `BridgeElement`.

The following data attributes can be applied to elements associated with a `data-controller` and a `BridgeComponent` class:

* `data-controller-optout-ios`: Opt-out the component for your iOS app using [hotwire-native-ios](https://github.com/hotwired/hotwire-native-ios). Allows you to conditionally disable a component instance for iOS, even if the native app supports the component.
* `data-controller-optout-android`: Opt-out the component for your Android app using [hotwire-native-android](https://github.com/hotwired/hotwire-native-android). Allows you to conditionally disable a component instance for Android, even if the native app supports the component.
