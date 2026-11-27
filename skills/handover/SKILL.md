---
name: handover
description: Create, convert, check, edit and merge role handover files (.handover, the open Handover format 1.x, plain JSON). Use when someone is leaving or changing a role and wants to hand it over, asks for a handover document, onboarding plan, "what I do every week" list, role runbook or knowledge transfer, wants to turn existing notes, docs or an SOP into a .handover file, or has a .handover or handover JSON file to validate, fill gaps in, update, preview the schedule of, strip of progress before sharing, or merge progress from. The files open in the free Handover Mac app as a guided first month, a daily dashboard of what's due and a searchable reference.
---

# Handover files

A `.handover` file is UTF-8 JSON describing how to take over a role: a first-month **path** of stages and tasks, **recurring** duties on a schedule, common **questions** with short answers, and reference **sections**. It is an open format: spec in `references/SPEC.md`, JSON Schema in `references/schema.json`, a complete example in `references/sample.handover`. The Handover app (https://incrhst.github.io/handover/) opens these files; any other tool can read them too.

## Rules that always apply

1. **No secrets, ever.** Never write passwords, PINs, API keys, tokens, card or bank numbers, or personal health or financial details into a handover file, even if the user pastes them. Write where the secret is kept ("in the shared password manager, Finance folder"). If you drop something for this reason, tell the user.
2. **Never guess.** Information you don't have becomes a gap: text starting `TODO:` (to the end of that line or table cell) or `{TODO: what's missing}` inside a sentence. The app counts gaps and shows them in yellow, so the author can fill them.
3. **Validate before you hand the file back.** Run `node scripts/handover.cjs check <file>` (paths are relative to this skill's folder). Fix every error it reports, then run it again.
4. **Keep `id` stable.** When updating an existing handover, never change its top-level `id` or the ids of tasks and recurring duties that still exist: the reader's progress is keyed on them.

## Format essentials (version 1.0)

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
  - Optional `time`, `start`, `end` (inclusive dates), `detail`, `see` (a section id).
  - A rule the format can't express ("the Friday before the 25th if it's a weekend") goes in `detail`; pick the nearest schedule for `every`.
- **Question**: `q`, `a` required; optional `id`, `tag` (short category such as "Money" or "If this happens"), `see`.
- **Section**: `id`, `title`, `body` required. One topic each: systems and access, people, money, suppliers, decision log, "if this happens", glossary.
- **Extensions**: any field starting `x-` is allowed anywhere and must be preserved when you rewrite a file. Any other unknown field is an error in 1.0.
- **Markdown in text fields**: `#`–`###` headings, paragraphs, `-` and `1.` lists, tables with a `|---|` line under the header, `**bold**`, `*italic*`, `` `code` ``, links `[text](https://…)` or `[text](#section-id)`, `> ` note, `!> ` warning. No raw HTML.
- **Progress** (optional, one reader's): `firstSeen`, `tasks` {task id: when}, `recurring` {"id@YYYY-MM-DD": when}, `notes`, `updated`. Leave it out when sharing with someone new.

Read `references/SPEC.md` when you need the exact rules, such as overdue logic or versioning.

## Tasks

### Create a handover by interviewing the outgoing person

Follow `references/interview-prompt.md`: ask one question at a time, cover systems and access, people, every recurring duty with its exact day, money and approvals, what goes wrong, decisions and why, and a four-stage first month. Then write the file, check it, and give the user the `.handover` file. Suggest the file name `<id>.handover`.

### Convert existing material

When the user gives notes, a document, an SOP, a wiki export or an old handover page:

1. Map it: each "every Monday / monthly / by the 7th" sentence becomes a `recurring` duty; onboarding steps become `path` tasks; FAQs become `questions`; everything else becomes `sections`, one topic each, with tables kept as tables.
2. Use the source's own wording and facts. Anything ambiguous or missing becomes a `TODO:` gap, not an invention.
3. Strip secrets (rule 1).
4. Check, then list the gaps for the user: `node scripts/handover.cjs gaps <file>`.

### Check, review or fill gaps

- `node scripts/handover.cjs check <file>`: errors with exact paths, such as `recurring[3].day: must be 1 to 31, or "last"`.
- `node scripts/handover.cjs gaps <file>`: every gap and where it is. To fill them, ask the user about each gap in turn and replace the marker with the answer.
- `node scripts/handover.cjs summary <file>`: counts, useful for a quick review. A good handover usually has 3–5 stages, every duty the role really has, 8–12 questions and a section per topic.

### Preview the schedule

`node scripts/handover.cjs due <file> [YYYY-MM-DD] [--days N]` shows what is overdue, due that day and coming up, worked out in the file's timezone exactly as the app does. Use it to confirm that schedules mean what the user intended ("payroll on the 25th" should show on the 25th).

### Update a handover

Edit the JSON in place: keep ids (rule 4), keep `x-` fields, set `updated` to today, then check. Removing a task or duty is fine; its old progress is ignored.

### Share or move progress

- For someone new: `node scripts/handover.cjs strip <file> <out>` removes `progress`.
- To combine a reader's exported progress with a newer version of the content: `node scripts/handover.cjs merge <new-content> <with-progress> <out>`. It keeps every completion from both, the earlier `firstSeen`, and the existing notes unless they are empty. Both files must have the same `id`.

## Building other tools on the format

`scripts/core.js` is the reference implementation, with no dependencies: `validate(h)` returns `{errors, warnings}`; `schedule(h, progress, today)` returns `{overdue, due, next, later}`; plus `occursOn(duty, date)`, `mergeProgress(state, progress)` and `contentOnly(h)`. It runs in Node (`require`) and in browsers (`window.HandoverCore`). Readers of 1.0 should open any 1.x file and ignore unknown fields, and refuse a different major version.
