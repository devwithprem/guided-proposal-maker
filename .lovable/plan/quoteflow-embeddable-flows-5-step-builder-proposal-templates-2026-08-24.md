# QuoteFlow: Embeddable Flows, 5-Step Builder, Proposal Templates

## Where submissions live (answering your question)

Today every form submission becomes an **Enquiry**, but the only way in is the
dashboard's "Recent enquiries" table. Proposals are documents generated *from*
an enquiry — a different object. Fix: add a proper `/enquiries` list page
(search, status filter, flow filter, value column) so all customer entries have
a home. Proposals stay as the document layer.

## 1. Flow builder becomes a 5-step stepper

Replace the current build/preview toggle with a stepper across the top of
`/flows/$flowId`:

| Step | Name | Contents |
| --- | --- | --- |
| 1 | Contact details | Fixed first page: name, email, phone, company. Editable labels/required toggles, can add extra contact fields. |
| 2 | Questions | The existing canvas + component library + properties panel, for the second page only. |
| 3 | Logic | The existing rule builder, plus per-question "show when" conditions so choosing a value reveals follow-up questions. |
| 4 | Preview & template | Customer-facing options + proposal template picker, with live preview beside it. |
| 5 | Submission | What happens after submit: proposal generation, review stage, integrations. |

Each step is a segment in the stepper header with a completion dot; the canvas
below swaps. No data model rewrite — steps are views over the same `Flow`.

## 2. Two-step customer form

`FlowPreview` becomes a two-page wizard:
- Page 1: contact fields, "Continue" button, progress bar (Step 1 of 2).
- Page 2: the conditional questions + live price summary (if enabled).
- Back/continue navigation, required-field validation before advancing.

Conditional questions: a question can carry a `showWhen` condition
(variable / operator / value). Hidden questions are excluded from validation
and pricing, using the existing engine's condition evaluator.

## 3. Preview customization (step 4)

New `flow.settings` object, all editable in step 4:
- Show live price summary — on/off
- Show recommended products — on/off
- Show itemised breakdown vs. total only
- Headline, sub-headline, submit button label
- Thank-you message
- Accent colour for the embedded form
- Proposal template selection

## 4. Submission behaviour (step 5)

New `flow.submission` object:
- Generate proposal: never / on submit
- Delivery: send to customer immediately, or hold in **Review** stage for
  manual approval before sending
- Notification email address
- Integration toggles (reuse the Connections catalog): HubSpot, Slack,
  Stripe deposit link, webhook URL field

Proposals gain a `review` status so the hold-for-approval path is visible in
the proposals list with an "Approve & send" action.

## 5. Embeddable form (SDK / iframe)

- New public route `/embed/$flowId` — renders only `FlowPreview`, no app shell,
  transparent background, auto-height messaging via `postMessage`.
- Connections page gains an **Embed** panel per flow with three copy blocks:
  iframe snippet, script-tag SDK loader, and a "share link" for a hosted page.
- A small `public/quoteflow.js` SDK: reads `data-quoteflow-flow` attributes,
  injects the iframe, listens for resize messages, and fires an
  `onSubmit` callback.

## 6. Proposal templates

Turn the current proposal design into one of several selectable templates,
picked per flow in step 4:
- **Ink** — the existing dark-header premium document
- **Minimal** — light, typographic, lots of whitespace, thin rules
- **Editorial** — serif display headings, two-column intro, photo band
- **Compact** — single-page, table-forward, quick approvals

Each is a component rendering the same proposal data, so switching templates
never loses content.

## Technical notes

- `types.ts`: add `showWhen` to `FlowComponent`; add `FlowSettings`,
  `SubmissionSettings`, `ProposalTemplateId`; extend `Proposal.status` with
  `review`.
- `engine.ts`: reuse `evaluateCondition` for per-component visibility so
  conditional questions and rules share one code path.
- Store seed data gets defaults for the new fields; existing localStorage data
  is merged with defaults so nothing breaks on load.
- New files: `src/routes/enquiries.index.tsx`, `src/routes/embed.$flowId.tsx`,
  `src/components/quoteflow/steps/*`, `src/components/quoteflow/proposals/*`,
  `public/quoteflow.js`.

## Suggested modification

Build this in two passes: first the stepper + two-step form + enquiries list
(the core loop), then embed SDK + proposal templates. That keeps each pass
verifiable rather than one large change.
