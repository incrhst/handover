# The handover format, version 1.3

A handover file describes how to take over a role. It's built for people: the Handover app turns it into a guided first month, a daily dashboard and a reference you can search. It's also built for tools: the format is plain JSON with a published schema, so anything can read it, write it or add to it.

- **File extension:** `.handover`
- **Encoding:** UTF-8 JSON
- **Schema:** [`https://incrhst.github.io/handover/schema/v1.json`](../site/schema/v1.json) (JSON Schema 2020-12, always the newest 1.x; frozen copies: [`v1.0.json`](../site/schema/v1.0.json), [`v1.1.json`](../site/schema/v1.1.json), [`v1.2.json`](../site/schema/v1.2.json), [`v1.3.json`](../site/schema/v1.3.json))
- **Examples:** [`ea-no-overlap.handover`](../site/examples/ea-no-overlap.handover) (1.2, an executive assistant handover with no overlap: the reference case, and the one for sections 9 to 17) and [`sample.handover`](../site/examples/sample.handover) (1.0, a simpler operations lead handover)

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## What's new in 1.3

Version 1.3 lets a regular job say how far ahead the work has to start. Renewing a vehicle can mean starting the registration and fitness 90 days before the date and the insurance 30 days before; a job that is only shown on its date would come up too late. Everything is optional, and every 1.0, 1.1 and 1.2 file stays valid with the same meaning.

- **Lead time** (section 18): `lead` on a `recurring` duty, in days. The job goes on the daily list that many days before its date and stays there until it is done. The date is still when it is due.

## What's new in 1.2

Version 1.2 lets a file describe the role itself, so a tool can write a job description from it: what the role is for and what it calls for, and every job grouped by the part of the role it belongs to, including the jobs that have no schedule. Everything is optional, and every 1.0 and 1.1 file stays valid with the same meaning.

- **The role** (section 17): `role`, with the organisation, purpose, location, hours, travel, who the role manages, the skills the work calls for and what good looks like.
- **Areas of work** (section 17): `area` on a `recurring` duty, such as `"Finance"` or `"Villa / Bookings"`.
- **Jobs done as needed** (section 17): `asNeeded`, the jobs with no schedule. They never appear on the daily list.

## What's new in 1.1

Version 1.1 lets a file carry a whole assistant handover as it is run: an outgoing assistant hands the role to an incoming one, and the principal (the person they assist) takes part. Everything is optional and every 1.0 file stays valid with the same meaning.

- **People** (section 9): `people` with their roles, and `stakeholders` the newcomer must know.
- **The handover process** (section 10): `plan` (three dates, track, steps for named roles, gates) and `asks`, the questions for the principal.
- **Records** (section 11): `gaps`, `inProgress`, `rules`, `decisions`, `risks`, `systems` and `documents`, each item with its own provenance, visibility and closure. A risk can point at a `recurring` duty for its exact schedule.
- **Who decides what, and money** (section 12): `decide`, a three-column board whose cards can carry a spending limit and an approver.
- **Finishing** (section 13): `finalCheck`, `signoff`, `followUps`, `catchUps` and `history`, plus the contact period on `from`.
- **Sharing** (section 14): `audience` and `profile`, with two export profiles, `newcomer` and `record`.
- **Rules** for what is worked out rather than stored (section 15) and for keeping 1.0 readers useful (section 16).
- **Schemas** (section 8): `v1.json` is now always the newest 1.x, and readers MUST NOT reject a 1.x file for fields they don't know.

## 1. Never put secrets in a handover file

Handover files get emailed, shared and fed to AI tools. A file MUST NOT contain passwords, PINs, API keys, tokens, card or bank account numbers, or personal health or financial details. Say where a secret is kept ("in the shared password manager, Finance folder"), never what it is.

This applies to every text field, including every field added in 1.1 and 1.2: a system's `credentialLocation` and `grantedBy`, a document's `url` and `location`, a stakeholder's `relationship`, `involve` and `contact`, an ask's `draft`, `default` and `correction`, follow-up answers, sign-off notes, the `history` log, the role's `organisation`, `purpose`, `location`, `hours`, `travel`, `manages`, `skills` and `measures`, and a job's `area`, `when` and `detail`. Some cases need care:

