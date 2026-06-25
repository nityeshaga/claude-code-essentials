# Caching & Performance: The Key You Never Maintain

Read when something is slow, you're adding fragment/HTTP caching, you're tempted to hand-bump a cache version or a counter, or a cached page serves stale content.

Scope: this file owns freshness — fragment caching, HTTP caching, and the derivation discipline behind both. `dom_id` + one-partial-per-row mechanics live in `04-views-helpers.md`; the `touch:` + `broadcasts_refreshes` composition for multiplayer lives in `06-morphing-live-updates.md` (§5 shows the same `touch:` serves both).

## The root rule: never maintain the key by hand

Derive the cache key from the data it caches, so "the content changed" and "the key changed" are the same event — true by construction, not by vigilance. One shape, three altitudes:

| Altitude | Derived key | Mechanism |
|---|---|---|
| View fragment | `updated_at` (the record's `cache_version`) | `cache record do` |
| HTTP response | ETag from the record/collection | `stale?(etag:)` / `fresh_when` |
| URL | version stamp or content hash in the URL | `v: updated_at` param; digested filenames |

A hand-bumped version (`fetch("message-#{id}-v3")`) and a freshness callback (`after_create { parent.update(updated_at:) }`) are both a second source of truth about "has this changed?" — and a second source eventually disagrees with the first. Stale-cache bugs don't crash; they quietly serve yesterday's HTML. Derive the key and the whole bug class becomes unwriteable.

## Fragment caching: hand `cache` the record

```erb
<%# messages/_message.html.erb (Campfire); Fizzy's notification partial is identical %>
<% cache message do %>
  <%= message_tag message do %> ...avatar, author, timestamp, body, boosts... <% end %>
<% end %>
```

Passing the **record** (not a string) makes Rails build the key from: model name + `id`, the record's `cache_version` (defaults to `updated_at`), and the **template digest** (hash of the partial's source + declared render dependencies). So a data edit busts it (`updated_at` bumps) and a markup edit busts it (digest changes on deploy) — no version number typed. A hand-assembled key opts out of both, which are the entire point.

## The digest's blind spots: the dated-comment escape hatch

The digest sees `render "x"` dependencies — not Ruby helper method bodies, not twin templates Rails never renders. Where the machine can't enforce the coupling, make a human enforce it with a comment **at the exact blind spot** (editing the comment changes the source → changes the digest → busts the fragments):

```erb
<%# Be sure to check/update messages/_template.html.erb when changing this file %>  <%# Campfire twin-template %>
<% cache message do %> ...

<% cache notification do %>
  <%# Helper Dependency Updated: avatar_image_tag 2025-12-15 %>  <%# Fizzy helper dep %>
```

Don't ignore the gap or reintroduce a hand-bumped `cache [message, "v2"]` — the first ships stale HTML, the second resurrects the version problem for every key to cover one spot.

## Russian-doll nesting: warm shells make parent re-renders cheap

Cache children as fragments **inside** the parent, each keyed on its own record:

```erb
<%# outer doll %>
<% cache message do %>
  ...
  <% message.boosts.each do |boost| %><%= render "messages/boosts/boost", boost: boost %><% end %>
<% end %>

<%# inner doll: messages/boosts/_boost.html.erb %>
<% cache boost do %>
  <div id="<%= dom_id(boost) %>" class="boost">...</div>
<% end %>
```

Invalidation flows outward (child busts parent), but render cost stays local: adding a boost to a 200-message room re-renders one boost, not one message and not 200. The wiring that makes a child bust the parent is `touch: true` below.

## `touch: true` is the freshness graph, declared once

```ruby
class Boost < ApplicationRecord
  belongs_to :message, touch: true   # boost write → message.updated_at bumps → fragment busts
end
class Message < ApplicationRecord
  belongs_to :room, touch: true      # message write → room bumps → sidebar reorders, room fragments bust
end
```

`touch: true` fires on create, update, **and destroy**, bumping the parent's `updated_at` (its cache key), and climbs levels. One token per relationship edge wires the whole graph — across paths not yet written. The same `touch:` chain also fans out `broadcasts_refreshes` to subscribed browsers (`06-morphing-live-updates.md` §2): cache graph and multiplayer graph are the same question, answered once. A callback covers only the path you remembered (and silently skips destroy).

## Collection caching: `cached: true` is one `read_multi`

```erb
<%= render partial: "messages/message", collection: @messages, cached: true %>
```

`collection:` renders the partial once per record with no loop; `cached: true` computes all N keys up front and issues **one batched `read_multi`**, rendering only misses. A warm 200-message room costs one round-trip, zero re-renders. A hand-written `.each` loop forecloses batching — the convention form is the only seam `read_multi` hooks into.

## HTTP caching: `stale?(etag:)` gates the entire body

```ruby
# Generating an avatar resizes + re-encodes to WebP — expensive.
class Users::AvatarsController < ApplicationController
  def show
    @user = User.from_avatar_token(params[:user_id])
    if stale?(etag: @user)
      expires_in 30.minutes, public: true, stale_while_revalidate: 1.week
      if @user.avatar.attached?
        send_webp_blob_file @user.avatar.variant(SQUARE_WEBP_VARIANT).processed.key
      else
        render_initials
      end
    end
  end
end
```

