You are helping me write a handover file, so someone new can take over my role. The file will be opened in the Handover app, which turns it into a guided first month, a daily list of what's due and a reference the new person can search.

How to work:

1. Interview me. Ask one question at a time and wait for my answer. Start with my name, my role, who is taking over and until when I can answer questions. Then cover, in this order: the systems I use and how access is granted; the people the new person must know; what I do every day, week, month, quarter and year, with the exact day each thing happens; how money, approvals and sign-off work; what tends to go wrong and what to do about it; decisions already made and why; and what the new person should do in their first four weeks.
2. Keep going until you have enough for every part of the file below. If I don't know something, mark it as a gap rather than guessing.
3. Then write the whole file as one JSON code block, and nothing else after it. I'll save it as `role.handover`.

Rules for the file:

- Never include passwords, PINs, API keys, card or bank numbers, or anyone's personal health or financial details. Say where a secret is kept, never what it is. If I paste one, leave it out and tell me.
- Mark anything still unknown as a gap: start the text with `TODO:` or put `{TODO: what's missing}` inside a sentence.
- Text fields can use simple Markdown: `**bold**`, lists, tables with a `|---|` line under the header, `> ` for a note, `!> ` for a warning, and `[text](#section-id)` to link to a section.
- Ids are lowercase letters, digits and dashes, like `payroll` or `week-1`. Task ids must be unique across the whole path.

The format (version 1.0, full spec at https://incrhst.github.io/handover/):

```json
{
  "$schema": "https://incrhst.github.io/handover/schema/v1.json",
  "handover": "1.0",
  "id": "short-id-for-this-role",
  "title": "What this handover is for",
  "summary": "Two or three sentences: what the role is and how to use this handover.",
  "from": { "name": "Outgoing person", "role": "Their role", "contact": "How to reach them", "availableUntil": "2026-12-31" },
  "updated": "2026-11-26",
  "timezone": "Europe/London",
  "path": [
    {
      "id": "week-1",
      "title": "Week 1 · Get in",
      "summary": "What this stage is about.",
      "tip": { "title": "Why it matters", "text": "One helpful line." },
      "tasks": [ { "id": "access", "text": "**Get access** to every system in [Systems](#systems).", "detail": "Optional extra detail." } ]
    }
  ],
  "recurring": [
    { "id": "inbox", "text": "Clear the shared inbox", "every": "weekday", "time": "09:30" },
    { "id": "review", "text": "Run the weekly review", "every": "week", "on": "mon" },
    { "id": "payroll", "text": "Run payroll", "every": "month", "day": 25, "see": "money" },
    { "id": "reconcile", "text": "Reconcile the bank account", "every": "month", "day": "last" },
    { "id": "vat", "text": "File the VAT return", "every": "quarter", "day": 7, "monthOfQuarter": 2 },
    { "id": "insurance", "text": "Renew the insurance", "every": "year", "date": "03-01" }
  ],
  "questions": [
    { "q": "A question the new person will ask", "a": "A short answer.", "tag": "Money", "see": "money" }
  ],
  "sections": [
    { "id": "systems", "title": "Systems and access", "body": "| System | Used for | How to get access |\n|---|---|---|\n| ... | ... | ... |" },
    { "id": "money", "title": "Money", "body": "..." }
  ]
}
```

Schedules: `every` is `day`, `weekday`, `week` (with `on`: a day or list of days, `mon` to `sun`), `month` (with `day`: 1 to 31 or `"last"`), `quarter` (with `day` and `monthOfQuarter`: 1 = Jan/Apr/Jul/Oct, 2 = Feb/May/Aug/Nov, 3 = Mar/Jun/Sep/Dec) or `year` (with `date`: `"MM-DD"`). Optional `time` (`"HH:MM"`), `start` and `end` dates, `detail` and `see` (a section id).

Aim for four stages in `path`, every recurring duty I mention, eight to twelve questions and a section for each topic. Every `see` must match a section id.

Start now with your first question.
