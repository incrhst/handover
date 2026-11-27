# Handover

Take over a role, one step at a time. **Handover** is a free Mac app that turns one file into a guided first month, a daily list of what's due and a reference you can search. The file is an open format that you can write with any AI chat. Two people can work on the same handover through a shared iCloud Drive, Google Drive or Dropbox folder.

**[Download for Mac](https://github.com/incrhst/handover/releases/latest/download/Handover.dmg)** · [Website](https://incrhst.github.io/handover/) · [The format](spec/SPEC.md)

## How it works

1. Download `Handover.dmg` and drag Handover to Applications.
2. Copy [the AI prompt](site/prompt.md) into Claude, ChatGPT or Gemini. It interviews the outgoing person, one question at a time, then writes the handover file.
3. Save the answer as `role.handover` and open it in Handover.
4. Follow the first-month path, tick off today's duties and search when you need an answer.
   A job that takes time to do has a lead time: a vehicle's registration and fitness might need 90 days, its insurance 30. It shows under **Start now** that many days before its date, with the days left, and stays there until you tick it; **Next 7 days** and **Coming up** show the day it starts.
   A task or job can carry its guides: the step-by-step guide, SOP, template or recording for doing it, from the **Documents** list, or a section of the reference. They show as buttons on the task, and one click opens the guide in a panel over the list, with its link, where it's kept and whether the access check passed, so you never lose your place. Choose them with **Edit…** on the task or job (format 1.4).
   Reminders come as Mac notifications, even with the window closed. Each morning, at the time the daily sheet is written (7:00 unless the file sets another), one says what's to do that day: jobs due, overdue and under way, and work in progress that is due. A job with a time gets its own reminder at that time: click **Done** to tick it off, or **Remind Me in an Hour**. Turn either kind off in **Settings**. The first time there is something to remind you of, macOS asks whether Handover may send notifications.
   To see the jobs in your own calendar, use **Share & export › Add jobs to calendar (.ics)…**, or **Calendar** next to a job under **All jobs** for just that one. It saves a calendar file that Apple Calendar, Google Calendar and Outlook can import: each job is one event that repeats on its schedule, at its time in the handover's time zone or all day when it has no time, with an alert its lead time before. Ticks stay in the app, and the calendar doesn't change when the jobs do: save the file again after an edit (each job keeps the same ID, so many calendars update it rather than add a copy).
   To tick jobs off on your iPhone, turn on **Settings › Keep my jobs in Apple Reminders**. Each regular job shows in a Reminders list named after the handover, a week before it's due (or from the day its work has to start), with its date, time and details. Tick it in Reminders, on your iPhone or in the app: a tick in one place shows in the other, and once a job is ticked its next date appears. Changing a job in the app changes its reminder; changes you make to a reminder in Reminders are left alone. Only the handover that is open is kept up to date, and each person on a shared handover has their own list. The first time, macOS asks whether Handover may use Reminders.
   Anything the AI couldn't fill in shows as a gap. Click **N gaps to fill**, or any gap on the page, and type what's missing. The app saves it to the file and refuses passwords, PINs, codes and card or bank numbers.
   Work through **Needs attention** and the records: **Close…** marks an item fixed, done, handed to the principal or no longer needed, and **Reopen** undoes it. **Add…** records something new as you find it: a thing in progress, a gap, a rule, a decision, a risk, a system and who grants access to it, a document or a who-decides card (format 1.1 files). **Edit…** corrects anything that isn't accurate: a record, a task in the first weeks, or a job, including how often it happens, its area of work and its lead time (**All jobs** under Today lists every job, including the ones done as needed, where you can also add and delete them). The item keeps its place and its ticks, and the change goes in the change log. **About the role** holds what a job description is made from: the purpose, location, hours, travel, skills and what good looks like; **Edit…** there changes it. **Edit dates…** on the handover panel changes when preparation starts, the outgoing assistant's last day, the incoming assistant's first day and the track. Leave the first day empty while nobody is hired or the date isn't known: the handover then runs with no overlap until it is set.
   **Report for …** makes a short, plain report for the principal at any point: *What we're working on*, *The assistant's jobs*, *What needs you* or a *Job description*. Each opens with a summary worked out from the file, never claiming more than it shows, and leaves out anything the principal may not see. The job description groups the jobs by area of work and adds the authority and limits, working relationships, systems, and the skills and measures in the file; it leaves out anything marked for some people only, and every contact. Tick more than one to put them in one document: a short overview, then each report as its own part with its figures and summary, under a title that says where the handover is, such as *Handover update: 24 days to Priya's last day* or *Handover update: Marcus's week 8* (or one you type). Its cover counts the days to the outgoing assistant's last day, or the days since, next to the handover date. Preview it, then save it as PDF, Word or Markdown to send. Every report and exported document ends with a short note that it was made with Handover, a free Mac app by [Incrementic](https://incrementic.com), with links to the website and the download.
5. Share the file with the next person (**Share & export › Share handover file**), or export it with your progress to move it to another Mac or tool. To work on it together, share the data folder instead (see [Working on a handover together](#working-on-a-handover-together)).
6. For someone who won't use the app, such as the principal, use **Share & export › Export items as a document…**, or the **Export…** button on any panel: pick the parts to share (the overview, who's who, jobs, tasks, records, reference sections, the handover plan, sign-off and more, down to single items) and save them as PDF, Word or Excel.
7. To hand over without the app, use **Share & export › Transition kit (HTML)…**. It saves the whole handover as one `.html` file that opens in any browser, offline, with nothing to install: the first weeks with ticks, Today and the regular jobs, the records, who decides what, people, questions, the reference and search. It's a read-only copy: ticks and notes stay in that browser, and **Export with my progress** inside the kit carries them into the app later. Choose the **Newcomer copy** (the default: the knowledge only, nothing marked for some people only, no process state or closed items) or the **Full record** for the people running the handover. The kit holds only what the file holds, never a password or key, and makes no requests to the internet.

The app keeps its files in `~/Documents/Handover` (you can choose another folder, such as one in iCloud Drive, Google Drive or Dropbox):

| Folder | What's in it |
|---|---|
| `handovers/` | Each handover you've opened |
| `progress/` | Ticks, notes and start date, per handover and per person (`<handover>.<your Mac account name>.json`) |
| `daily/` | The task sheet, written each morning at 07:00 while the app is running |
| `backups/` | A dated copy of the two folders above, every day, last 30 days. `backups/conflicts/` keeps any extra copy a cloud folder made, once it has been merged in |

Turn on **Settings › Open at login** so the morning sheet is always written.

### Working on a handover together

Put the data folder in iCloud Drive, Google Drive or Dropbox, share it with the other person (for example the incoming assistant), and have them choose the same folder in **Settings › Change folder…**. No server and no account is involved: the cloud service copies the files, and the app does the rest.

- **Changes show up on the other Mac** a few seconds after the cloud service copies the file across.
- **Changes made at the same time are combined.** A save never overwrites the other person's work: if the file changed since the app last read it, the app merges the two, item by item. If you both changed the same field of the same item, your version is kept and the app tells you which field.
- **Extra copies are folded in.** When a cloud service keeps two versions side by side (iCloud's conflict versions, or a file such as `role (Priya's conflicted copy).handover`), the app merges the extra one in and moves it to `backups/conflicts/`. Here the app can't tell which side changed a field, so where the copies differ the one on your Mac wins.
- **Everyone keeps their own ticks and notes.** Progress is saved per person, and once two people share a handover, each person's morning sheet gets their name too.
- **Everyone with the folder sees everything in it**, including items marked for some roles only. Share the folder only with people who may see the whole record. For the principal, use the reports and exports.

The app checks GitHub for a new release once a day (or **Handover › Check for Updates…**). Installing one downloads the DMG, checks its SHA-256 and confirms the new app is signed by the same Apple developer team before swapping it in and relaunching. The only network request the app makes is this check, and you can turn it off in Settings.

## The format

A `.handover` file is UTF-8 JSON: a `path` of stages and tasks, `recurring` duties on a schedule, `questions` with short answers and reference `sections`. Version 1.4 lets a task or job name its guides: the documents (a step-by-step guide, a recording, a template) to open with it, and on a first-weeks task a section of the reference. Version 1.3 adds a lead time on regular jobs: how many days before its date the work has to start, so a renewal or a filing goes on the list in time. Version 1.2 adds the role itself (purpose, location, hours, skills and what good looks like), an area of work on each job and the jobs done as needed, so a file can produce a job description. Version 1.1 adds the full record of an assistant handover: people and stakeholders, the plan and the questions for the principal, gaps, rules, decisions, risks, systems and documents, who decides what (with limits and approvers), the final check, sign-off and check-ins. Every 1.0 file is still a valid 1.1 file.

See [the specification](spec/SPEC.md), the [JSON Schema](site/schema/v1.json) (frozen copies: [1.0](site/schema/v1.0.json), [1.1](site/schema/v1.1.json), [1.2](site/schema/v1.2.json), [1.3](site/schema/v1.3.json), [1.4](site/schema/v1.4.json)) and two examples: [an executive assistant handover with no overlap](site/examples/ea-no-overlap.handover) (1.2, the reference case) and [a simpler operations lead handover](site/examples/sample.handover) (1.0). Other tools are welcome to read and write it. `x-` fields are reserved for extensions.

Never put passwords or keys in a handover file. Say where they're kept instead.

## For AI agents

The [handover skill](skills/handover/SKILL.md) teaches Claude Code and other agents to create, convert, check, update and merge handover files:

```bash
npx skills add incrhst/handover
```

It includes a validator and schedule preview: `node scripts/handover.cjs check role.handover`, `… gaps`, `… due`, `… strip [--profile newcomer|record]`, `… render`, `… export` (items as PDF, Word or Excel), `… report` (a job description or a report for the principal; `--kind working,jobs,needs` combines several), `… kit` (the whole handover as one HTML file that opens in any browser), `… ics` (the regular jobs as a calendar file), `… merge`.

## Repository

| Path | What |
|---|---|
| `spec/SPEC.md` | The format specification |
| `site/` | The website, schema, example and AI prompt (published to GitHub Pages) |
| `app/web/` | The dashboard page (`index.html`) and the shared format logic (`core.js`) |
| `app/macos/` | The Mac app: a native window around the page, plus files, scheduling, backups and shared-folder sync |
| `skills/handover/` | The agent skill. Run `scripts/sync-shared.sh` after changing `core.js`, the spec, schema, examples or prompt |
| `test/` | Format and merge tests: `node --test test/*.test.cjs` |
| `scripts/` | Icon, build, notarisation and DMG scripts |

### Build it yourself

Needs Xcode or the Command Line Tools (Swift 5.9 or later). No other dependencies.

```bash
scripts/build-app.sh            # build/Handover.app, signed ad hoc
scripts/build-dmg.sh            # dist/Handover.dmg
```

To try the page in a browser without the app, serve the repo and open `app/web/index.html?src=../../site/examples/ea-no-overlap.handover`.

### Releasing

Releases are Developer ID-signed and notarised, so they open with no warning. The release's `Handover.dmg` is what the website's download button points to, and the app's updater checks it against `Handover.dmg.sha256` (it skips that check if the file is missing), so always attach both. To check a download by hand, put the two files in one folder and run `shasum -a 256 -c Handover.dmg.sha256`.

**From a Mac** (how releases are made today). Save the notarisation credentials once:

```bash
xcrun notarytool store-credentials handover --apple-id you@example.com --team-id TEAMID
```

Then tag `main`, build, and publish both files with release notes:

```bash
git tag -a v0.9.0 -m "Handover 0.9.0" && git push origin v0.9.0
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" NOTARY_PROFILE=handover scripts/build-app.sh 0.9.0
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" NOTARY_PROFILE=handover scripts/build-dmg.sh
gh release create v0.9.0 dist/Handover.dmg dist/Handover.dmg.sha256 --verify-tag --title "Handover 0.9.0" --notes-file notes.md
```

If `security find-identity -v -p codesigning` lists more than one certificate with the same name, `codesign` refuses the name as ambiguous: set `SIGN_IDENTITY` to the certificate's SHA-1 hash from that list instead. Notarising the app and the DMG takes a few minutes.

**From GitHub Actions.** Add the secrets listed at the top of [`.github/workflows/release.yml`](.github/workflows/release.yml), then push a tag. Without those secrets the workflow skips itself, so a release published from a Mac is never overwritten.

## Licence

MIT. See [LICENSE](LICENSE).