`stale?(etag: @user)` derives an ETag (the record's `cache_version`), compares to `If-None-Match`, and on **match** returns `false` — the `if` block is skipped, Rails sends a bare `304`, the WebP processing never runs. `Rails.cache.fetch` would cache output on *your* server but still render and re-ship the payload; `stale?` lets the browser's copy answer "changed?", so a hit costs no render and no payload. You cached the decision to skip.

## `fresh_when` and composite ETags

When there's no body to gate, use the statement form:

```ruby
def index
  @messages = find_paged_messages
  @messages.any? ? fresh_when(@messages) : head(:no_content)
end
```

When the response is a function of several inputs, derive a **composite** ETag from all of them — any one changing breaks the 304:

```ruby
fresh_when etag: [ @board, @page.records, @user_filtering, Current.account ]  # Fizzy board view
```

ETagging only the "main" record is §1's drift bug in HTTP clothing: a 304 served after a secondary input changed is a page that lies. Every input that shapes the response belongs in the key.

## Push freshness to the edge

```ruby
expires_in 30.minutes, public: true, stale_while_revalidate: 1.week   # Campfire & Fizzy avatars
expires_in 1.year, public: true                                       # Campfire QR for a fixed URL
```

A ladder of who skips work: `stale?` skips the render but costs a round-trip; `expires_in` deletes the round-trip; `public:` deletes it for everyone behind a CDN; `stale_while_revalidate` serves the slightly-old copy immediately while refetching in the background. `expires_in 1.year` on a mutable resource is only safe with the URL-versioning move below.

## Change the content, change the URL

Stamp the version into the URL so a changed resource IS a new URL:

```ruby
# routes.rb — fresh_user_avatar_url(user) stamps the version in
direct :fresh_user_avatar do |user, options|
  route_for :user_avatar, user.avatar_token, v: user.updated_at.to_fs(:number)
end
```

New avatar → `updated_at` bumps → new URL → every cache fetches fresh; the old URL's copy can be cached forever because nothing asks for it again. The asset pipeline is the same move with a content hash (`application-f9a3c1d.css`), which is what makes far-future headers safe:

```ruby
# config/environments/production.rb (Campfire) — per-path Cache-Control
config.public_file_server.headers = {
  "cache-control" => lambda do |path, _|
    if path.start_with?("/assets/")
      "public, immutable, max-age=#{1.year.to_i}"                                    # content is in the URL
    else
      "public, max-age=#{1.minute.to_i}, stale-while-revalidate=#{5.minutes.to_i}"
    end
  end
}
```

Don't cache a mutable resource's stable URL for a long window, and don't reach for cache-purge APIs — purging is hand-maintaining the key at the CDN. Re-derive the URL.

## Derived cache vs stored counter

Test: **is the stored value the authority, or a memo of an authority living elsewhere?**

| | Stored counter / flag | Keyed cache |
|---|---|---|
| What it is | a second source of truth | a function with a memo |
| Kept fresh by | callbacks on every mutating path | a key derived from the data (`updated_at`) |
| Missed write path | drifts silently ("badge says 3, room empty") | impossible to miss — derivation isn't per-path |
| When wrong | stays wrong until hand-corrected | self-heals on next key change |
| Verdict | don't | fine |

The badge should be a fresh count (`user.memberships.unread.count`); if that's too slow, cache it under a derived key — never bump it. "Derive, don't store" means "never make the stored value the *authority*," not "never store a computed value." A cache miss costs milliseconds; a counter's lie costs correctness, indefinitely.

## Red flags → fixes

| Red flag | Bug it breeds | Fix | § |
|---|---|---|---|
| Version integer in a key (`"...-v3"`) | stale HTML after changes; bump-every-call-site drift | `cache record` (`updated_at` + digest) | fragment |
| `cache "string-#{id}"` not `cache record` | opts out of `cache_version` + digest | pass the record | fragment |
| Callback re-touching a parent | covers create, misses destroy | `belongs_to :parent, touch: true` | touch |
| Fragment depends on helper/twin, nothing guards it | helper changes, fragments never bust | dated comment at the blind spot | digest |
| `.each` around a cached partial | N round-trips, no `read_multi` | `render partial:, collection:, cached: true` | collection |
| `Rails.cache.fetch` around an expensive body | caches output but still renders/ships | `stale?(etag:)` gating the body → 304 | http |
| ETag from one record on a multi-input page | 304s after a secondary input changed | composite `fresh_when etag: [a, b, c]` | composite |
| Long `max-age` on a mutable stable URL | old content until expiry; purge scripts | stamp `v: updated_at`; `immutable` only when content is in the URL | url |
| Hand-bumped counter (`unread_count += 1`) | drifts on missed path / half-failed txn | derive the count; cache under a derived key if slow | derived |
| Cache-purge call in app code | hand-maintaining the key at the CDN | change the URL instead | url |

**Carry this out:** a cache key is a second source of truth about "has this changed?" — derive it from the data at every altitude (`updated_at` in the fragment key, the ETag in the 304, the `v:` in the URL), and the key maintains itself.