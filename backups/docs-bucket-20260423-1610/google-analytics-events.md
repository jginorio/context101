# Newsletter Form Tracking — For Analytics

Summary of what's now tracked for newsletter/email capture forms on plateapr.com, how it compares to the original brainstorm spec, and how to use it in GA4.

---

## Original spec vs. what's live

The brainstorm had 5 placements and 5 events per placement, with event names in PascalCase (`FormViewed`, `FieldInputted`, etc.). The final implementation keeps the same funnel but uses GA4-native snake_case event names. The original PascalCase name is still recorded on every event as a parameter (`form_event_type`), so both vocabularies work when you build reports.

### Event names

| Original spec name | GA4 event name | `form_event_type` value |
|---|---|---|
| FormViewed | `newsletter_form_view` | `viewed` |
| FieldInputted | `newsletter_field_input` | `field_input` |
| FormSubmitted | `newsletter_form_submit` | `submit_attempt` |
| FormOutcomeReceived | `newsletter_form_outcome` | `validated` |
| Iterable subscribe event | `newsletter_subscription` | `subscribed` |

### Placements

| Spec placement | Status | Notes |
|---|---|---|
| HEADER | Live | In the spec this was called "HEADER" — in practice it is the hero at the top of the homepage ("Menos ruido. Más contexto."). |
| FOOTER | Live | The form at the bottom of every page. |
| EMAIL PAGE (`/email/`) | Live | The dedicated email landing page with a signup form at the top. |
| ARTICLE | Live | The inline form placed inside article posts. |
| SUBSCRIPTION PAGE (`/suscripciones`) | Live | The hero form on the dedicated subscribe page. |

All 5 placements from the original spec are now live or in flight. Nothing is missing.

---

## What each event means

| Event | Fires when |
|---|---|
| `newsletter_form_view` | The user scrolls and the form becomes at least 50% visible on screen. Fires once per page load. |
| `newsletter_field_input` | The user clicks into or types in the email field for the first time. Fires once per page load. |
| `newsletter_form_submit` | The user clicks the submit button. This is the "attempt" — it fires before validation runs. |
| `newsletter_form_outcome` | The system has finished processing the attempt. Always fires after a submit, with an `outcome` value explaining what happened. |
| `newsletter_subscription` | The email was valid and has been successfully added to Iterable. This is the conversion event. |

On a successful subscribe you will see **3 events in quick succession**: `newsletter_form_submit` → `newsletter_form_outcome` (outcome = success) → `newsletter_subscription`.

On a failure you will see **2 events**: `newsletter_form_submit` → `newsletter_form_outcome` (with a failure outcome).

---

## Parameters sent on every event

Every event carries a consistent set of parameters ("formContext") so you can slice and filter reports the same way across the funnel.

| Parameter | Registered as custom dimension? | What it tells you |
|---|---|---|
| `placement` | Yes | Which placement the form is in: `homepage_hero`, `footer`, `email_page`, `article`, `subscription_page`. |
| `form_id` | Yes | Unique ID for the specific form instance on the page. |
| `form_event_type` | Yes | The stage of the funnel: `viewed`, `field_input`, `submit_attempt`, `validated`, `subscribed`. |
| `event_label` | Yes | Human-readable form label (e.g. "Footer Newsletter Form"). Preserved for continuity with legacy reports. |
| `form_name` | No (sent as plain parameter) | Same human label as `event_label` for most placements. Only differs on the subscription page (`Suscripciones Hero` vs. `Suscripciones Page`). |
| `form_type` | No | Always `email_capture`. Reserved for if other form categories are added later. |

### Extra parameters on `newsletter_form_outcome`

| Parameter | Registered? | Values |
|---|---|---|
| `outcome` | Yes | `success`, `validation_failed`, `api_error`, `rate_limited`. |
| `rejection_reason` | Yes | Why the email was rejected, e.g. `client_regex` (user typed an invalid-format email), `suggested_correction` (typo detected, suggestion offered), `api_invalid` (validation API rejected it), or a specific reason string from the API. Only present when `outcome` is not `success`. |

---

## Placement values to filter by

In any GA4 report or Explore, filter by the `placement` dimension using these exact values:

| Placement | `placement` value |
|---|---|
| Header (homepage hero) | `homepage_hero` |
| Footer | `footer` |
| Email page (`/email/`) | `email_page` |
| Article | `article` |
| Subscription page | `subscription_page` |

---

## Suggested funnel in GA4 Explore

Use **Funnel exploration** with these steps:

1. `newsletter_form_view`
2. `newsletter_field_input`
3. `newsletter_form_submit`
4. `newsletter_subscription`

Break down by `placement` to compare performance across the five placements. The gap between step 3 and step 4 is where validation rejections and API errors happen — use `newsletter_form_outcome` with `outcome != success` to see why people drop off.

---

## Differences vs. the original spec — quick reference

- **Event names are snake_case, not PascalCase.** GA4 convention. The original PascalCase names are preserved as the `form_event_type` parameter so both schemas are queryable.
- **`event_label` now fires on all 5 events**, not just the subscribe event. Existing filters on `newsletter_subscription` still work; the same filter can now also be applied across the rest of the funnel.
- **`rate_limited` is a new `outcome` value** that did not exist in the brainstorm. It surfaces when someone clicks submit more than once in a 3-second window.
- **The email page and the article placement share the same underlying form component** (the `pocillo-newsletter` block). They are distinguished in reporting via the `placement` value (`email_page` vs `article`), set automatically based on where the form is rendered.

---

## What's registered as a custom dimension (final list)

| Dimension | Scope | Used by |
|---|---|---|
| `event_label` | Event | All 5 events |
| `event_label` | User | All 5 events |
| `form_event_type` | Event | All 5 events |
| `form_id` | Event | All 5 events |
| `outcome` | Event | `newsletter_form_outcome` only |
| `placement` | Event | All 5 events |
| `rejection_reason` | Event | `newsletter_form_outcome` only (when `outcome != success`) |

`form_name`, `form_type`, and the two editable block title/description fields are sent on every event but are not registered as custom dimensions. They are still accessible in GA4 Explore and in BigQuery exports. If you need any of them in standard reports, register them in GA4 Admin — no developer work required.