- **Systems** record where a credential is kept and who grants access. They MUST NOT record the credential itself, a recovery code or a one-time code.
- **People and stakeholders** MAY have contact details. Their `relationship` and `involve` text MUST NOT reveal anyone's health or personal finances: "Dr Lee, the principal's oncologist" is a health detail even without a phone number. Write "Personal appointment contact; see the protected file" instead.
- **Money** (section 12): business spending limits and who approves them are fine. The principal's personal accounts, card limits and balances are personal financial details and MUST NOT be included.

A tool that finds a secret in a file it is writing MUST leave it out and SHOULD tell the person.

## 2. Top level

| Field | Required | Type | Meaning |
|---|---|---|---|
| `handover` | yes | string | Format version: the lowest that has every field the file uses: `"1.3"`, `"1.2"`, `"1.1"` or `"1.0"`. |
| `id` | yes | id | Stable identifier. Keep it the same across versions of the same handover so a reader's progress carries over. |
| `title` | yes | string | What the handover is for, e.g. "Operations lead handover". |
| `$schema` | no | string | The schema URL above. Helps editors and validators. |
| `summary` | no | markdown | Introduction. |
| `from` | no | object | The person handing over: `name` (required), `role`, `contact`, `availableUntil` (date), and since 1.1 `hours` and `paid` (section 13). |
| `updated` | no | date | When the content last changed. |
| `timezone` | no | string | IANA zone, e.g. `"America/Jamaica"`. Decides which day it is for recurring duties and the plan. Default: the reader's zone. |
| `settings` | no | object | `dailyExportTime` (time, default `"07:00"`): when tools that export a daily task sheet do so. |
| `path` | no | stage[] | The newcomer's first weeks, in order. |
| `recurring` | no | recurring[] | Duties on a schedule. |
| `questions` | no | question[] | Common questions with short answers. |
| `sections` | no | section[] | Reference material. |
| `progress` | no | progress | One reader's progress. Present only when exported with progress. |
| `audience` | no | role[] | 1.1. The roles this file was exported for (section 14). |
| `profile` | no | string | 1.1. `"newcomer"` or `"record"`: the export profile used (section 14). |
| `people` | no | person[] | 1.1. Who holds each role (section 9). |
| `stakeholders` | no | stakeholder[] | 1.1. People the newcomer must know (section 9). |
| `plan` | no | plan | 1.1. How the handover itself is run (section 10). |
| `asks` | no | ask[] | 1.1. Questions for the principal (section 10). |
| `gaps`, `inProgress`, `rules`, `decisions`, `risks`, `systems`, `documents` | no | lists | 1.1. Records (section 11). |
| `decide` | no | object | 1.1. Who decides what, with spending limits (section 12). |
| `finalCheck`, `signoff`, `followUps`, `catchUps`, `history` | no | | 1.1. Finishing the handover (section 13). |
| `rendered` | no | id[] | 1.1. Sections written for 1.0 readers from structured data (section 16). |
| `role` | no | object | 1.2. The role itself, for a job description (section 17). |
| `asNeeded` | no | asNeeded[] | 1.2. Jobs with no schedule, done when something calls for them (section 17). |

**Types.** An *id* matches `^[a-z0-9][a-z0-9-]{0,63}$`. A *date* is `YYYY-MM-DD`. A *date-time* is ISO 8601 with a time zone, e.g. `2026-10-05T09:12:00-05:00`. A *time* is 24-hour `HH:MM`. *Markdown* is described in section 4. A *role* is one of `outgoing`, `incoming`, `principal`, `owner`, `facilitator`.

**Uniqueness.** Ids MUST be unique within their own list. Task ids MUST be unique across the whole `path`. In 1.1 this covers every list: `people`, `stakeholders`, `plan.steps`, `asks`, each record list, `decide.cards`, `finalCheck`, `signoff.notes`, `followUps`, `catchUps` and `history`.

**References.** Every reference MUST resolve:

| Field | Must name |
|---|---|
| `see` (recurring, questions) | a section id |
| `risks[].recurring` | a `recurring` id |
| `plan.steps[].ask` | an ask id in `asks` |
| `decide.cards[].approver.stakeholder` | a stakeholder id |
| `rendered[]` | a section id |

Roles are a fixed list, not references: a step can belong to `incoming` before anyone is named.

## 3. Objects

**Stage** (`path[]`): `id`, `title`, `tasks` (at least one) are required. Optional `summary` and `tip` (`text` required, optional `title`).

**Task** (`path[].tasks[]`): `id`, `text` required. Optional `detail`.

