# Jobs & Background Work — the Thinnest Thread Boundary

Read when a save has slow/flaky/fan-out consequences (pushes, emails, webhooks, recurring cleanup) and you're deciding what runs on the request thread vs a job, and what rides across the queue.

Active Job is a uniform interface over a swappable backend (Resque, Solid Queue — config, not code). `perform_later` is the only seam you touch. Everything below is what you refuse to put on either side of it.

The one rule under all of it: **logic lives on models (synchronously callable); the job is the thinnest thread boundary, nothing more.** Conventions: `_later` = "enqueues a job," `_now` = the synchronous worker method.

---

## Decide altitude at the seam, not in the model

Before "what file?", ask **at what altitude does each unit of work run?** Two answers only:

| Altitude | Profile | Runs |
|---|---|---|
| **In-band** | cheap, *must be durable before the HTTP response returns* (else the response lies) | sync, inside the request |
| **Out-of-band** | slow/flaky/fan-out the sender shouldn't wait on | a job |

```ruby
class Room < ApplicationRecord
  def receive(message)
    unread_memberships(message)   # cheap, must be durable → IN-BAND
    push_later(message)           # slow, flaky, fans out  → JOB
  end
end
```

The model owns *what* the consequence is; the seam owns *where/when* it runs. Hanging everything on one callback that loops members and fires each push synchronously blocks the sender on a flaky gateway, fires N queries, and re-notifies on every edit.

## `after_create_commit`, never `after_create`/`after_save`

```ruby
after_create_commit -> { room.receive(self) }
```

`_commit` means after-durable: fires once, only after the row survives its transaction. Plain `after_create` enqueues *inside* the transaction and races the rollback — the worker can notify fifty phones about a row that rolled back (the **ghost row**). Close it globally too:

```ruby
# config/initializers/active_job.rb
ActiveSupport.on_load(:active_job) { self.enqueue_after_transaction_commit = true }
```

That applies the after-durable guarantee to every `perform_later`, including ones fired from model code you didn't write.

## The in-band half is one bulk `update_all`, never a loop

```ruby
def unread_memberships(message)
  memberships.visible.disconnected.where.not(user: message.creator)
    .update_all(unread_at: message.created_at, updated_at: Time.current)
end
```

The scopes carry "who needs an unread badge?" into SQL. `memberships.each { |m| m.update!(...) }` is N queries in a callback — and the shape that wrongly convinces people the *whole* consequence must go async. The bulk form is what keeps the in-band placement affordable.

## The job is a two-line thunk

Receive rehydrated records, delegate to a model verb, return. No logic — nothing to test because there's nothing in it.

```ruby
class Room::PushMessageJob < ApplicationJob
  def perform(room, message)
    Room::MessagePusher.new(room:, message:).push
  end
end
```

