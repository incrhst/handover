# Handover

Take over a role, one step at a time. **Handover** is a free Mac app that turns one file into a guided first month, a daily list of what's due and a reference you can search. The file is an open format that you can write with any AI chat.

**[Download for Mac](https://github.com/incrhst/handover/releases/latest/download/Handover.dmg)** · [Website](https://incrhst.github.io/handover/) · [The format](spec/SPEC.md)

## How it works

1. Download `Handover.dmg` and drag Handover to Applications.
2. Copy [the AI prompt](site/prompt.md) into Claude, ChatGPT or Gemini. It interviews the outgoing person, one question at a time, then writes the handover file.
3. Save the answer as `role.handover` and open it in Handover.
4. Follow the first-month path, tick off today's duties and search when you need an answer.
   Anything the AI couldn't fill in shows as a gap. Click **N gaps to fill**, or any gap on the page, and type what's missing. The app saves it to the file and refuses passwords, PINs, codes and card or bank numbers.
   Work through **Needs attention** and the records: **Close…** marks an item fixed, done, handed to the principal or no longer needed, and **Reopen** undoes it. **Add…** records something new as you find it: a thing in progress, a gap, a rule, a decision, a risk, a system and who grants access to it, a document or a who-decides card (format 1.1 files). **Edit…** corrects anything that isn't accurate: a record, a task in the first weeks, or a regular job, including how often it happens (**All regular jobs** under Today lists every job). The item keeps its place and its ticks, and the change goes in the change log.
   **Report for …** makes a short, plain report for the principal at any point: *What we're working on*, *The assistant's jobs* or *What needs you*. Each opens with a summary worked out from the file, never claiming more than it shows, and leaves out anything the principal may not see. Preview it, then save it as PDF, Word or Markdown to send.
5. Share the file with the next person (**Share & export › Share handover file**), or export it with your progress to move it to another Mac or tool.
6. For someone who won't use the app, such as the principal, use **Share & export › Export items as a document…**, or the **Export…** button on any panel: pick the parts to share (the overview, who's who, jobs, tasks, records, reference sections, the handover plan, sign-off and more, down to single items) and save them as PDF, Word or Excel.

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

A `.handover` file is UTF-8 JSON: a `path` of stages and tasks, `recurring` duties on a schedule, `questions` with short answers and reference `sections`. Version 1.1 adds the full record of an assistant handover: people and stakeholders, the plan and the questions for the principal, gaps, rules, decisions, risks, systems and documents, who decides what (with limits and approvers), the final check, sign-off and check-ins. Every 1.0 file is still a valid 1.1 file.

See [the specification](spec/SPEC.md), the [JSON Schema](site/schema/v1.json) (frozen copies: [1.0](site/schema/v1.0.json), [1.1](site/schema/v1.1.json)) and two examples: [an executive assistant handover with no overlap](site/examples/ea-no-overlap.handover) (1.1, the reference case) and [a simpler operations lead handover](site/examples/sample.handover) (1.0). Other tools are welcome to read and write it. `x-` fields are reserved for extensions.

Never put passwords or keys in a handover file. Say where they're kept instead.

## For AI agents

The [handover skill](skills/handover/SKILL.md) teaches Claude Code and other agents to create, convert, check, update and merge handover files:

```bash
npx skills add incrhst/handover
```

It includes a validator and schedule preview: `node scripts/handover.cjs check role.handover`, `… gaps`, `… due`, `… strip [--profile newcomer|record]`, `… render`, `… export` (items as PDF, Word or Excel), `… merge`.

## Repository

| Path | What |
|---|---|
| `spec/SPEC.md` | The format specification |
| `site/` | The website, schema, example and AI prompt (published to GitHub Pages) |
| `app/web/` | The dashboard page (`index.html`) and the shared format logic (`core.js`) |
| `app/macos/` | The Mac app: a native window around the page, plus files, scheduling and backups |
| `skills/handover/` | The agent skill. Run `scripts/sync-shared.sh` after changing `core.js`, the spec, schema, examples or prompt |
| `test/` | Format tests: `node --test test/*.test.cjs` |
| `scripts/` | Icon, build, notarisation and DMG scripts |

### Build it yourself

Needs Xcode or the Command Line Tools (Swift 5.9 or later). No other dependencies.

```bash
scripts/build-app.sh            # build/Handover.app, signed ad hoc
scripts/build-dmg.sh            # dist/Handover.dmg
```

To try the page in a browser without the app, serve the repo and open `app/web/index.html?src=../../site/examples/ea-no-overlap.handover`.

### Releasing

Releases are Developer ID-signed and notarised, so they open with no warning. Locally:

```bash
xcrun notarytool store-credentials handover --apple-id you@example.com --team-id TEAMID
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" NOTARY_PROFILE=handover scripts/build-app.sh 0.1.0
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" NOTARY_PROFILE=handover scripts/build-dmg.sh
```

In GitHub Actions, add the secrets listed at the top of [`.github/workflows/release.yml`](.github/workflows/release.yml), then push a tag: `git tag v0.1.0 && git push origin v0.1.0`. The release's `Handover.dmg` is what the website's download button points to.

## Licence

MIT. See [LICENSE](LICENSE).