**Recurring duty** (`recurring[]`): `id`, `text`, `every` required. Optional `time`, `start`, `end`, `detail`, `see`, plus the schedule fields below, since 1.2 `area` (section 17) and since 1.3 `lead` (section 18).

**Question** (`questions[]`): `q` (the question, plain text) and `a` (the answer, markdown) required. Optional `id`, `tag` (a short category label) and `see`.

**Section** (`sections[]`): `id`, `title`, `body` required.

The objects added in 1.1 are described in sections 9 to 13. Every object, old and new, MAY carry `x-` fields (section 7).

## 4. Text

Fields marked *markdown* use this subset. Tools SHOULD render it and MAY show it as plain text.

- `#`, `##`, `###` headings
- Paragraphs separated by a blank line
- `-` or `*` bullet lists, `1.` numbered lists
- Tables with `|` columns and a `|---|` line under the header
- `**bold**`, `*italic*`, `` `code` ``
- Links `[text](https://…)`. A link to `#<section id>` points at that section.
- A paragraph starting `> ` is a note. One starting `!> ` is a warning.

Raw HTML MUST NOT be interpreted; tools MUST escape it.

**Gaps.** Information still to be filled in is marked as a gap:

- Text that starts with `TODO:` is a gap up to the end of that line (or table cell).
- `{TODO: …}` marks a gap anywhere inside a sentence.

Tools SHOULD make gaps easy to see and count them, so the author knows what's left. In 1.1, gap markers count in every text field, including those of the new objects. An item on the `gaps` list (section 11) is a different thing: a question someone raised during the handover. Tools SHOULD count the two separately.

## 5. Schedules

`every` decides when a recurring duty falls due. Dates are worked out in the handover's `timezone`.

| `every` | Due on | Extra fields |
|---|---|---|
| `day` | Every day | |
| `weekday` | Monday to Friday | |
| `week` | The given day or days | `on`: `"mon"`…`"sun"` or a list. Default `"mon"`. |
| `month` | The given day of every month | `day`: 1–31 or `"last"`. Default 1. A day past the month's end falls on its last day. |
| `quarter` | The given day in one month of each quarter | `day` as for month. `monthOfQuarter`: 1–3, default 1 (1 = Jan/Apr/Jul/Oct, 2 = Feb/May/Aug/Nov, 3 = Mar/Jun/Sep/Dec). |
| `year` | Once a year | `date`: `"MM-DD"`. `"02-29"` falls on 28 February in other years. |

`start` and `end` (inclusive dates) limit when a duty applies. `time` is informational: the duty is due on the day, and `time` says when in the day.

Since 1.3, `lead` says how many days before the date the work has to start (section 18). The schedule still gives the date the duty is due.

An **occurrence** is one duty on one date, written `<id>@<YYYY-MM-DD>`, e.g. `payroll@2026-12-25`.

Tools SHOULD treat a past occurrence as **overdue** only if it is the duty's most recent occurrence, it isn't done, and it falls on or after `progress.firstSeen`. Missing a daily duty last week should not pile up seven overdue items.

## 6. Progress

A file MAY carry one reader's progress, so it can be moved between machines or tools.

| Field | Type | Meaning |
|---|---|---|
| `updated` | date-time | When progress last changed. |
| `firstSeen` | date | The reader's first day with this handover. |
| `tasks` | object | Done path tasks: `"<task id>": "<when done>"` |
| `recurring` | object | Done occurrences: `"<id>@<date>": "<when done>"` |
| `notes` | string | The reader's own notes and questions. |

When a tool imports a file with progress for a handover it already has, it SHOULD merge: keep every completion from both, keep the earlier `firstSeen`, and keep the local notes unless they are empty.

Sharing a handover with someone new SHOULD leave `progress` out. Section 14 says what else to leave out.

`progress` is one reader's ticks on the `path` and `recurring` duties. It is not the handover's process state: the status of plan steps, asks and checks lives in those objects (sections 10 and 13).

## 7. Extensions

Any object MAY carry extra fields whose names start with `x-`, for example `"x-owner": "finance"` on a recurring duty. Tools MUST ignore `x-` fields they don't understand and SHOULD keep them when they rewrite a file. Use a prefix that names your tool, e.g. `x-acme-priority`, to avoid clashes.

## 8. Versions

`handover` is `"<major>.<minor>"`. A minor version only adds optional fields, and never changes what an existing field means. A new major version means a breaking change, and a tool SHOULD refuse a major version it doesn't support, saying why.

