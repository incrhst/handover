You are helping me write a handover file, so someone new can take over my role. The file will be opened in the Handover app, which turns it into a guided first month, a daily list of what's due and a reference the new person can search.

How to work:

1. Interview me. Ask one question at a time and wait for my answer. Start with my name, my role, who is taking over, my last day, their first day and until when (and at what hours) I can answer questions. Then cover, in this order:
   - **People**: who the role works for, and the people the new person must know. For each: who they are, when to involve them and how to reach them. Ask whether any of them, or any contact detail, should only be seen by some of us.
   - **Systems**: each system I use, what it is for, where the login is kept (never the login itself) and who grants access.
   - **Exact days**: what I do every day, week, month, quarter and year. For each, pin down the exact day and time ("every Thursday by 11:00", "the 7th of the second month of each quarter"). "Weekly" or "around month end" is not enough.
   - **Money and approvals**: what I decide alone, what I check first, and what always goes to the person I work for. For each: the spending limit and currency, if there is one, and who approves above it. Who signs off what.
   - **What goes wrong**: what has gone wrong before or would hurt most if missed, how often, and whether only I know how to do it.
   - **Rules and decisions**: "if X happens, do Y", and decisions already made and why.
   - **In progress**: work that is not finished, who will own it and when it is due.
   - **First four weeks**: what the new person should do, in order.
2. Keep going until you have enough for every part of the file below. If I don't know something, mark it as a gap rather than guessing.
3. Then write the whole file as one JSON code block, and nothing else after it except anything I asked you to keep out of it. I'll save it as `role.handover`.

Rules for the file:

- Never include passwords, PINs, API keys, card or bank numbers, or anyone's personal health or financial details, in any field. Say where a secret is kept, never what it is. If I paste one, leave it out and tell me.
- Mark anything still unknown as a gap: start the text with `TODO:` or put `{TODO: what's missing}` inside a sentence.
- Text fields can use simple Markdown: `**bold**`, lists, tables with a `|---|` line under the header, `> ` for a note, `!> ` for a warning, and `[text](#section-id)` to link to a section.
- Ids are lowercase letters, digits and dashes, like `payroll` or `week-1`. Task ids must be unique across the whole path, and ids must be unique within each list. Every reference (`see`, `recurring`, `approver`) must point at an id that exists.
- Put what you learn in the lists, not in prose: people in `stakeholders`, logins in `systems`, limits and approvers in `decide`, what goes wrong in `risks`, unanswered questions in `gaps`. A risk that happens on an exact day gets a `recurring` duty with that schedule, and the risk names it in `recurring`.
- Write `sections` only for topics the lists don't cover. Don't write `rendered`: the Handover tools add the summary sections for older readers.
- Mark everything you wrote yourself with `"aiDrafted": true` on items in the lists, so we review it.

The format (version 1.1, full spec at https://incrhst.github.io/handover/):

```json
{
  "$schema": "https://incrhst.github.io/handover/schema/v1.json",
  "handover": "1.1",
  "id": "short-id-for-this-role",
  "title": "What this handover is for",
  "summary": "Two or three sentences: what the role is and how to use this handover.",
  "from": { "name": "Outgoing person", "role": "Their role", "contact": "How to reach them", "availableUntil": "2026-12-31", "hours": "Weekdays 10:00 to 12:00" },
  "updated": "2026-11-26",
  "timezone": "Europe/London",
  "people": [
    { "id": "sam", "name": "Outgoing person", "roles": ["outgoing"] },
    { "id": "alex", "name": "Incoming person", "roles": ["incoming"] },
    { "id": "jo", "name": "Who the role works for", "roles": ["principal"] }
  ],
  "stakeholders": [
    { "id": "cfo", "name": "Name", "relationship": "Chief financial officer", "involve": "Approves spend above the limits.", "contact": "Ext. 2210", "aiDrafted": true }
  ],
  "path": [
    {
      "id": "week-1",
      "title": "Week 1 · Get in",
      "summary": "What this stage is about.",
      "tip": { "title": "Why it matters", "text": "One helpful line." },
      "tasks": [ { "id": "access", "text": "**Get access** to every system on the systems list.", "detail": "Optional extra detail." } ]
    }
  ],
  "recurring": [
    { "id": "inbox", "text": "Clear the shared inbox", "every": "weekday", "time": "09:30" },
    { "id": "expenses", "text": "Submit expense claims", "every": "week", "on": "thu", "time": "11:00" },
    { "id": "payroll", "text": "Run payroll", "every": "month", "day": 25 },
    { "id": "reconcile", "text": "Reconcile the bank account", "every": "month", "day": "last" },
    { "id": "vat", "text": "File the VAT return", "every": "quarter", "day": 7, "monthOfQuarter": 2 },
    { "id": "insurance", "text": "Renew the insurance", "every": "year", "date": "03-01" }
  ],
  "questions": [
    { "q": "A question the new person will ask", "a": "A short answer.", "tag": "Money" }
  ],
  "systems": [
    { "id": "bank", "name": "Online banking", "purpose": "Payments", "credentialLocation": "Company password manager, Finance vault", "grantedBy": "Finance director", "aiDrafted": true }
  ],
  "decide": {
    "cards": [
      { "id": "travel", "text": "Book travel and hotels", "column": "alone", "limit": { "amount": 2000, "currency": "USD" } },
      { "id": "big-spend", "text": "Spend above USD 2,000", "column": "check", "approver": { "stakeholder": "cfo" } },
      { "id": "budget", "text": "Sign off the yearly budget", "column": "principal" }
    ]
  },
  "risks": [
    { "id": "late-expenses", "text": "Expense claims miss Finance's Thursday cut-off", "list": "weekly", "severity": "high", "treatment": "write", "recurring": "expenses", "aiDrafted": true }
  ],
  "rules": [ { "id": "chair-calls", "text": "If the chair calls, put them straight through." } ],
  "decisions": [ { "id": "no-friday-pm", "text": "No meetings on Friday afternoons", "reason": "Planning time." } ],
  "inProgress": [ { "id": "offsite", "text": "Book the offsite venue", "owner": "incoming", "due": "2026-12-04" } ],
  "gaps": [ { "id": "paper-copies", "text": "Who gets the board pack on paper?", "blocks": false } ],
  "sections": [
    { "id": "how-we-work", "title": "How we work", "body": "Anything the lists above don't cover." }
  ]
}
```

Lists: `column` is `alone`, `check` or `principal`; an `approver` is `{"stakeholder": "<id>"}` or `{"role": "principal"}`. A risk's `list` is `weekly`, `occasional` or `spof` (only I know it), `severity` is `high`, `medium` or `low`, and `treatment` is `record`, `write` or `brief`. Roles are `outgoing`, `incoming`, `principal`, `owner` and `facilitator`. This file is for the person taking over: if I say something should only be seen by some of us, leave it out and list it for me after the file.

Schedules: `every` is `day`, `weekday`, `week` (with `on`: a day or list of days, `mon` to `sun`), `month` (with `day`: 1 to 31 or `"last"`), `quarter` (with `day` and `monthOfQuarter`: 1 = Jan/Apr/Jul/Oct, 2 = Feb/May/Aug/Nov, 3 = Mar/Jun/Sep/Dec) or `year` (with `date`: `"MM-DD"`). Optional `time` (`"HH:MM"`), `start` and `end` dates, `detail` and `see` (a section id).

Aim for four stages in `path`, every recurring duty I mention with its exact day, eight to twelve questions, every person, system and limit I mention, and a gap for everything I couldn't answer. Every `see` must match a section id.

Start now with your first question.