Logic in `perform` is **stranded behind the queue**: only runnable by enqueuing, only testable by draining a queue, only reusable by enqueuing again. Keep the work on the model so another code path can call it synchronously (Campfire's `deliver_webhook` is shared by job and sync callers for exactly this reason). 37signals state it as law: *"shallow job classes that delegate the logic itself to domain models."*

## The guard lives on the `_later` wrapper, not in `perform`

```ruby
def deliver_webhook_later(message)
  Bot::WebhookJob.perform_later(self, message) if webhook   # guard BEFORE enqueue
end

def deliver_webhook(message)
  webhook.deliver(message)                                  # the work, no guard
end
```

The check runs synchronously at the call site, before any job exists — a bot with no webhook produces **zero queue rows**. `return unless ...` at the top of `perform` enqueues, occupies a worker, and deserializes records just to no-op, and copy-pastes the guard into every job that shares the precondition.

## GlobalID: pass the record, not an id to re-find

```ruby
Room::PushMessageJob.perform_later(self, message)   # serialized as gid://app/Message/123, rehydrated loaded

class ApplicationJob < ActiveJob::Base
  discard_on ActiveJob::DeserializationError         # record gone before the worker → drop the job
end
```

Call sites read in domain nouns; the vanished-record branch is written once as `discard_on`. `perform_later(message.id)` + `Message.find(id)` + a hand-rolled rescue re-implements what the framework already absorbs.

## Below the job: raw thread pools live in `lib/`

When work needs a long-lived thread pool (thousands of HTTPS deliveries) that must *not* be wrapped per-unit by the Rails executor, drop to `lib/` and do **all AR reads before posting** — post primitives, never live records:

```ruby
# lib/ — used in a thread pool without the Rails executor
class WebPush::Pool
  def deliver_later(payload, subscription)
    notification    = subscription.notification(**payload)   # AR read BEFORE post
    subscription_id = subscription.id
    delivery_pool.post do
      deliver(notification, subscription_id)                 # plain data + integer, no ORM in the thread
    rescue Exception => e
      Rails.logger.error "WebPush::Pool.deliver: #{e.class} #{e.message}"
    end
  rescue Concurrent::RejectedExecutionError
  end
end
```

Posting the live `subscription` lets fifty threads race for connections outside Rails' pool management → `connection pool exhausted` under load. "Reads first, then primitives" makes that impossible by construction; confining it to one `lib/` file keeps the rest of the app from thinking about executors.

## Scheduled work: cron owns *when*, the model owns *what*

The schedule file holds no logic — each entry names a schedule and calls a domain verb:

```yaml
# config/recurring.yml
production:
  auto_postpone_all_due:
    command: "Card.auto_postpone_all_due"
    schedule: every hour at minute 50
  cleanup_magic_links:
    command: "MagicLink.cleanup"
    schedule: every hour at minute 12
```

Same thunk doctrine wearing a clock; `Card.auto_postpone_all_due` is console-callable with no scheduler running. Stagger minutes to spread load off the top of the hour. A dedicated `CleanupJob` with logic in `perform` is the stranded-logic problem with a timer.

## Resumable jobs: position-as-state

For genuinely long work where a crash mid-run must not re-fire completed deliveries, use the cursor as the bookkeeping:

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

Die after webhook 40 → retry resumes at 41. A `delivered?` boolean is a migration, a write per delivery, and a flag that lies after partial failure — a second source of truth for what is really just position. The `step`/`cursor` scaffolding is declarative job-framework concern, not the domain logic the thunk rule forbids; the real work is still `webhook.trigger(event)`.

## Retry classification: a policy, not a prayer

Transient → `retry_on` with backoff; known-permanent → `rescue_from` matched by error-code prefix, logged and swallowed; **anything unmatched re-raises** so novel failures surface:

```ruby
module SmtpDeliveryErrorHandling
  extend ActiveSupport::Concern
  included do
    retry_on Net::OpenTimeout, Net::ReadTimeout, Socket::ResolutionError, wait: :polynomially_longer
    retry_on Net::SMTPServerBusy, wait: :polynomially_longer   # 4xx temporary
    rescue_from Net::SMTPFatalError do |error|
      case error.message
      when /\A550 5\.1\.1/, /\A552 5\.6\.0/                    # known-permanent: log + drop
        Sentry.capture_exception error, level: :info if Fizzy.saas?
      else
        raise                                                  # load-bearing: novel failures surface
      end
    end
  end
end
```

One blanket `rescue => e; retry` burns workers forever on a permanent `550`, and swallows genuinely novel errors. Each "common one we've seen" comment is a production incident fossilized into the classifier — accumulate yours the same way.

## Ambient tenancy across the job boundary

In a multi-tenant app, jobs run where `Current.account` is blank. Make tenancy ambient, never a job argument — snapshot at enqueue, ride the wire as a GID, re-establish around `perform`:

```ruby
module AccountTenanted
  extend ActiveSupport::Concern
  prepended { around_perform :with_account_context }

  def initialize(...) = (super; @account = Current.account)        # snapshot at ENQUEUE
  def serialize       = super.merge("account" => @account&.to_gid)  # rides as GID
  def deserialize(d)  = (super; @account_gid = d["account"])

  private
    def with_account_context(&block)
      @account = GlobalID::Locator.locate(@account_gid) if @account_gid
      @account ? Current.with_account(@account, &block) : yield
    rescue ActiveRecord::RecordNotFound
      raise ActiveJob::DeserializationError                         # → same discard_on door
    end
end
```

Make it total: `ApplicationJob` does `prepend AccountTenanted`, and prepend the same onto framework jobs that don't inherit from it:

```ruby
ActiveSupport.on_load(:action_mailer) { ActionMailer::MailDeliveryJob.prepend AccountTenanted }
Rails.application.config.after_initialize do
  [Turbo::Streams::ActionBroadcastJob, Turbo::Streams::BroadcastJob,
   Turbo::Streams::BroadcastStreamJob].each { _1.prepend AccountTenanted }
end
```

Threading `account_id` through every job signature is a parameter you can forget on exactly one job — and the resulting cross-tenant read announces itself with no error. (Single-tenant apps like Campfire skip all of this.)

---

## Red flags → fixes

| Red flag in the diff | Fix |
|---|---|
| `after_create`/`after_save` enqueues a job or touches the network | `after_create_commit` — plain callbacks race the rollback (ghost row) |
| Real logic inside `perform` | Two-line thunk delegating to a model verb |
| `return unless ...` guard at the top of `perform` | Move the guard to the `_later` wrapper, before enqueue |
| `perform_later(record.id)` + `Model.find` in the job | Pass the record; GlobalID rehydrates; `discard_on ActiveJob::DeserializationError` |
| `memberships.each { update! }` in a callback | One bulk `update_all` over composable scopes |
| A live AR record handed into a raw thread / `pool.post` | All AR reads before the post; pass primitives; pool lives in `lib/` |
| Scheduled job class with cleanup logic in `perform` | `recurring.yml` one-liner calling a model verb |
| `delivered?` boolean tracking a long job's progress | `ActiveJob::Continuable` — `find_each(start: step.cursor)` + `step.advance!` |
| One blanket `rescue => e; retry` | `retry_on` transient, `rescue_from` known-permanent by code prefix, `else raise` |
| `account_id` threaded through job signatures by hand | `AccountTenanted`-style concern; prepend onto framework jobs too |
| `enqueue_after_transaction_commit` unset in a multi-job app | Set it `true` globally |

---

## The composition: a whole async surface in a dozen lines

```ruby
after_create_commit -> { room.receive(self) }   # trigger, at the durable altitude

def receive(message)
  unread_memberships(message)   # in-band: one bulk update_all
  push_later(message)           # out-of-band: the thinnest thread boundary
end

class Room::PushMessageJob < ApplicationJob
  def perform(room, message)
    Room::MessagePusher.new(room:, message:).push
  end
end
```

One `_commit` trigger, one `receive` that draws the sync/async line, thunk jobs, `_later` wrappers carrying the guards, one `lib/` pool that reads first. The entire async surface of a production chat app — small because each boundary placed at its right altitude absorbs a bug class for free (ghost row, blocked sender, re-notify on edit, connection leak). It isn't doing less.