**Readers.** A tool that reads 1.x MUST open any later 1.x file. It MUST NOT reject the file because of fields it doesn't know. It SHOULD ignore them, tell the person that some parts may not show, and keep them if it rewrites the file.

**Writers.** A file SHOULD declare the lowest version that has every field it uses: `"1.0"` when it uses only 1.0 fields, `"1.1"` when it uses 1.1 fields but none added in 1.2, `"1.2"` when it uses 1.2 fields but no `lead`, and `"1.3"` otherwise. A file that declares a version lower than the fields it uses is still readable; validators SHOULD warn about it. A tool that adds a newer field to a file SHOULD raise the declared version to match.

**Schemas.** The schema rejects unknown fields (`additionalProperties: false`, apart from `x-` fields) so that writers catch typos. That strictness is a check for writers, not readers. To stop a strict schema from rejecting newer files:

- `schema/v1.json` is always the schema for the newest 1.x. Because a minor version only adds optional fields, every older 1.x file is valid against it.
- `schema/v1.0.json`, `schema/v1.1.json`, `schema/v1.2.json`, `schema/v1.3.json` and so on are frozen copies, for a writer that must prove a file uses nothing newer.
- A validator that has only an older schema and meets a file with a higher minor version SHOULD treat unknown fields as warnings, not errors. The reference implementation (`core.js`) does this.

## 9. People (1.1)

**Person** (`people[]`): `id`, `name`, `roles` (at least one role) required. Optional `contact`. One person can hold several roles: the outgoing assistant is often the `owner` too, the person who set the handover up. Each role MUST be held by at most one person. `facilitator` is optional, for someone (often HR) who runs the handover for others.

The person with the `outgoing` role is the same person as `from`. When both are present they SHOULD have the same `name`, and tools SHOULD keep writing `from` for 1.0 readers.

The principal takes part but is never assumed to use any tool: they get links and conversations, and the assistants keep the record. Tools MUST NOT require the principal to open them.

**Stakeholder** (`stakeholders[]`): someone the newcomer must know. `id`, `name`, `relationship` (who they are to the principal or the role) required. Optional `involve` (markdown: when to involve them), `contact`, `contactVisibleTo` (roles that may see the contact; section 14) and the item fields in section 11.

## 10. The handover process (1.1)

The `path` is the newcomer's guided month. The `plan` is the process of running the handover: dated steps for named roles. They are different things and both can be present.

**Plan** (`plan`):

| Field | Required | Type | Meaning |
|---|---|---|---|
| `prepStart` | yes | date | When preparation starts. |
| `lastDay` | yes | date | The outgoing assistant's last day. |
| `firstDay` | no | date | The incoming assistant's first day. Absent while nobody is hired. |
| `track` | no | string | `"light"` (default) or `"full"`: how much of the principal's time the plan uses. |
| `practice` | no | boolean | `true` marks a practice run: nothing in it was sent to anyone. Tools SHOULD label it clearly and MUST NOT treat it as a real record. |
| `template` | no | string | The plan template and version the steps come from, e.g. `"handover-desk/2026-11"`. |
| `steps` | no | step[] | The steps. |

Overlap, phases, working days and step dates are worked out, not stored (section 15).

**Step** (`plan.steps[]`): `id`, `role`, `phase`, `title`, `status` required.

- `role`: who does it. Steps can be reassigned, so this is the current role, not the template's.
- `phase`: `prepare`, `shadow`, `swap` or `after`. With no overlap, tools SHOULD label `shadow` "Incoming starts" and `swap` "Incoming takes over".
- `title` (line) and optional `why` (line: one sentence on why it matters).
- `status`: `open`, `done` or `na` (not applicable). `na` MUST have a `reason`.
- `gate` (optional): the gate it counts toward, one of `ready` (ready for the principal), `done` (final check) or `sign` (sign-off).
- `ask` (optional): the ask this step is waiting on.

The 30, 60 and 90-day check-ins with the principal are ordinary steps in the `after` phase.

**Ask** (`asks[]`): a question for the principal, answered from a link in their own channel. `id` and `status` required. `id` is one of seven fixed keys:

| `id` | Asks the principal about |
|---|---|
| `breaks` | What breaks if the outgoing assistant is absent |
| `profile` | The principal profile: is it right? |
| `access` | Access approvals for the incoming assistant |
| `limits` | Who decides what (section 12) |
| `confid` | Confidentiality rules |
| `emergency` | The emergency plan |
| `signoff` | Countersigning the handover |

