# ShowSchedule

Livestock show management for youth shows and show series: family barns, online entries, automatic class building, a live ring schedule, placings, scoreboards and season-long series points.

**Setup:** see [docs/SETUP.md](docs/SETUP.md).

## How it's built

- `web/`: the website (plain HTML, CSS and JavaScript, no build step), published to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.
- `supabase/schema.sql`: the database. Supabase provides email/password accounts, the Postgres database, row-level security and live updates.
- `web/config.js`: the Supabase project URL and public anon key.
- `legacy-claude-artifact.html`: the original version that ran inside Claude, kept for reference.

## Features

- **Accounts:** sign up, log in, log out and reset passwords by email. Roles: exhibitor, show manager and admin. Anyone can follow shows without logging in.
- **My barn:** a family keeps multiple showmen and their cattle, sheep, goats and swine, and reuses them for every show. Barns are private.
- **Shows:** run by show managers (with co-managers). Divisions: breeding and market beef, breeding ewe and market lamb, breeding and market goat, breeding and market swine, plus showmanship for each species, before or after that species' classes. Searchable list with upcoming and past filters, filtering by series, and delete.
- **Classes:** built from entries by division, breed and sex. Market animals split by weight; breeding heifers get one class per birth month. Champion drives are added when a breed is split.
- **Ring:** live in the ring, on deck and in the hole, time estimates and exhibitor search. The manager's ring bar won't advance until a class is placed.
- **Scoring:** placings per class, breed champions and reserves, and overall drives. Each show has an entry scoreboard; each series has standings (exhibitor overall, by division and breed, showmanship by species). Point rules are editable per series.

## Security model (enforced in the database)

| Data | Read | Write |
|---|---|---|
| Shows, series, entries | Anyone | A show's managers or an admin; families only their own entry while entries are open |
| Barns | Owner only | Owner only |
| Profiles | Signed-in users (names only) | Own name; admins set roles |
