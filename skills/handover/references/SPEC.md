# The handover format, version 1.0

A handover file describes how to take over a role. It's built for people: the Handover app turns it into a guided first month, a daily dashboard and a reference you can search. It's also built for tools: the format is plain JSON with a published schema, so anything can read it, write it or add to it.

- **File extension:** `.handover`
- **Encoding:** UTF-8 JSON
- **Schema:** [`https://incrhst.github.io/handover/schema/v1.json`](../site/schema/v1.json) (JSON Schema 2020-12)
- **Example:** [`sample.handover`](../site/examples/sample.handover)

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 1. Never put secrets in a handover file

Handover files get emailed, shared and fed to AI tools. A file MUST NOT contain passwords, API keys, tokens, card numbers or personal health or financial details. Say where a secret is kept ("in the shared password manager, Finance folder"), never what it is.

## 2. Top level

| Field | Required | Type | Meaning |
|---|---|---|---|
| `handover` | yes | string | Format version. `"1.0"` for this spec. |
| `id` | yes | id | Stable identifier. Keep it the same across versions of the same handover so a reader's progress carries over. |
| `title` | yes | string | What the handover is for, e.g. "Operations lead handover". |
| `$schema` | no | string | The schema URL above. Helps editors and validators. |
| `summary` | no | markdown | Introduction. |
| `from` | no | object | The person handing over: `name` (required), `role`, `contact`, `availableUntil` (date). |
| `updated` | no | date | When the content last changed. |
| `timezone` | no | string | IANA zone, e.g. `"America/Jamaica"`. Decides which day it is for recurring duties. Default: the reader's zone. |
| `settings` | no | object | `dailyExportTime` (time, default `"07:00"`): when tools that export a daily task sheet do so. |
| `path` | no | stage[] | The first weeks, in order. |
| `recurring` | no | recurring[] | Duties on a schedule. |
| `questions` | no | question[] | Common questions with short answers. |
| `sections` | no | section[] | Reference material. |
| `progress` | no | progress | One reader's progress. Present only when exported with progress. |

**Types.** An *id* matches `^[a-z0-9][a-z0-9-]{0,63}$`. A *date* is `YYYY-MM-DD`. A *time* is 24-hour `HH:MM`. *Markdown* is described in section 4.

**Uniqueness.** Ids MUST be unique within their own list. Task ids MUST be unique across the whole `path`. Every `see` MUST name an existing section id.

## 3. Objects

**Stage** (`path[]`): `id`, `title`, `tasks` (at least one) are required. Optional `summary` and `tip` (`text` required, optional `title`).

**Task** (`path[].tasks[]`): `id`, `text` required. Optional `detail`.

**Recurring duty** (`recurring[]`): `id`, `text`, `every` required. Optional `time`, `start`, `end`, `detail`, `see`, plus the schedule fields below.

**Question** (`questions[]`): `q` (the question, plain text) and `a` (the answer, markdown) required. Optional `id`, `tag` (a short category label) and `see`.

**Section** (`sections[]`): `id`, `title`, `body` required.

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

Tools SHOULD make gaps easy to see and count them, so the author knows what's left.

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

Sharing a handover with someone new SHOULD leave `progress` out.

## 7. Extensions

Any object MAY carry extra fields whose names start with `x-`, for example `"x-owner": "finance"` on a recurring duty. Tools MUST ignore `x-` fields they don't understand and SHOULD keep them when they rewrite a file. Use a prefix that names your tool, e.g. `x-acme-priority`, to avoid clashes.

## 8. Versions

`handover` is `"<major>.<minor>"`. A minor version only adds optional fields. A tool that reads 1.0 SHOULD open any 1.x file, ignoring fields it doesn't know. A new major version means a breaking change, and a tool SHOULD refuse a major version it doesn't support, saying why.
