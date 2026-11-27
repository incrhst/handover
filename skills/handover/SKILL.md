---
name: handover
description: Create, convert, check, edit and merge role handover files (.handover, the open Handover format 1.x, plain JSON), and write job descriptions from them. Use when someone is leaving or changing a role and wants to hand it over, asks for a handover document, onboarding plan, "what I do every week" list, role runbook or knowledge transfer, wants to turn notes, docs or an SOP into a .handover file, has a .handover file to validate, fill gaps in, update, preview the schedule of, export or merge, or wants a job description or role profile for a role with a handover. Format 1.1 carries the full record of an assistant handover (people, plan and asks, gaps, rules, decisions, risks, systems, documents, who decides what, sign-off); 1.2 adds the role, areas of work and jobs done as needed. The files open in the free Handover Mac app as a guided first month, a daily dashboard of what's due and a searchable reference.
---

# Handover files

A `.handover` file is UTF-8 JSON describing how to take over a role: a first-month **path** of stages and tasks, **recurring** duties on a schedule, common **questions** with short answers, and reference **sections**. It is an open format: spec in `references/SPEC.md`, JSON Schema in `references/schema.json`, the reference example, an executive assistant handover with no overlap that uses all of 1.1, in `references/ea-no-overlap.handover`, and a simpler 1.0 example in `references/sample.handover`. The Handover app (https://incrhst.github.io/handover/) opens these files; any other tool can read them too.

## Rules that always apply

1. **No secrets, ever.** Never write passwords, PINs, API keys, tokens, card or bank numbers, or personal health or financial details into any field of a handover file, even if the user pastes them. Systems record where a credential is kept (`credentialLocation`: "in the shared password manager, Finance folder") and who grants access (`grantedBy`), never the credential. A `limit` is a business limit, never a balance. If you drop something for this reason, tell the user.
2. **Never guess.** Information you don't have becomes a gap: text starting `TODO:` (to the end of that line or table cell) or `{TODO: what's missing}` inside a sentence. The app counts gaps and shows them in yellow, so the author can fill them.
3. **Validate before you hand the file back.** Run `node scripts/handover.cjs check <file>` (paths are relative to this skill's folder). Fix every error it reports, then run it again.
4. **Keep `id` stable.** When updating an existing handover, never change its top-level `id` or the ids of tasks, recurring duties or 1.1 items that still exist: progress and references are keyed on them.
5. **Store facts, not derived values.** Never write step dates, gate status, overlap, the ask minute budget or at-risk flags: tools work them out (SPEC section 15).

## Format essentials (1.0, still valid in 1.1)

Top level: `handover` ("1.0", required), `id` (required), `title` (required), and optionally `$schema` ("https://incrhst.github.io/handover/schema/v1.json"), `summary`, `from` {`name`, `role`, `contact`, `availableUntil`}, `updated`, `timezone` (IANA, e.g. "America/Jamaica"), `settings` {`dailyExportTime`}, `path`, `recurring`, `questions`, `sections`, `progress`.

- **Ids**: `^[a-z0-9][a-z0-9-]{0,63}$`. Unique within each list; task ids unique across the whole path. Dates `YYYY-MM-DD`, times `HH:MM` (24-hour).
- **Stage** (`path[]`): `id`, `title`, `tasks` (at least one) required; optional `summary`, `tip` {`title`, `text`}. Aim for about four stages, e.g. "Week 1 · Get in", "Week 2 · Shadow", "Weeks 3–4 · Lead", "It's yours".
- **Task**: `id`, `text` required; optional `detail`. Start the text with a bold verb phrase: `**Get access to every system** in [Systems](#systems).`
- **Recurring duty**: `id`, `text`, `every` required. `every` is one of:
  - `day`; `weekday` (Mon–Fri)
  - `week` with `on`: `"mon"`…`"sun"` or a list (default `"mon"`)
  - `month` with `day`: 1–31 or `"last"` (default 1; past a short month's end it falls on the last day)
  - `quarter` with `day` and `monthOfQuarter` 1–3 (1 = Jan/Apr/Jul/Oct, 2 = Feb/May/Aug/Nov, 3 = Mar/Jun/Sep/Dec)
  - `year` with `date`: `"MM-DD"` (required)
  - Optional `time`, `start`, `end` (inclusive dates), `detail`, `see` (a section id), and since 1.2 `area`.
  - A rule the format can't express ("the Friday before the 25th if it's a weekend") goes in `detail`; pick the nearest schedule for `every`.
- **Question**: `q`, `a` required; optional `id`, `tag` (short category such as "Money" or "If this happens"), `see`.
- **Section**: `id`, `title`, `body` required. One topic each: systems and access, people, money, suppliers, decision log, "if this happens", glossary.
- **Extensions**: any field starting `x-` is allowed anywhere and must be preserved when you rewrite a file. Any other unknown field is an error for the version the file declares, and a warning for a newer 1.x.
- **Markdown in text fields**: `#`–`###` headings, paragraphs, `-` and `1.` lists, tables with a `|---|` line under the header, `**bold**`, `*italic*`, `` `code` ``, links `[text](https://…)` or `[text](#section-id)`, `> ` note, `!> ` warning. No raw HTML.
- **Progress** (optional, one reader's): `firstSeen`, `tasks` {task id: when}, `recurring` {"id@YYYY-MM-DD": when}, `notes`, `updated`. Leave it out when sharing with someone new.

## What 1.1 adds

Set `"handover": "1.1"` to use any of these (all optional). `references/ea-no-overlap.handover` uses every one; copy its shapes.

- **People**: `people[]` {`id`, `name`, `roles`} with roles `outgoing`, `incoming`, `principal`, `owner`, `facilitator` (each held by one person); `stakeholders[]` {`id`, `name`, `relationship`, `involve`, `contact`, `contactVisibleTo`}. `from` gains `hours` and `paid`.
- **Process**: `plan` {`prepStart`, `lastDay`, `firstDay`, `track` light|full, `practice`, `template`, `steps[]`}; steps have `id`, `role`, `phase`, `title`, `status` open|done|na (na needs `reason`) and optional `gate` ready|done|sign. `asks[]` are the seven questions to the principal: `breaks`, `profile`, `access`, `limits`, `confid`, `emergency`, `signoff`.
- **Records**, each a list of items with `id` plus optional `added`, `addedBy`, `aiDrafted`, `visibleTo`, `closed` {`how`, `at`, `by`, `fix`}: `gaps` (`blocks`), `inProgress` (`owner`, `due`), `rules` (`situation`), `decisions` (`reason`, `date`), `risks` (`list` weekly|occasional|spof, `severity`, `treatment`, `evidence`, `recurring`), `systems` (`credentialLocation`, `grantedBy`, `checks`), `documents` (`url` or `location`, `type`, `status`).
- **A risk on an exact day** is a `recurring` duty with the schedule plus a risk that names it in `recurring`. Don't put the schedule in the risk.
- **Who decides**: `decide` {`confirmed`, `cards[]`}; a card has `column` alone|check|principal, optional `limit` {`amount`, `currency`} and `approver` {`role`} or {`stakeholder`}.
- **Finishing**: `finalCheck[]` (seven fixed ids; a `fail` needs `owner` and `due`), `signoff` (who signed, `frozen`, later `notes`), `followUps`, `catchUps`, `history`.
- **Sharing**: `audience` (roles the file is for) and `profile` (`newcomer` or `record`). An item with `visibleTo` must only appear in a file whose whole audience is in it; a file without `audience` must have no `visibleTo` at all.
- **For 1.0 readers**: `rendered` lists the `sections` generated from the structured data. Regenerate them with `render`; never edit them by hand.

`check` enforces uniqueness in every list and that every reference resolves (`step.ask`, `risk.recurring`, `approver.stakeholder`, `rendered`).

## What 1.2 adds

Set `"handover": "1.2"` to use any of these (all optional). The tools raise the version for you when they add one.

- **`role`**: `organisation`, `purpose` (markdown, two or three sentences), `location`, `hours` (the working pattern, not `from.hours`), `travel`, `manages`, `skills` (markdown, usually a list) and `measures` (markdown: what good looks like). Never pay, benefits or other personal financial details. Who the role reports to is the `principal` in `people`.
- **`area`** on every `recurring` duty and `asNeeded` job: the part of the role it belongs to ("Finance", "Office and staff", one property or business). `"Olive Branch Villa / Bookings"` (a slash with a space each side) puts Bookings under Olive Branch Villa. Spell each area the same way every time.
- **`asNeeded[]`**: jobs with no schedule: `id`, `text` (one line) required; optional `area`, `when` ("When a new member of staff joins"; absent means "as needed"), `detail`, `see`. They never appear on the daily list. A job with a date, even a rough one, stays in `recurring` with the rule in `detail`.

Read `references/SPEC.md` when you need the exact rules, such as overdue logic, visibility or versioning.

## Tasks

### Create a handover by interviewing the outgoing person

Follow `references/interview-prompt.md`: ask one question at a time, cover people and stakeholders, systems and who grants access, every recurring duty with its exact day, money and approvals (limits and approvers), what goes wrong, rules and decisions, work in progress, and a four-stage first month. Then write the file, check it, and give the user the `.handover` file. Suggest the file name `<id>.handover`.

### Convert existing material

When the user gives notes, a document, an SOP, a wiki export or an old handover page:

1. Map it: each "every Monday / monthly / by the 7th" sentence becomes a `recurring` duty; onboarding steps become `path` tasks; FAQs become `questions`; everything else becomes `sections`, one topic each, with tables kept as tables.
2. Use the source's own wording and facts. Anything ambiguous or missing becomes a `TODO:` gap, not an invention.
3. Strip secrets (rule 1).
4. Check, then list the gaps for the user: `node scripts/handover.cjs gaps <file>`.

### Prepare a handover for a job description, and write it

A job description is written from the file, so the file has to hold what a job description says. To get it there:

1. **Areas.** Propose a short list of areas from the duties already in the file (by business, property or kind of work, as the role is organised), confirm it with the user, then give every `recurring` and `asNeeded` job an `area`.
2. **Jobs done as needed.** Ask what the role does that has no schedule ("anything you do when it comes up?"), and add each one to `asNeeded` with what calls for it in `when`. Look through `sections`, `rules` and `questions` for work that is described but not listed.
3. **The role.** Ask for the facts: the organisation's name as it should appear, where and when the work is done, how much travel, and who the role manages. A fact you don't have becomes a `TODO:` gap; never guess it. Don't ask about pay, and leave it out if the user gives it.
4. **Purpose, skills and measures.** You may draft `purpose`, `skills` and `measures` from the duties, limits and systems in the file. Show your draft to the user and write it only once they have confirmed or corrected it.
5. Check the file, then write the job description: `node scripts/handover.cjs report <file> job-description.pdf` (or `.docx`, `.md`, `.html`; `--kind jd` is the default). It groups the jobs by area (by how often they happen if there are no areas) and adds the authority and limits, what to do when things come up, working relationships, systems, skills and measures. It leaves out every item with `visibleTo`, every contact and closed items, because a job description goes beyond the handover. Gaps in a job's details are left out too; fill them first with `gaps`.

The other reports for the principal work the same way: `--kind working` (what's under way), `jobs` (the assistant's jobs) or `needs` (what needs the principal).

### Check, review or fill gaps

- `node scripts/handover.cjs check <file>`: errors with exact paths, such as `recurring[3].day: must be 1 to 31, or "last"`, then the gap counts: `TODO` markers by area and, for 1.1, open and blocking items on the `gaps` list.
- `node scripts/handover.cjs gaps <file>`: every `TODO` gap and where it is, then the open items on the `gaps` list. To fill them, ask the user about each gap in turn and replace the marker with the answer.
- `node scripts/handover.cjs summary <file>`: counts, useful for a quick review. A good handover usually has 3–5 stages, every duty the role really has, 8–12 questions and a section per topic.

### Preview the schedule

`node scripts/handover.cjs due <file> [YYYY-MM-DD] [--days N]` shows what is overdue, due that day and coming up, worked out in the file's timezone exactly as the app does. Use it to confirm that schedules mean what the user intended ("payroll on the 25th" should show on the 25th).

### Update a handover

Edit the JSON in place: keep ids (rule 4), keep `x-` fields, set `updated` to today, then check. Removing a task or duty is fine; its old progress is ignored. If the file has `rendered`, run `node scripts/handover.cjs render <file> <file>` after editing 1.1 data so the sections for 1.0 readers match.

### Share or move progress

- For someone new: `node scripts/handover.cjs strip <file> <out>` (profile `newcomer`) removes `progress`, process state (plan, asks, final check, sign-off, history), closed items, item metadata and anything the audience may not see, then renders the sections again. Use `--audience incoming,principal` to export for other roles.
- A full record (for a backup or another tool): `node scripts/handover.cjs strip <file> <out> --profile record --audience outgoing,owner`.
- To combine a reader's exported progress with a newer version of the content: `node scripts/handover.cjs merge <new-content> <with-progress> <out>`. It keeps every completion from both, the earlier `firstSeen`, and the existing notes unless they are empty. Both files must have the same `id`.

### Transition kit: the whole handover as one HTML file

For someone who has neither the app nor an agent: `node scripts/handover.cjs kit <file> <out.html> [--profile newcomer|record] [--audience role,role]`. It writes one self-contained `.html` file that opens in any browser from disk, with no app, server or internet: the first weeks with ticks, Today and the regular jobs, the records, who decides what, people, questions, the reference and search. It is the app's own viewer (`scripts/viewer.html`) with `core.js` and the handover inlined, in a read-only mode; ticks and notes stay in that browser, and its **Export with my progress** gives a file to `merge`. The newcomer profile is the default, and the kit holds exactly what `strip` with the same profile and audience would give: never anything the audience may not see. A strict content security policy stops it loading or sending anything. Rule 1 still applies: the kit carries only what the file holds, so a secret must never be in the file in the first place. In code: `transitionKit(h, {profile, audience, viewer, date})` returns the HTML, and `readKit(html)` gives back `{kit, made, profile, handover}`.

### Export items as a document

For someone who will never open the app, such as the principal: `node scripts/handover.cjs export <file> <out.pdf|out.docx|out.xlsx|out.md> --items jobs,tasks [--title "…"]`. The format follows the output file's extension. Item kinds, so a document can hold just the parts to share: `overview` (summary, dates and contact after the handover), `people` (who's who), `jobs` (recurring duties, by how often), `tasks` (first-weeks path), `stakeholders`, `decide`, `systems`, `documents`, `rules`, `decisions`, `risks`, `inProgress`, `gaps`, `sections` (the reference pages, with their headings, lists, notes and tables), `questions`, `steps` (handover plan), `asks` (questions for the principal and their answers), `finalCheck` and `signoff`. Closed items and anything only some people may see are left out. Excel gets one sheet per kind, with columns to sort and filter.

## Building other tools on the format

`scripts/core.js` is the reference implementation, with no dependencies: `validate(h)` returns `{errors, warnings}`; `schedule(h, progress, today)` returns `{overdue, due, next, later}`; plus `occursOn(duty, date)`, `mergeProgress(state, progress)` and `contentOnly(h)`. To combine two copies of the same handover that were changed apart (say, in a shared folder): `mergeHandover(base, mine, theirs)` returns `{h, conflicts, renamed}`. `base` is the copy both started from, or `null` if unknown (then nothing counts as removed). It matches list items by id, keeps a change made on one side only, keeps `mine` where both changed the same field (listing it in `conflicts`), gives `mine` a new id when both added different items under one id (listed in `renamed`), keeps the change log in time order and writes the 1.0 sections again. For 1.1: `findGaps`, `gapCounts`, `overlap`, `phases`, `gates`, `askMinutes`, `canSee`, `exportProfile(h, profile, audience)`, `renderSections` and `withRendered`; for documents, `exportKinds`, `itemsDocument`, `docPdf`, `docDocx`, `docXlsx`, `docMarkdown` and `parseBlocks`; and `transitionKit` and `readKit` for the one-file HTML kit. To fill `TODO` gaps: `gapList(h)` gives each gap with a `key`, and `fillGaps(h, {key: text}, {date})` returns the filled copy. It rejects text that `secretReason(text)` flags as a password, PIN, code, key or card or bank number, adds a `history` entry with `source: "app"` for 1.1 files, and writes the 1.0 sections again. To close a record: `closeItem(h, list, id, {how, by, fix, date})` and `reopenItem(h, list, id, {date})`, where `list` is a record list or `decide`; `closeHow[list]` gives the allowed `how` values (gaps: `fixed`, `answered`, `principal`; inProgress: `done`, `dropped`; risks: `fixed`, `dropped`; the rest: `dropped`). To add a record: `addItem(h, list, values, {role, date})` returns `{h, id}`; `addFields[list]` lists the fields each list takes, and every text value goes through the same secrets check (a system gets where its credential is kept and who grants access, never the credential). To correct an item: `editItem(h, list, id, values, {role, date})` returns `{h, changed}`, where `list` is a record list, `decide`, `path` (first-weeks tasks), `recurring` (regular jobs, including their `area`) or `asNeeded` (jobs done as needed); start from `editValues(h, list, id)` and change what is wrong, and `editFields(list)` lists the fields. `addItem(h, "asNeeded", values, {role, date})` adds a job done as needed (any version; the file becomes 1.2), and `deleteItem(h, "asNeeded", id, {role, date})` removes one and logs it; records are closed, never deleted. To change the role: `editRole(h, values, {role, date})` returns `{h, changed}`; start from `roleValues(h)`, and `roleFields` lists the fields. It keeps `x-` fields, removes the role when every field is empty, and refuses pay. It keeps the id (so progress stays), `added`, `addedBy`, `closed` and fields it doesn't show, clears `aiDrafted` on records, runs the same secrets check, refuses an edit that changes nothing, and logs `Edited … in the app: <fields>` for 1.1 files. Any change that adds a 1.2 field raises `handover` to `"1.2"`; `usesMinor(h)` gives the lowest minor version a file needs. For the principal: `principalReport(h, key, {date, since})` with `key` one of `working`, `jobs`, `needs` or `jd` (see `reports`) returns a document for `docPdf`, `docDocx` or `docMarkdown`; it opens with a plain summary drawn only from facts in the file and leaves out items the principal may not see. `principalReports(h, keys, {date, since, title})` puts several in one document (the title defaults to `reportTitle(h, date)`, which says where the handover is: "Handover update: 3 weeks to Priya's last day", "Priya's last week", "Marcus's week 8", or the ISO week when the file has no last day): an "In this report" overview, then each report as a part in `chapters`, unchanged, with section numbers running through; with one key it returns that report as it is. The CLI takes `report <file> --kind working,jobs,needs --title …`. `jd` is a job description: it leaves out every item with `visibleTo`, contacts and closed items, and groups jobs with `areaParts(area)`. It runs in Node (`require`) and in browsers (`window.HandoverCore`). Readers should open any 1.x file, treat unknown fields in a newer minor version as warnings, and refuse a different major version.
