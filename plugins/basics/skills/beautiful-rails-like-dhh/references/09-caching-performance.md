# Caching & Performance: The Key You Never Maintain

Read this when anything is slow, when you're about to add fragment or HTTP caching, when you're tempted to bump a cache version or a counter by hand, or when a cached page is serving stale content and you don't know why.

**Contents**

1. [The root rule: never maintain the key by hand](#1-the-root-rule-never-maintain-the-key-by-hand)
2. [Fragment caching: hand `cache` the record](#2-fragment-caching-hand-cache-the-record)
3. [The digest's blind spots: the dated-comment escape hatch](#3-the-digests-blind-spots-the-dated-comment-escape-hatch)
4. [Russian-doll nesting: warm shells make parent re-renders cheap](#4-russian-doll-nesting-warm-shells-make-parent-re-renders-cheap)
5. [`touch: true` is the freshness graph, declared once](#5-touch-true-is-the-freshness-graph-declared-once)
6. [Collection caching: `cached: true` is one `read_multi`](#6-collection-caching-cached-true-is-one-read_multi)
7. [HTTP caching: `stale?(etag:)` gates the entire body](#7-http-caching-staleetag-gates-the-entire-body)
8. [`fresh_when` and composite ETags](#8-fresh_when-and-composite-etags)
9. [Push freshness to the edge: `expires_in`, `public:`, `stale_while_revalidate`](#9-push-freshness-to-the-edge-expires_in-public-stale_while_revalidate)
10. [Change the content, change the URL](#10-change-the-content-change-the-url)
11. [Derived cache vs stored counter: when storing a computed value is allowed](#11-derived-cache-vs-stored-counter-when-storing-a-computed-value-is-allowed)
12. [Red flags → fixes](#12-red-flags--fixes)

Scope: this file owns freshness — fragment caching, HTTP caching, and the derivation discipline behind both. The `dom_id` addressing and one-partial-per-row mechanics that cached fragments sit on live in `04-views-helpers.md`. The ETag-as-derivation worldview (a 304 is "derive, don't store" at the HTTP layer) is summarized in `01-doctrine.md`; this file has the operative mechanics. The `touch:` + `broadcasts_refreshes` + `turbo_stream_from` composition that makes multiplayer emerge lives in `06-morphing-live-updates.md` — §5 below shows how the same `touch:` declaration serves both.

---

## 1. The root rule: never maintain the key by hand

**When:** Always. This is the load-bearing idea behind every section in this file — internalize it before writing any caching code.

**Do:** Derive the cache key from the data it caches, so that "the content changed" and "the key changed" are the same event — true by construction, not by vigilance. The derivation has one shape at three altitudes:

| Altitude | The derived key | Mechanism |
|---|---|---|
| View fragment | `updated_at` (the record's `cache_version`) | `cache record do` |
| HTTP response | an ETag computed from the record/collection | `stale?(etag:)` / `fresh_when` |
| URL | a version stamp or content hash in the URL itself | `v: updated_at` param; digested asset filenames |

**Not:** You will be tempted to write a key with a hand-bumped version integer in it — `Rails.cache.fetch("message-#{message.id}-v3")` — and to keep it fresh with a callback that re-touches the parent:

```ruby
# DO NOT WRITE THIS — you just became the version-control system
<% Rails.cache.fetch("message-#{message.id}-v3") do %>   # bump v3→v4 by hand, in every call site, on every markup change
  <%= render "messages/message", message: message %>
<% end %>

class Boost < ApplicationRecord
  belongs_to :message
  after_create { message.update(updated_at: Time.current) }   # ...and you forgot the same line on destroy
end
```

Don't. Every piece of that is a freshness fact maintained by hand: the `v3` you must bump across every file that references it, the `after_create` that covers create but silently skips destroy — so deleting a reaction leaves the stale HTML on screen with no error anywhere.

**Why:** A cache key is a second source of truth about "has this changed?", and a second source of truth eventually disagrees with the first. Stale-cache bugs don't crash — the cache quietly serves yesterday's HTML, and you debug it for an hour because nothing errors. Derive the key and that entire bug class becomes unwriteable: there is no version to forget to bump, because there is no version you maintain. This is "derive, don't store" applied to freshness.

---

## 2. Fragment caching: hand `cache` the record

**When:** A chunk of view is rendered repeatedly with unchanged output — a message row, a notification, a card — and re-rendering it (Markdown passes, helper calls, nested partials) is the cost you want to skip.

**Do:** Wrap the fragment in `cache` and pass it the **record**, not a string (Campfire's message partial; Fizzy's notification partial uses the identical idiom — house doctrine):

```erb
<%# messages/_message.html.erb (Campfire) %>
<% cache message do %>
  <%= message_tag message do %>
    ...the whole message: avatar, author, timestamp, body, boosts...
  <% end %>
<% end %>
```

Handing `cache` an Active Record object makes Rails build the key from three parts:

1. the model name and `id` (`messages/472`),
2. the record's **`cache_version`** — which defaults to `updated_at`, a column the database already maintains on every write,
3. the **template digest** — a hash of the partial's source and its declared dependencies, folded in automatically.

Part 2 means a data change busts the fragment (edit the body → `updated_at` bumps → new key). Part 3 means a **markup** change busts it too (edit the partial → its digest changes → every fragment's key changes on the next deploy). You never typed a version number; both kinds of change are covered without one.

**Not:** You will be tempted to assemble the key string yourself — `cache "message-#{message.id}"` or the `Rails.cache.fetch` form from §1 — don't. A hand-assembled key opts you out of `cache_version` and the template digest, which are the entire point.

**Why:** The `updated_at` IS the version number. "The content changed" and "the key changed" become one event, and the only bookkeeping is a column the database already does. Count the edge cases this one argument-type choice absorbs: data edits, markup edits, deploys, and every call site agreeing on the key format — all free.

---

## 3. The digest's blind spots: the dated-comment escape hatch

**When:** A cached fragment's output depends on something the template digest cannot see — a helper method's markup, or a hand-maintained twin template (e.g. a static optimistic-UI placeholder that mirrors the real partial).

**Do:** Make the invisible dependency loud with a comment **at the exact spot the convention goes blind**. Campfire guards its twin-template coupling on the partial's first line:

```erb
<%# Be sure to check/update messages/_template.html.erb when changing this file %>
<% cache message do %>
  ...
```

Fizzy guards a helper dependency the same way — a dated comment right under its `cache` call, updated whenever the helper's markup changes (updating the comment changes the template source, which changes the digest, which busts the fragments):

```erb
<%# notifications/_notification.html.erb (Fizzy) %>
<% cache notification do %>
  <%# Helper Dependency Updated: avatar_image_tag 2025-12-15 %>
  ...
```

Two products, the same escape hatch, in the same spot — house doctrine for the blind spot.

**Not:** You will be tempted to either ignore the gap ("the helper rarely changes") or to reintroduce a hand-bumped version (`cache [message, "v2"]`) to cover it — don't. The first ships stale HTML the day the helper changes; the second resurrects the `v3` problem of §1 for every key, to cover a gap that exists at one spot.

**Why:** The template digest sees render-graph dependencies (`render "x"` calls), not Ruby method bodies and not files Rails never renders. Where the machine can't enforce the coupling, the next best thing is to make a human enforce it — and the dated-comment trick converts the human act (editing the comment) into the machine event (a digest change). The manual surface area stays exactly as large as the blind spot, no larger.

---

## 4. Russian-doll nesting: warm shells make parent re-renders cheap

**When:** A cached fragment contains other cacheable units — a message contains boosts, a board contains columns contain cards — and a child changes often while its siblings don't.

**Do:** Cache the children as fragments **inside** the parent's fragment, each keyed on its own record (Campfire):

```erb
<%# messages/_message.html.erb — the outer doll %>
<% cache message do %>
  ...avatar, author, body...
  <%# each boost is its own inner doll %>
  <% message.boosts.each do |boost| %>
    <%= render "messages/boosts/boost", boost: boost %>
  <% end %>
<% end %>

<%# messages/boosts/_boost.html.erb — the inner doll %>
<% cache boost do %>
  <div id="<%= dom_id(boost) %>" class="boost">
    ...the booster's avatar, the emoji, a delete button...
  </div>
<% end %>
```

For nesting to work, a child's change must bust the parent's fragment — the parent's key is its `updated_at`, so the child must bump it. That wiring is §5's one token (`touch: true`), not a callback.

**Not:** You will be tempted to reject the design because "re-rendering the parent on every child change is the slow thing I was avoiding" — don't. The parent re-render is cheap *because of* the nesting: every unchanged child is served from its own warm fragment; only the changed one renders fresh. Add a boost to a message in a 200-message room and you pay for one boost — not one message, and not 200 messages.

**Why:** Each shell caches independently, so busting an outer doll never re-costs the inner ones. That's the entire "doll": invalidation flows outward (child busts parent busts grandparent), but render cost stays local to what actually changed.

---

## 5. `touch: true` is the freshness graph, declared once

**When:** A cached fragment's content depends on child records — the message fragment shows its boosts; the sidebar's room entry shows recency — so a child's write must expire the parent's cache.

**Do:** Declare the dependency with one token on the association that owns the relationship, and let it climb levels (Campfire, verbatim):

```ruby
class Boost < ApplicationRecord
  belongs_to :message, touch: true   # boost write → message.updated_at bumps → message fragment busts
end

class Message < ApplicationRecord
  belongs_to :room, touch: true      # message write → room.updated_at bumps → sidebar reorders, room fragments bust
end
```

`touch: true` fires on create, update, **and destroy** of the child, bumping the parent's `updated_at` — which is the parent's cache key (§2), so the parent re-renders and stitches itself from its warm children (§4). The second declaration climbs a level: writing a message touches the room, which both busts the room's own cached fragments and reorders it in any recency-sorted sidebar. One declaration per relationship edge wires the entire freshness dependency graph. Fizzy wires its board the same way (`belongs_to :board, touch: true` on Column) — house doctrine.

**Not:** You will be tempted to wire freshness with callbacks — `after_create { message.update(updated_at: Time.current) }` — don't. That covers exactly the one path you remembered, on the day you remembered it; the destroy path you forgot leaves a deleted reaction on screen until something else happens to bust the cache, and nothing errors in the meantime.

**Why:** Count the edge cases this one token absorbs: create-busts-cache, update-busts-cache, destroy-busts-cache, and reorder-the-parent-list — across every code path that ever touches the child, including ones not yet written. And the same declaration is doing double duty: in a live app, the `touch:` chain is also what fans out `broadcasts_refreshes` to every subscribed browser (see `06-morphing-live-updates.md` §2). One association token serves the cache graph and the multiplayer graph, because both are the same question — "who needs to know this changed?" — answered once, on the edge that owns the relationship.

---

## 6. Collection caching: `cached: true` is one `read_multi`

**When:** Rendering a collection of records whose rows are individually cached fragments — a room of messages, a tray of notifications.

**Do:** Render the collection in the convention form and add `cached: true` (Campfire renders this identical line from both the room page and the standalone message index; Fizzy's notification tray is the same one-liner — house doctrine):

```erb
<%= render partial: "messages/message", collection: @messages, cached: true %>
```

`collection:` renders the partial once per record with no hand-written loop. `cached: true` is the multiplier: Rails computes all N keys up front and issues **one batched `read_multi`** against the cache store, then renders only the misses. A warm 200-message room costs one cache round-trip and zero re-renders.

**Not:** You will be tempted to write the loop — `<% @messages.each do |m| %><%= render "messages/message", message: m %><% end %>` — with or without per-iteration `Rails.cache.fetch`. Don't. The loop forecloses batching: at best you get N separate store round-trips and a hand-typed key per fence; the convention form is the *only* seam where `read_multi` can hook in.

**Why:** Batching is only possible because the render is one declarative call over a known collection, not N imperative calls Rails can't see together. The convention form deletes the loop, derives every key, and batches the lookups — three jobs, one declaration. (The one-partial-every-path discipline this line depends on is `04-views-helpers.md`'s.)

---

## 7. HTTP caching: `stale?(etag:)` gates the entire body

**When:** An action's body is expensive — image variant processing, a heavy render, a big query — and clients re-request the same unchanged resource repeatedly.

**Do:** Gate the **entire body** behind `stale?`, with the ETag derived from the record (Campfire's avatar endpoint; Fizzy's avatar controller gates identically — house doctrine):

```ruby
# Generating an avatar resizes the upload and re-encodes it to WebP — expensive.
class Users::AvatarsController < ApplicationController
  def show
    @user = User.from_avatar_token(params[:user_id])

    if stale?(etag: @user)
      expires_in 30.minutes, public: true, stale_while_revalidate: 1.week

      if @user.avatar.attached?
        avatar_variant = @user.avatar.variant(SQUARE_WEBP_VARIANT).processed
        send_webp_blob_file avatar_variant.key
      else
        render_initials
      end
    end
  end
end
```

`stale?(etag: @user)` derives an ETag from the record (its `cache_version`/`updated_at` again), compares it to the `If-None-Match` header the browser sent, and:

- **Match** → the user hasn't changed since the browser last fetched. `stale?` returns `false`, the `if` block is skipped entirely, Rails sends a bare `304 Not Modified`. **The WebP processing never runs.**
- **No match** → returns `true`, the body runs, and the response carries the fresh ETag so the *next* request can 304.

**Not:** You will be tempted to wrap the expensive work in `Rails.cache.fetch` instead — don't. `Rails.cache.fetch` still runs the action and still re-ships the full payload down the wire on every request; it caches the output on *your* server. `stale?` reaches one level higher: it lets the **browser's copy** answer "has this changed?", so a hit costs no render **and** no payload — an empty 304. You didn't cache the output; you cached the decision to skip.

**Why:** The fastest request is the one whose body never executes. And the freshness fact is derived, never stored — nobody maintains an "is this response still fresh?" field anywhere; it's computed from the data the response was built from, the same root rule as §1 three layers up.

---

## 8. `fresh_when` and composite ETags

**When:** The action has nothing to do *but* render — no expensive work to skip, just a response that's often unchanged. Or: the response depends on several inputs, any of which should break the 304.

**Do:** Use the statement form when there's no body to gate (Campfire's message index):

```ruby
def index
  @messages = find_paged_messages
  if @messages.any?
    fresh_when @messages    # whole-collection ETag; Rails 304s automatically if unchanged
  else
    head :no_content
  end
end
```

`fresh_when` is `stale?` written as a statement — it sets the ETag from the record or collection and lets Rails short-circuit the render with a 304 when the client's copy matches.

When the page is a function of several inputs, derive a **composite** ETag from all of them (Fizzy's board view):

```ruby
fresh_when etag: [ @board, @page.records, @user_filtering, Current.account ]
```

Any element changing breaks the match — the board itself, the visible cards, the user's filter state, the account. Same convention, tuned to a multi-factor key.

**Not:** You will be tempted to ETag only the "main" record of a multi-input page — don't. An ETag derived from `@board` alone serves a 304 after a card moves, and the page lies. Every input that shapes the response belongs in the key, exactly like every dependency belongs in the fragment key.

**Why:** An incomplete key is §1's drift bug in HTTP clothing: a freshness answer that ignores part of the truth. The array form keeps the derivation honest while staying one line.

---

## 9. Push freshness to the edge: `expires_in`, `public:`, `stale_while_revalidate`

**When:** A response is safe to reuse for a while without asking the server at all — avatars, generated images, anything read-heavy and slow-changing.

**Do:** Declare the freshness policy in one line next to the code it governs:

```ruby
expires_in 30.minutes, public: true, stale_while_revalidate: 1.week   # (Campfire & Fizzy avatars)
```

- `expires_in 30.minutes` — the browser may serve its copy for 30 minutes without even sending the conditional request.
- `public: true` — shared caches (CDNs, proxies) may store and serve it too, multiplying the skip across users.
- `stale_while_revalidate: 1.week` — the graceful part: for up to a week after expiry, a cache may serve the slightly-old copy *immediately* while refetching in the background. The user never waits on a regeneration.

Tune the same instrument to the content's actual mutability. A QR code for a fixed URL can never change (Campfire):

```ruby
expires_in 1.year, public: true
```

**Why:** This is a ladder of who gets to skip work: `stale?` (§7) skips the render but still costs a round-trip; `expires_in` deletes the round-trip; `public:` deletes it for everyone behind the same CDN; `stale_while_revalidate` deletes the regeneration wait. Each rung is one keyword on the same line. Setting `expires_in 1.year` on a mutable resource is only safe with §10's move — which is why they ship together.

---

## 10. Change the content, change the URL

**When:** You want aggressive, long-lived caching (`immutable`, `max-age` of a year) on a resource that *can* change — an avatar, a compiled asset — without ever serving the old version after a change.

**Do:** Stamp the version into the URL itself, so a changed resource IS a new URL. Campfire's avatar route (the `direct` block defines a custom URL helper in `routes.rb`):

```ruby
# routes.rb — fresh_user_avatar_url(user) stamps the version into the URL
direct :fresh_user_avatar do |user, options|
  route_for :user_avatar, user.avatar_token, v: user.updated_at.to_fs(:number)
end
```

Upload a new avatar → `updated_at` bumps → the URL changes → every browser and CDN holding the old copy treats it as a brand-new resource and fetches fresh. The old URL's copy can be cached forever with zero risk, because nothing will ever ask for it again.

The asset pipeline is the same move with a content hash: digested filenames (`application-f9a3c1d.css`) bake the content into the URL, which is what makes the far-future header safe. Campfire splits its static-file headers by exactly this property:

```ruby
# config/environments/production.rb (Campfire) — per-path Cache-Control
config.public_file_server.headers = {
  "cache-control" => lambda do |path, _|
    if path.start_with?("/assets/")
      # Files in /assets/ are expected to be fully immutable.
      # If the content change the URL too.
      "public, immutable, max-age=#{1.year.to_i}"
    else
      # For anything else we cache for 1 minute.
      "public, max-age=#{1.minute.to_i}, stale-while-revalidate=#{5.minutes.to_i}"
    end
  end
}
```

Two freshness classes, decided by one question: is the content baked into the URL? Yes → immutable for a year. No → one minute plus graceful revalidation.

**Not:** You will be tempted to cache a mutable resource's stable URL for a long window and accept "users see the old avatar for up to an hour" — don't, and don't reach for cache-purge APIs to fix it. Re-derive the URL instead; purging is hand-maintaining the key again, at the CDN.

**Why:** This kills the entire "I shipped a new image and people still see the old one" bug class. It's §1's root rule at the URL layer: `updated_at` in a fragment key, an ETag in a 304, a `v:` in a URL — one idea, three altitudes, no version integer maintained anywhere.

---

## 11. Derived cache vs stored counter: when storing a computed value is allowed

**When:** Something derived is genuinely too slow to recompute on every read, and you're deciding between a cache and a stored column (a counter, a denormalized field).

**Do:** Apply the test: **is the stored value the authority, or a memo of an authority that lives elsewhere?**

| | Stored counter / flag | Keyed cache |
|---|---|---|
| What it is | a second source of truth | a function with a memo |
| Kept fresh by | callbacks you write on every mutating path | a key derived from the data (`updated_at`) |
| When a write path is missed | drifts silently — "badge says 3, room is empty" | impossible to miss — the key derivation isn't per-path |
| When it's wrong | stays wrong until hand-corrected | self-heals on the next key change |
| Verdict | don't | fine |

A bumped `unread_count` column is a second source of truth: every code path that creates, destroys, or moves a message must remember to adjust it, and the first half-failed transaction makes it lie — flags lie, and counters are flags with arithmetic. A fragment keyed on `updated_at` is not a second truth: it's a memo of a render, and a wrong memo is abandoned the moment the key changes. The badge itself should be a count asked fresh (`user.memberships.unread.count`) — and if *that* is too slow, cache it under a derived key; never bump it.

**Not:** You will be tempted to read "derive, don't store" as "never store a computed value" and then, hitting a real hotspot, abandon the principle entirely for a hand-bumped counter — don't. The principle is "never make the stored value the *authority*." Caching under a derived key IS the sanctioned way to store a computed value.

**Why:** A keyed cache and a bumped counter fail in opposite directions. The cache's failure mode is a miss — you pay a recompute. The counter's failure mode is a lie — you serve wrong data with no error, indefinitely. Choose the failure mode that costs milliseconds over the one that costs correctness.

---

## 12. Red flags → fixes

| Red flag in code or review | The bug it breeds | Fix | § |
|---|---|---|---|
| A version integer in a cache key (`"...-v3"`) | stale HTML after markup/data changes; bump-every-call-site drift | `cache record` — `updated_at` + template digest are the version | 2 |
| `cache "string-#{id}"` instead of `cache record` | opts out of `cache_version` and digest busting | pass the record | 2 |
| A callback that re-touches a parent (`after_create { parent.update(updated_at: ...) }`) | covers create, silently misses destroy — deleted child lingers on screen | `belongs_to :parent, touch: true` | 5 |
| Fragment output depends on a helper or twin template, nothing guards it | helper markup changes, fragments never bust | dated comment at the blind spot, updated with the dependency | 3 |
| `.each` loop around a cached partial render | N store round-trips; no `read_multi`; hand-typed keys | `render partial:, collection:, cached: true` | 6 |
| `Rails.cache.fetch` around an expensive action body | caches the output but still renders/ships on every hit | `stale?(etag:)` gating the whole body → 304 | 7 |
| ETag derived from one record on a multi-input page | 304s served after a secondary input changed | composite `fresh_when etag: [a, b, c]` | 8 |
| Long `max-age` on a mutable, stable URL | users see the old content until expiry; purge scripts appear | stamp `v: updated_at` into the URL; `immutable` only when content is in the URL | 10 |
| A hand-bumped counter column (`unread_count += 1`) | drifts on the first missed path or half-failed transaction | derive the count; cache under a derived key if slow | 11 |
| A cache-purge call in app code | hand-maintaining the key at the CDN | change the URL instead | 10 |

The one-sentence summary to carry out of this file: **a cache key is a second source of truth about "has this changed?" — so derive it from the data at every altitude (`updated_at` in the fragment key, the ETag in the 304, the `v:` in the URL), and the key maintains itself.**