Optional: `minutes` (integer: the estimate the principal was given), `draft` (markdown: the message as drafted), `replyBy` (date), `default` (markdown: what applies if they don't reply), `correction` (markdown), `sent` and `answered` (date-times).

`status` is `draft`, `sent`, `confirmed`, `corrected` or `defaulted` (the reply-by date passed and the default applied). `corrected` MUST have a `correction`. `confirmed`, `corrected` and `defaulted` SHOULD have `answered`, and every status except `draft` SHOULD have `sent`. A correction usually also becomes an item on the `gaps` list.

## 11. Records (1.1)

The records are what the assistants collect while handing over. Each is a list of items with an `id`, and each item MAY carry these fields:

| Field | Type | Meaning |
|---|---|---|
| `added` | date-time | When it was added. |
| `addedBy` | role | Who added it. |
| `aiDrafted` | boolean | `true` if an AI drafted it. Tools SHOULD show this, so a person reviews it. |
| `visibleTo` | role[] | Only these roles may see it. Absent: anyone the file is shared with (section 14). |
| `closed` | object | Present when the item is closed: `how` (required), `at` (date-time), `by` (role), `fix` (line: for a fix, the link or document that now answers it). |

`closed.how` is `fixed`, `answered` (answered in one of the logs), `principal` (handed to the principal), `done` (a thing in progress finished) or `dropped`.

| List | Item fields (required in bold) |
|---|---|
| `gaps` | **`text`**; `blocks` (boolean: it blocks work today). Close with `fixed`, `answered` or `principal`. |
| `inProgress` | **`text`**; `owner` (role); `due` (date). With no overlap, every open item SHOULD have a real `due` date and an `owner` who will still be there after the last day. Close with `done` or `dropped`. |
| `rules` | **`text`** ("If X, then Y"); `situation` (line: the named situation it belongs to, e.g. "Principal travelling"). |
| `decisions` | **`text`**; `reason` (markdown); `date` (when decided). |
| `risks` | **`text`**, **`list`**; `severity`; `treatment`; `evidence`; `recurring`. |
| `systems` | **`name`**; `purpose`; `credentialLocation` (where the credential is kept, never the credential); `grantedBy` (who grants access); `checks`. |
| `documents` | **`title`**; `url` or `location` (at least one); `type`; `status` (`draft` or `final`); `owner` (role); `checks`. |

**Risks.** `list` is `weekly` (recurring work), `occasional` (occasional or seasonal flows) or `spof` (only this assistant knows or does it). `severity` is `high`, `medium` or `low`: how much it hurts if it fails. `treatment` is how it is passed on: `record` (record someone doing it), `write` (write it down) or `brief` (a line in the one-page brief). `evidence` says what the outgoing assistant's history shows: `cadence` (`daily`, `weekly`, `monthly`, `quarterly`, `annual` or `rare`), `occurrences` (integer), `hours` (number), `firstSeen` and `lastSeen` (dates) and `source` (line, e.g. "Time tracker, Jun to Nov 2026").

A risk that happens on an exact schedule names a `recurring` duty with `recurring`. The duty holds the schedule, so it appears on the newcomer's daily list; the risk holds the risk metadata. `evidence.cadence` records what was observed and the duty's `every` records the rule. If they disagree, the duty is authoritative for the schedule.

**Access checks** (`checks`, on systems and documents): up to three results, each `{"result": "pass" | "fail", "note": line, "at": date-time}`:

- `opens`: the incoming assistant can open it.
- `create`: they can create or change something test-safe in it.
- `level`: their access level is right.

A `fail` SHOULD have a `note` saying what failed, and usually also becomes a blocking item on the `gaps` list for whoever grants access.

**Documents.** `type` is `folder`, `brief` (the one-page brief), `profile` (the principal profile), `recording`, `guide` (a step-by-step guide), `template`, `protected` or `other`. A handover file links to documents and never contains them. For a `protected` file, give `location` (where it is kept and who holds it) and SHOULD NOT give a `url` anyone could follow.

## 12. Who decides what, and money (1.1)

**Board** (`decide`): `cards` (card[]), `confirmed` (boolean: the principal confirmed the board) and optional `confirmedAt` (date-time).

**Card** (`decide.cards[]`): `id`, `text`, `column` required. `column` is `alone` (decide alone), `check` (check first) or `principal` (always the principal). Optional:

- `movedByPrincipal` (boolean): the principal moved it to this column.
- `limit`: `{"amount": number, "currency": "USD"}` (ISO 4217): the most the assistant may commit for this kind of decision. The amount is a business limit, never a balance (section 1).
- `approver`: who approves above the limit or in the `check` column, either `{"role": "<role>"}` or `{"stakeholder": "<stakeholder id>"}`.
- The item fields in section 11.

Money and approvals use the same board: "Book travel up to USD 2,000" is a card in `alone` with a `limit`. "Expense claims over USD 2,000" is a card in `check` with an `approver`. "Sign off the quarterly board budget" is a card in `principal`. Write "who signs off" as a card whose `approver` is the person who signs.

## 13. Finishing the handover (1.1)

**Final check** (`finalCheck[]`): up to seven items, `id` and `result` required. `id` is one of `recurring` (recurring work), `in-progress`, `decisions` (decisions and reasons), `context` (live context), `access`, `exceptions` and `decide` (who decides what). `result` is `pass` or `fail`. A `fail` MUST have an `owner` (role) and a `due` date. Optional `note` (markdown) and `at` (date-time).

**Sign-off** (`signoff`): `outgoing`, `incoming`, `principal` (date-times: when each signed), `frozen` (date: when the record was frozen) and `notes` (notes added to the frozen record afterwards: `id`, `text` and `at` required, optional `role`). Work goes on after `frozen`: the follow-up checks still add gaps, and an item's `added` shows that it came later. When something that was signed changes, tools SHOULD add a note.

**Contact period** (on `from`): `availableUntil` is the last day the outgoing assistant can be contacted, and `contact` is the channel. 1.1 adds `hours` (line: e.g. "Weekdays 9 to 5, replies within a day") and `paid` (boolean: whether that time is paid).

**Follow-up checks** (`followUps[]`): `id` is `f1` (first) or `f2` (second). `answers` holds up to three markdown answers to these questions, in this order:

1. What did you have to ask about that should have been written down?
2. What went wrong, or nearly did, that the handover should have caught?
3. What is the principal still doing that the assistant should be doing?

Optional `gapsFound` and `gapsFixed` (integers) and `at` (date-time). Each gap found SHOULD also be an item on the `gaps` list.

**Catch-ups** (`catchUps[]`): the daily catch-ups that were held, each `id` and `at` (date-time).

**History** (`history[]`): the change log. `id`, `at`, `source` and `text` required. `source` is `app` (a person, through a tool) or `ai`. Optional `role`. It records what happened and SHOULD NOT copy whole items.

## 14. Sharing and visibility (1.1)

A file is something people share. Some items are only for some roles: a principal's private travel, a performance concern about a supplier.

**Audience.** `audience` lists the roles the file was exported for. An item is visible to the audience if it has no `visibleTo`, or if every role in `audience` is in its `visibleTo`. The same rule applies to a stakeholder's `contactVisibleTo` for the `contact` field.

- A tool writing a file MUST leave out every item, and every stakeholder contact, that the audience may not see. A file without `audience` is for anyone, so it MUST NOT contain any item with `visibleTo` or any stakeholder `contact` with `contactVisibleTo`.
- A tool SHOULD NOT write `visibleTo` or `contactVisibleTo` into a file meant for someone outside the roles: someone new, another organisation, a future assistant. Those fields only make sense to people inside the handover.
- Validators SHOULD report a file that breaks these rules as an error.

**Export profiles.** `profile` names what a file was exported for. A tool SHOULD use one of these.

| | `newcomer` | `record` |
|---|---|---|
| For | Someone taking over, and anyone after them. Default `audience`: `["incoming"]`. | The people running the handover: a backup, a move to another tool, an archive. |
| Content (`path`, `recurring`, `asNeeded`, `role`, `questions`, `sections`, `people`, `stakeholders`) | Kept | Kept |
| Records (section 11) and `decide` | Open items kept; closed items left out | Kept, closed items too |
| `rendered` sections (section 16) | Written again from what is kept | Written again from what is kept |
| Item fields `added`, `addedBy`, `aiDrafted`, `visibleTo`, `contactVisibleTo` | Left out | Kept |
| `plan`, `asks`, `finalCheck`, `signoff`, `followUps`, `catchUps`, `history` | Left out | Kept |
| `from.paid` | Left out | Kept |
| `progress` | Left out | Only when exporting someone's own progress |
| Items the audience may not see | Left out | Left out |

The newcomer profile keeps the knowledge and drops the process: asks, signatures and the change log are about how the handover was run, not about how to do the job. A newcomer needs the decision, not who drafted it or when.

## 15. Worked out, not stored (1.1)

A file stores facts. These are worked out from them, and MUST NOT be stored as fields (an `x-` field is still allowed for a tool's own cache, but readers MUST NOT trust it over the facts):

| Value | Worked out from |
|---|---|
| Overlap | `plan.firstDay` on or before `plan.lastDay` means the assistants overlap. A `firstDay` after `lastDay` (or none) means no overlap: the principal holds the desk in between. |
| Working days | Monday to Friday, the same days as `every: weekday`. Plan dates never fall on a weekend. |
| Phase boundaries and labels | The three dates, overlap and the plan template. Left to tools. |
| Step dates | The three dates, `track`, overlap and `plan.template`. A tool that knows the template works them out; others show the steps without dates, or the plan section written for 1.0 readers (section 16). |
| Gate status | At least: a gate is met when every step with that `gate` is `done` or `na`. Tools MAY apply stricter checks, such as the final check passing for `done` or all three signatures for `sign`. Gate due dates come from the step dates. |
| At risk, early warnings | Left to tools. |
| The principal's minute budget | The sum of the asks' `minutes`, compared with a budget the tool sets from `track` and overlap. |
| Check-in dates | The `after` steps' dates. |
| An ask's title, link and ready-to-paste message | The ask `id`, the people and the tool that sends it. |

## 16. Writing for 1.0 readers (1.1)

A reader that only knows 1.0 ignores the 1.1 fields. To make sure it loses structure but not content, a tool writing 1.1 structured data SHOULD also render the parts that matter to people into `sections`, as Markdown tables or lists:

- people and stakeholders;
- systems and access, and documents;
- "when this happens" rules, decisions and risks;
- things in progress and open gaps;
- who decides what, with limits and approvers;
- the plan, with step dates when the tool knows them;
- since 1.2, the role and the jobs done as needed.

Leave out what the profile and audience leave out (section 14). List the ids of those sections in `rendered`. A reader that understands the structured data SHOULD hide the rendered sections instead of showing everything twice, and a tool that rewrites the file SHOULD write them again from the data rather than edit them by hand.

## 17. The role, areas of work and jobs done as needed (1.2)

A handover already holds most of what a job description says: the regular jobs and their timing, who decides what, who the role works with and the systems it uses. Version 1.2 adds the rest of what the outgoing person knows about the role, so a tool can write the job description from the file. Like everything else in the file, these fields describe the role as it is done today.

**Role** (`role`, an object). Every field is optional.

| Field | Type | Meaning |
|---|---|---|
| `organisation` | line | The organisation the role is in, as it should appear on a job description. |
| `purpose` | markdown | Why the role exists, in two or three sentences. |
| `location` | line | Where the work is done, e.g. "Kingston office, two days a week from home". |
| `hours` | line | The working pattern, e.g. "Weekdays 8:30 to 5, some evening events". Not the same as `from.hours`, which is when the outgoing person can be contacted. |
| `travel` | line | How much travel the role involves. |
| `manages` | line | Who the role manages or directs, if anyone. |
| `skills` | markdown | The skills and experience the work calls for, usually a list. |
| `measures` | markdown | What good looks like: how anyone can tell the role is done well. |

Like every text field, the role, area and job fields MUST NOT hold passwords, PINs, API keys, tokens, card or bank account numbers, or personal health or financial details (section 1). A job that uses a login says where the credential is kept and who grants access, never the credential. `role` MUST NOT hold pay, benefits or any other personal financial detail either. Pay is decided when someone is hired, not handed over. Who the role reports to is not stored either: it is the person with the `principal` role (section 9).

**Area** (`area`, a line, on a `recurring` duty or an `asNeeded` job): the part of the role the job belongs to, such as `"Finance"` or `"Office and staff"`. To put an area under a larger one, write both with ` / ` (a slash with a space each side) between them: `"Olive Branch Villa / Bookings"` is the Bookings part of Olive Branch Villa. A slash with no spaces, as in `"Account Executive/Admin Assistant"`, is part of the name. Jobs with the same `area` belong together. Areas are listed in the order they first appear, regular jobs first. Use the same spelling each time.

**Job done as needed** (`asNeeded[]`): a job with no schedule, done when something calls for it. `id` and `text` (line) are required. Optional `area`, `when` (line: what calls for it, e.g. "When a new member of staff joins"; absent means "as needed"), `detail` (markdown) and `see` (a section id). Ids MUST be unique within `asNeeded`. A job done as needed never appears on a daily list and has no progress. A job that happens on a date, even a rough one, belongs in `recurring`, with the rule it can't express in `detail` (section 5).

**Job descriptions.** A tool that writes a job description from a file SHOULD say only what the file shows. A job description usually goes beyond the people in the handover, to HR or to candidates, so it SHOULD leave out every item with `visibleTo`, every stakeholder `contact`, and closed items. It SHOULD group the jobs by `area` when the file gives areas, and by how often they happen otherwise.

## 18. Lead time (1.3)

Some jobs take longer than a day. A vehicle's registration and fitness can take three months to renew, its insurance a month, a work permit or a passport longer. The date on the schedule is the deadline, and the work has to start well before it.

**Lead** (`lead`, an integer from 1 to 366, on a `recurring` duty): how many days before each date the work has to start.

- **The date is still the due date.** `every` and its fields give the date the duty is due, as in section 5. An occurrence is still `<id>@<due date>`, so progress (section 6) is unchanged: ticking a job done ahead of time marks that occurrence done.
- **On the list from the start day.** For an occurrence due on date D, the start day is D minus `lead` days. From the start day until it is done, tools SHOULD show the occurrence as work to start, with its due date and the days left. On D it is due like any other duty, and after D an occurrence that isn't done is overdue under the rule in section 5.
- **Looking ahead.** Where a tool lists what is coming up, it SHOULD list a job with a lead time by its start day ("Start: renew the van insurance, due 15 March"), not only by its due date.
- **One deadline, several lead times.** When one date needs several things started at different times, write one duty for each, with the same schedule, its own `lead` and the same `area`. A vehicle renewal with a 90-day registration and fitness and 30-day insurance is two duties:

```json
[
  { "id": "van-registration", "text": "Renew the van's registration and fitness", "area": "Vehicles", "every": "year", "date": "03-15", "lead": 90, "detail": "Book the fitness test first: the registration can't be renewed without the certificate." },
  { "id": "van-insurance", "text": "Renew the van's insurance", "area": "Vehicles", "every": "year", "date": "03-15", "lead": 30 }
]
```

- **No longer than the time between occurrences.** A `lead` as long as the time between two occurrences (a month for a monthly duty, 7 days for a weekly one on one day) means one occurrence starts before the last is due. That is allowed, and validators SHOULD warn about it. A `lead` on a duty done every `day` or `weekday` has no effect, and validators SHOULD warn about it too.
- **Rough lead times.** Lead time is in whole days. Write "about three months" as 90, and say anything the number can't, such as "start as soon as the insurer sends the renewal notice", in `detail`.

A reader that doesn't know `lead` shows the duty on its date only, too late for the work it needs. A writer that expects such readers MAY also say the lead time in `detail` ("Start 90 days before the date").

## Changelog

- **1.3** (2026-11-27). Added `lead` on `recurring` duties (section 18): how many days before its date a job has to start, so it goes on the list in time. Added `v1.3.json`. Changed the writers' rule to name 1.3. Nothing in 1.0, 1.1 or 1.2 changed meaning.

- **1.2** (2026-11-27). Added `role`, `asNeeded` and `area` on `recurring` duties (section 17), so a file can describe the role for a job description. Added `v1.2.json`. Changed the writers' rule to name 1.2, and asked tools that add a newer field to raise the declared version. Nothing in 1.0 or 1.1 changed meaning.
- **1.1** (2026-11-26). Added `audience`, `profile`, `people`, `stakeholders`, `plan`, `asks`, `gaps`, `inProgress`, `rules`, `decisions`, `risks`, `systems`, `documents`, `decide`, `finalCheck`, `signoff`, `followUps`, `catchUps`, `history` and `rendered`, plus `from.hours` and `from.paid`. Extended the no-secrets rule to every new text field. Added uniqueness and reference rules for the new lists, the visibility rules and the `newcomer` and `record` profiles, the list of values that are worked out rather than stored, and the rule to render structured data into `sections` for 1.0 readers. Settled the schema conflict: `v1.json` is the newest 1.x, frozen copies are published for each minor version, and readers MUST NOT reject a 1.x file for unknown fields. Nothing in 1.0 changed meaning.
- **1.0** (2026-11). First version.
