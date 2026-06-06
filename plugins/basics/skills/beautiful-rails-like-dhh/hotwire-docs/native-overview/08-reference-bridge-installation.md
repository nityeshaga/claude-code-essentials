---
source: https://native.hotwired.dev/reference/bridge-installation
fetched: 2026-06-06
---

# Installation

To build Bridge Components in your native app, you'll need to first install the [Hotwire Native Bridge](https://github.com/hotwired/hotwire-native-bridge) javascript library in your web app. Hotwire Native Bridge can either be referenced in compiled form via the distributable script directly in the `<head>` of your application, or through npm via a bundler like esbuild.

## Prerequisite: Install Stimulus

Bridge Components in your web app leverage [Stimulus](https://stimulus.hotwired.dev) and the core `BridgeComponent` class is an extension of a Stimulus `Controller`. You must have Stimulus installed in your web app before installing Hotwire Native Bridge. See the [Stimulus installation instructions](https://stimulus.hotwired.dev/handbook/installing).

## In Compiled Form

If you're using [importmap-rails](https://github.com/rails/importmap-rails) you just need to pin Stimulus and Hotwire Native Bridge in your config/importmap.rb file:

```sh
./bin/importmap pin @hotwired/stimulus @hotwired/hotwire-native-bridge
```

Alternatively, you can manually define importmap entries for both Hotwire Native Bridge and Stimulus, pointing to the latest versions of each:

```html
<head>
  <script type="importmap">
    {
      "imports": {
        "@hotwired/stimulus": "https://cdn.jsdelivr.net/npm/@hotwired/stimulus@latest/dist/stimulus.min.js",
        "@hotwired/hotwire-native-bridge": "https://cdn.jsdelivr.net/npm/@hotwired/hotwire-native-bridge@latest/dist/hotwire-native-bridge.min.js"
      }
    }
  </script>
</head>
```

Then you can import Hotwire Native Bridge anywhere in your application code:

```js
import { BridgeComponent } from "@hotwired/hotwire-native-bridge"

class BridgeTest extends BridgeComponent {
  // ...
}
```

## As An npm Package

You can install Hotwire Native Bridge [from npm](https://www.npmjs.com/package/@hotwired/hotwire-native-bridge) via the `npm` or `yarn` packaging tools and use a JavaScript bundler, like webpack or esbuild, to import it in your application.

```javascript
import "@hotwired/hotwire-native-bridge"
```


