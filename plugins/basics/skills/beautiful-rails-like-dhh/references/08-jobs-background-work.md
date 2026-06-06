# Jobs & Background Work — the Thinnest Thread Boundary

Read this when a save has consequences that are slow, flaky, or fan out — pushes, emails, webhooks, recurring cleanup — and you're deciding what runs on the request thread, what crosses into a job, how the job is shaped, and what rides across the queue with it.

## Contents

- [The altitude question: in-band vs out-of-band](#the-altitude-question-in-band-vs-out-of-band)
- [The trigger altitude: `_commit` means after-durable](#the-trigger-altitude-_commit-means-after-durable)
- [The in-band half: one bulk `update_all`, never a loop](#the-in-band-half-one-bulk-update_all-never-a-loop)
- [The job is a two-line thunk](#the-job-is-a-two-line-thunk)
- [The `_later`/plain-method pair: the guard lives on the wrapper](#the-_laterplain-method-pair-the-guard-lives-on-the-wrapper)
- [GlobalID: pass the record, not an id to re-find](#globalid-pass-the-record-not-an-id-to-re-find)
- [Below the job: work that escapes the Rails executor lives in `lib/`](#below-the-job-work-that-escapes-the-rails-executor-lives-in-lib)
- [Scheduled work: cron owns *when*, the model owns *what*](#scheduled-work-cron-owns-when-the-model-owns-what)
- [Resumable jobs: position as state](#resumable-jobs-position-as-state)
- [Retry classification: a retry policy, not a prayer](#retry-classification-a-retry-policy-not-a-prayer)
- [Ambient tenancy across the job boundary](#ambient-tenancy-across-the-job-boundary)
- [Red flags → fixes](#red-flags--fixes)
- [The composition: a whole async surface in a dozen lines](#the-composition-a-whole-async-surface-in-a-dozen-lines)

Scope: this file owns all job *mechanics*. The principle-level altitude reasoning (P9) is summarized in `01-doctrine.md`. The decision of whether a consequence is a callback at all ("whose fact is this?" — e.g. broadcasting as an explicit method because it differs by call path) belongs to `02-models.md` §3.

One mechanical given: Active Job is a uniform interface over a swappable queue backend. You write `perform` and call `.perform_later`; the backend (Campfire runs Resque, Fizzy runs Solid Queue) is configuration, not code. `perform_later` is the only seam you touch — everything below is about what you refuse to put on either side of it.

---

## The altitude question: in-band vs out-of-band

**When:** any save with more than one consequence — a message that must mark memberships unread *and* push to fifty phones; a card that must update its board *and* email watchers.

**Do:** before asking "what file does this code go in?", ask **at what altitude does each unit of work belong?** Exactly two answers:

| Altitude | Profile | Where it runs |
|---|---|---|
| **In-band** | cheap, and *must be durable before the HTTP response returns* — otherwise the response lies about the app's state | synchronously, inside the request |
| **Out-of-band** | slow, flaky, or a fan-out the sender should never wait on — network calls to gateways you don't control | a background job |

The split is **the sync/async line**, and Campfire draws it out loud in two lines:

```ruby
class Room < ApplicationRecord
  def receive(message)
    unread_memberships(message)   # cheap, must be durable  → IN-BAND
    push_later(message)           # slow, flaky, fans out   → JOB
  end
end
```

Two named intents, two altitudes, one line each. The model owns *what* the consequence is; the seam owns *where and when* it runs — **altitude is decided at the seam, not by the model**. That separation is why `receive` can read like pure intent and still be correct under rollback, edit, and fan-out: the timing logic lives one layer down, at the `_commit` trigger and the `_later` boundary, never smeared into the consequence itself.

**Not:** you will be tempted to hang everything on one callback that loops over members, updates each row, and fires each push synchronously — the honest first version. Don't. It blocks the sender's request on someone else's flaky push gateway, fires N queries where one would do, and (if it's `after_save`) re-notifies the whole room every time someone fixes a typo.

**Why:** altitude is a correctness boundary, not a performance tactic. Count the edge cases the split absorbs for free: the blocked sender, the N+1 in a callback, the re-notify on edit, and — via the trigger below — the ghost row.

---

## The trigger altitude: `_commit` means after-durable

**When:** a callback enqueues work that reaches outside the database — a push, an email, a webhook, anything that can't be taken back.

**Do:** trigger from `after_create_commit`, never plain `after_create` or `after_save`:

```ruby
class Message < ApplicationRecord
  belongs_to :room

  after_create_commit -> { room.receive(self) }   # (Campfire)
end
```

**`_commit` means after-durable.** The callback fires once, only after the row has survived its transaction. If the transaction rolls back, the callback never fires, so the job is never enqueued, so no phone is ever pinged about a row that doesn't exist. Fizzy reaches for the identical seam — `after_create_commit :deliver_later` on its webhook deliveries, `after_create_commit :notify_recipients_later` in its `Notifiable` concern — so this is doctrine, not one app's habit.

**Not:** you will be tempted to use plain `after_create` and reason "the worker runs *later* anyway — surely the rollback finishes first." Don't. Enqueueing from inside the transaction **races the rollback**: the job row can land in the queue and get picked up before the rollback propagates, and the worker happily notifies fifty phones about a message that no longer exists — **the ghost row**. The race isn't rare under load; `_commit` removes it entirely by not enqueueing until durable.

**Why:** the entire phantom-notification bug class disappears in one suffix. Count the edge cases this line absorbs for free.

Fizzy also closes this globally — every Active Job enqueue waits for the surrounding transaction, not just the ones you remembered to hang on `_commit` callbacks:

```ruby
# config/initializers/active_job.rb  (Fizzy)
ActiveSupport.on_load(:active_job) do
  self.enqueue_after_transaction_commit = true
end
```

Set this. It is the `_commit` guarantee applied to every `perform_later` in the app, including ones fired from deep inside model code you didn't write.

---

## The in-band half: one bulk `update_all`, never a loop

**When:** the cheap-and-must-be-durable side of the split touches many rows — "mark every other member's membership unread."

**Do:** one bulk statement over composable scopes; let the database do the filtering:

```ruby
class Room < ApplicationRecord
  private
    def unread_memberships(message)   # (Campfire)
      memberships.visible.disconnected.where.not(user: message.creator)
        .update_all(unread_at: message.created_at, updated_at: Time.current)
    end
end
```

The whole "who needs an unread badge?" decision is *one* `UPDATE`. No `each`, no per-row `update!`, no loading users into Ruby to re-check presence — the `visible.disconnected` scopes carry that decision into SQL.

**Not:** you will be tempted to write `memberships.each { |m| m.update!(unread_at: ...) }` because it reads naturally. Don't — that's N queries hiding inside a callback, cheap work done expensively, and it's exactly the shape that makes people wrongly conclude the *whole* consequence must go async.

**Why:** done as one statement, this work is cheap enough to stay in-band — which it must, because if it didn't happen before the response, the unread badges would lie. The bulk form is what makes the in-band placement affordable.

---

## The job is a two-line thunk

**When:** writing any job class.

**Do:** receive rehydrated records, immediately delegate to a model verb (or a PORO wrapping models), return. Here is Campfire's *entire* job layer — all three of its jobs:

```ruby
class Room::PushMessageJob < ApplicationJob
  def perform(room, message)
    Room::MessagePusher.new(room:, message:).push
  end
end

class Bot::WebhookJob < ApplicationJob
  def perform(bot, message)
    bot.deliver_webhook(message)
  end
end

class RemoveBannedContentJob < ApplicationJob
  def perform(user)
    user.remove_banned_content
  end
end
```

Every one is the same shape. **The job is the thinnest thread boundary** — it exists only to be the place where "now" becomes "later." There is no logic in it to test because there is no logic in it at all. Fizzy's jobs are the same thunk to the byte (`NotifyRecipientsJob#perform` is `notifiable.notify_recipients`; `Event::RelayJob#perform` is `event.relay_now`), and 37signals state it as law in their style guide: *"we write shallow job classes that delegate the logic itself to domain models"* — with `_later` as the house suffix for "this enqueues a job" and `_now` for the synchronous worker method.

**Not:** you will be tempted to put the real work inside `perform` — "it runs in the background either way." Don't. **Logic in `perform` is stranded behind the queue**: the only way to run it is to enqueue it, the only way to test it is to drain a queue, the only way to reuse it is to enqueue again. Campfire's webhook delivery proves the cost of the alternative: a bot's reply rides the same `deliver_webhook` whether triggered by a job or called synchronously from another code path — possible only because the work lives on the model.

**Why:** the real work — who gets a push, how the payload is built — stays on the model where it's synchronously callable from a console or a test with no worker running. Async-ness is a property of *how the work is invoked*, layered on at the call site, never baked into the work itself. The model says what; the job says where.

---

## The `_later`/plain-method pair: the guard lives on the wrapper

**When:** a job shouldn't always run — there's a precondition ("does this bot even have a webhook?").

**Do:** pair a plain method that does the work with a `_later` sibling that owns *both* the enqueue *and* the guard:

```ruby
class User::Bot < User   # (Campfire)
  def deliver_webhook_later(message)
    Bot::WebhookJob.perform_later(self, message) if webhook   # guard HERE, before enqueue
  end

  def deliver_webhook(message)
    webhook.deliver(message)                                  # the work, no guard
  end
end
```

Same shape everywhere — Campfire's `Bannable` concern pairs `remove_banned_content_later` (pure enqueue) with `remove_banned_content` (the destroy-and-broadcast work); Fizzy's `Webhook::Delivery` pairs `deliver_later` (one-line `perform_later(self)`) with `deliver` (the real network call).

The `if webhook` check runs *before* the job is ever created, synchronously, at the call site. By the time `perform` runs, the decision was already made — **the job never re-checks the guard defensively**. A bot with no webhook produces **zero queue rows**, not a queue row that wakes a worker only to no-op.

**Not:** you will be tempted to bury `return unless bot.webhook` at the top of `perform`. Don't. You'd enqueue a job, occupy a worker, and deserialize records just to discover there was nothing to do — and because the guard has no shared home, it gets copy-pasted into every job that touches the same precondition.

**Why:** the guard has exactly one home, on the named seam, and the job stays a thunk you never have to read. The precondition runs at the altitude that has the context (the request); the work runs at the altitude that has the time (the worker).

---

## GlobalID: pass the record, not an id to re-find

**When:** any `perform_later` whose argument is an Active Record object.

**Do:** pass the record itself. Active Job serializes it as a GlobalID (`gid://app/Message/123`) and rehydrates a real, loaded model before `perform` runs:

```ruby
Room::PushMessageJob.perform_later(self, message)   # records, in domain nouns

class Room::PushMessageJob < ApplicationJob
  def perform(room, message)   # already a Room and a Message, already loaded
    Room::MessagePusher.new(room:, message:).push
  end
end
```

And handle the record-vanished-meanwhile case once, declaratively, on the base class:

```ruby
class ApplicationJob < ActiveJob::Base
  discard_on ActiveJob::DeserializationError   # record gone before the worker got to it → drop the job
end
```

Fizzy turns this line on per job where the jobs genuinely race a record disappearing; either way the knob is declarative and lives at the boundary, not in your code.

**Not:** you will be tempted to pass `message.id` and write `message = Message.find(message_id)` at the top of `perform` — plus a hand-rolled rescue for "what if it was deleted." Don't. The re-find and the find-failure handling are framework concerns; `Model.find(arg)` boilerplate at the top of every job is exactly the drift the framework already absorbs.

**Why:** call sites read in the domain's nouns; the vanished-record branch is written once as `discard_on`; the id is still the thing on the wire — you just never type it.

---

## Below the job: work that escapes the Rails executor lives in `lib/`

**When:** work needs a long-lived raw thread pool — thousands of HTTPS push deliveries over persistent connections — that must *not* be wrapped per-delivery by the Rails executor (the framework layer that manages database connections and reloading around each unit of work).

**Do:** drop it to `lib/`, not `app/`, and do **all Active Record reads before posting to threads** — post primitives, never live records:

```ruby
# This is in lib so we can use it in a thread pool without the Rails executor  (Campfire)
class WebPush::Pool
  def deliver_later(payload, subscription)
    # Ensure any AR operations happen before we post to the thread pool
    notification = subscription.notification(**payload)
    subscription_id = subscription.id

    delivery_pool.post do
      deliver(notification, subscription_id)     # plain data + an integer — no ORM in the thread
    rescue Exception => e
      Rails.logger.error "Error in WebPush::Pool.deliver: #{e.class} #{e.message}"
    end
  rescue Concurrent::RejectedExecutionError
  end
end
```

Read the order of the lines: every AR read — building the notification, grabbing `subscription.id` — happens *before* `delivery_pool.post`. By the time work crosses into the pool it carries plain data. The threads touch the network; they never touch the ORM. The reads happen at the altitude that has the database; the delivery at the altitude that has the threads; the boundary between them is one `.post`.

**Not:** you will be tempted to post the `subscription` record itself into the thread and let each thread lazily query through it. Don't. Fifty raw threads then race for database connections outside Rails' connection management and throw `connection pool exhausted` under load in a way that's maddening to reproduce.

**Why:** "AR reads first, then post primitives" makes the connection-leak class impossible by construction — and confining the whole unusual pattern to one file in `lib/` means the rest of the app never has to think about executors at all.

---

## Scheduled work: cron owns *when*, the model owns *what*

**When:** work fires on a clock, not a save — clean up stale magic links, auto-postpone idle cards, deliver bundled notifications.

**Do:** the schedule file holds **no logic** — each entry is a one-liner naming a schedule and calling a domain verb (Fizzy, via Solid Queue's `config/recurring.yml`):

```yaml
# config/recurring.yml  (Fizzy)
production:
  auto_postpone_all_due:
    command: "Card.auto_postpone_all_due"
    schedule: every hour at minute 50
  cleanup_magic_links:
    command: "MagicLink.cleanup"
    schedule: every hour at minute 12
  deliver_bundled_notifications:
    command: "Notification::Bundle.deliver_all_later"
    schedule: every hour at minute 20
```

This is the same thinnest-thread-boundary doctrine wearing a clock: the cron entry owns only *when*; the model owns *what*. `Card.auto_postpone_all_due` is a real method you can call from a console with no scheduler running. Stagger the minutes (`50`, `12`, `20`) to spread load off the top of the hour.

**Not:** you will be tempted to write a dedicated `CleanupJob` whose `perform` contains the cleanup logic, scheduled by name. Don't — that's the stranded-logic problem again, now with a timer. The schedule entry is a thunk for the same reason the job class is.

**Why:** the entire recurring surface reads as a list of named intents, each one console-callable, each one testable synchronously. Same doctrine as every job above; only the trigger differs.

---

## Resumable jobs: position as state

**When:** a single job does genuinely long work — walking every active webhook for an event, one blocking HTTPS call each — and a deploy or crash mid-run must not re-fire the deliveries already made.

**Do:** make the job resumable with `ActiveJob::Continuable` — the cursor is the bookkeeping (Fizzy):

```ruby
class Event::WebhookDispatchJob < ApplicationJob
  include ActiveJob::Continuable

  def perform(event)
    step :dispatch do |step|
      Webhook.active.triggered_by(event).find_each(start: step.cursor) do |webhook|
        webhook.trigger(event)
        step.advance! from: webhook.id
      end
    end
  end
end
```

`find_each(start: step.cursor)` begins the scan where the cursor last pointed; `step.advance! from: webhook.id` moves it forward after each successful delivery; the framework persists the cursor as job state. Worker dies after webhook 40 of 100 → the retry resumes at 41, not 1. And notice it's still a thin thunk under the machinery: the real work is `webhook.trigger(event)`, one verb on the model — the `step`/`cursor` scaffolding wraps a delegating call, it doesn't replace it.

**Not:** you will be tempted to add a `delivered?` boolean per webhook and scope on `.where(delivered: false)`. Don't. That's a column to migrate, a write per delivery, a flag that can lie after a partial failure — a second source of truth for something that is really just *position*. **Position-as-state** beats a stored flag: the "which ones did I already do?" answer lives in the job's cursor, not on every record.

**Why:** `retry_on`/`step`/`cursor` configuration is not the in-`perform` logic this file told you to avoid — it's *declarative job-framework concern* (when to re-run, where to resume), which is precisely what the job class is for. The thin-thunk rule forbids stranding *domain* logic behind the queue; configuring how the queue behaves is the job's own business.

---

## Retry classification: a retry policy, not a prayer

**When:** a job's work can fail in ways with different futures — a timeout that will recover vs a permanently-dead address.

**Do:** classify. Transient failures get `retry_on` with backoff; known-permanent failures get `rescue_from` matched by error-code prefix and are logged-and-swallowed; **anything unmatched re-raises** so a novel failure surfaces instead of being eaten. Fizzy's SMTP delivery concern, in full:

```ruby
module SmtpDeliveryErrorHandling   # (Fizzy)
  extend ActiveSupport::Concern

  included do
    # Retry delivery to possibly-unavailable remote mailservers.
    retry_on Net::OpenTimeout, Net::ReadTimeout, Socket::ResolutionError, wait: :polynomially_longer

    # Net::SMTPServerBusy is SMTP error code 4xx, a temporary error.
    # Common one we've seen is 452 4.3.1 Insufficient system storage.
    # Patiently retry.
    retry_on Net::SMTPServerBusy, wait: :polynomially_longer

    # SMTP error 50x.
    rescue_from Net::SMTPSyntaxError do |error|
      case error.message
      when /\A501 5\.1\.3/
        # Ignore undeliverable email addresses.
        Sentry.capture_exception error, level: :info if Fizzy.saas?
      else
        raise
      end
    end

    # SMTP error 5xx except 50x and 53x.
    # * 550 5.1.1: Unknown users
    # * 552 5.6.0: Message/headers too large
    rescue_from Net::SMTPFatalError do |error|
      case error.message
      when /\A550 5\.1\.1/, /\A552 5\.6\.0/, /\A555 5\.5\.4/
        Sentry.capture_exception error, level: :info if Fizzy.saas?
      else
        raise
      end
    end
  end
end
```

Three tiers: timeouts and SMTP `4xx` are transient → `retry_on ... wait: :polynomially_longer`, patient because the remote will probably recover. Known-permanent `5xx` codes are matched by reply-code prefix (`/\A550 5\.1\.1/`) → logged and dropped so they never poison the retry queue. Everything else hits `else raise`. Each "common one we've seen" comment is a production incident fossilized into the classifier — accumulate yours the same way.

**Not:** you will be tempted to wrap the delivery in one `rescue => e; retry` and treat every failure the same. Don't. A permanent `550 Unknown user` then retries on the same backoff schedule as a transient timeout — burning worker time forever on mail that will never deliver — while a genuinely novel error gets swallowed by the same blanket rescue and never surfaces.

**Why:** the transient/permanent/unknown split is the difference between a retry policy and a prayer. The `else raise` arm is load-bearing: it's what keeps the classifier honest as new failure modes appear.

---

## Ambient tenancy across the job boundary

**When:** the app is multi-tenant — every request runs inside a `Current.account`, every record is meaningful only relative to it — and jobs run in a worker process where `Current.account` is blank.

**Do:** make tenancy an ambient property of *every* job, never a job argument. Fizzy's `AccountTenanted` concern snapshots the account at enqueue, rides it across the wire as a GlobalID, and re-establishes it around `perform`:

```ruby
module AccountTenanted   # (Fizzy)
  extend ActiveSupport::Concern

  prepended do
    around_perform :with_account_context
  end

  def initialize(...)
    super
    @account = Current.account            # snapshot at ENQUEUE time, off the live request
  end

  def serialize
    super.merge({ "account" => @account&.to_gid })   # the account rides the queue as a GID
  end

  def deserialize(job_data)
    super
    @account_gid = job_data["account"]
  end

  private
    attr_reader :account

    def with_account_context(&block)
      resolve_account!

      if account.present?
        Current.with_account(account, &block)        # perform runs INSIDE the right tenant
      else
        yield
      end
    end

    def resolve_account!
      if @account_gid
        @account = GlobalID::Locator.locate(@account_gid)
      end
    rescue ActiveRecord::RecordNotFound
      raise ActiveJob::DeserializationError          # deleted account → same discard_on door as any vanished record
    end
end
```

Then make it total. `ApplicationJob` does `prepend AccountTenanted` — but framework jobs (Action Mailer's delivery job, Turbo's broadcast jobs) don't inherit from `ApplicationJob` and enqueue work too. Prepend the same concern onto them in an initializer:

```ruby
# config/initializers/active_job.rb  (Fizzy)
ActiveSupport.on_load(:active_job) do
  self.enqueue_after_transaction_commit = true       # the global after-durable guarantee
end

ActiveSupport.on_load(:action_mailer) do
  ActionMailer::MailDeliveryJob.prepend AccountTenanted
end

Rails.application.config.after_initialize do
  Turbo::Streams::ActionBroadcastJob.prepend AccountTenanted
  Turbo::Streams::BroadcastJob.prepend AccountTenanted
  Turbo::Streams::BroadcastStreamJob.prepend AccountTenanted
end
```

Now a mailer enqueued by Rails itself, or a Turbo broadcast fired from a model callback, runs inside the right tenant — the concern blankets work the app never explicitly wrote as a job.

**Not:** you will be tempted to thread `account_id` through every job signature and re-set `Current.account` as the first line of every `perform`. Don't. That's a parameter you can forget on exactly one job, and the bug it produces — a job quietly reading another tenant's data — announces itself with no error.

**Why:** forgetting becomes impossible: tenancy is serialized and re-established by the boundary itself, for app jobs and framework jobs alike. The altitude seam doesn't just move work off the request thread — it carries the request's identity with it. (Single-tenant apps like Campfire skip all of this; there's one world.)

---

## Red flags → fixes

| Red flag in the diff | Fix |
|---|---|
| `after_create`/`after_save` enqueues a job or touches the network | `after_create_commit` — `_commit` means after-durable; plain callbacks race the rollback (the ghost row) |
| Real logic inside `perform` — loops, payload building, branching | Two-line thunk delegating to a model verb; logic in `perform` is stranded behind the queue |
| `return unless ...` guard at the top of `perform` | Move the guard to the `_later` wrapper, before the enqueue — zero queue rows for no-ops |
| `perform_later(record.id)` + `Model.find` inside the job | Pass the record; GlobalID rehydrates it; `discard_on ActiveJob::DeserializationError` for vanished rows |
| `memberships.each { update! }` inside a callback | One bulk `update_all` over composable scopes — the in-band half must be cheap to stay in-band |
| A live AR record handed into a raw thread / `pool.post` block | All AR reads before the post; pass primitives; the pool class lives in `lib/` |
| Scheduled job class with cleanup logic in `perform` | `recurring.yml` one-liner calling a model verb — cron owns when, the model owns what |
| `delivered?` boolean column tracking a long job's progress | `ActiveJob::Continuable` — `find_each(start: step.cursor)` + `step.advance!`; position-as-state |
| One blanket `rescue => e; retry` around flaky work | `retry_on` transient (polynomial backoff), `rescue_from` known-permanent by error-code prefix, `else raise` |
| `account_id` threaded through job signatures by hand | An `AccountTenanted`-style concern: snapshot `Current` at `initialize`, serialize as GID, `around_perform` re-establishes; prepend onto framework jobs too |
| `enqueue_after_transaction_commit` unset in a multi-job app | Set it `true` globally — every enqueue waits for commit, not just the callbacks you remembered |

---

## The composition: a whole async surface in a dozen lines

The pieces interlock into something you can hold in your head at once. Campfire's *complete* asynchronous behavior:

```ruby
# 1. The trigger, at the durable altitude
after_create_commit -> { room.receive(self) }

# 2. The sync/async line, drawn in two lines
def receive(message)
  unread_memberships(message)   # in-band: one bulk update_all
  push_later(message)           # out-of-band: the thinnest thread boundary
end

# 3. The job: a thunk
class Room::PushMessageJob < ApplicationJob
  def perform(room, message)
    Room::MessagePusher.new(room:, message:).push
  end
end
```

One `_commit` trigger, one `receive` that draws the line, three thunk jobs, three `_later` wrappers carrying the guards, one `lib/` pool that does its AR reads first. That is the entire async surface of a production chat app, readable at a glance — because no job contains any logic worth reading, every guard sits on its wrapper, and every trigger fires only after-durable. The logic lives on the models, synchronously testable; the jobs are just the thread boundary; the trigger's altitude is where correctness lives. Each boundary placed at its right altitude absorbs a production bug class for free — the ghost row, the blocked sender, the re-notify on edit, the connection leak — which is why the surface is small. It isn't doing less. **Count the edge cases this arrangement absorbs for free.**
