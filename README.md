# ShowSchedule

Livestock show management: exhibitor barns, show entries, automatic class building, a live ring schedule, placings, per-show scoreboards and season-long series points.

## Current state

`app/index.html` is the working version that runs as a Claude artifact. It gets logins (`claude.use("user")`) and its database (`claude.use("db")`) from Claude, so it does **not** run on its own yet.

## Features

- **Barns:** each login keeps multiple showmen and their animals (cattle, sheep, goats, swine) and reuses them for every show.
- **Shows:** created and run by show managers. Divisions: breeding/market beef, breeding ewe/market lamb, breeding/market goat, breeding/market swine, plus showmanship for each species (before or after that species' classes).
- **Classes:** built automatically by division, breed and sex. Market animals split by weight; breeding heifers get one class per birth month. Champion drives are added when a breed is split.
- **Ring:** live "in the ring / on deck / in the hole," time estimates, exhibitor search, and a manager ring bar that requires each class to be placed.
- **Scoring:** placings per class, breed champions/reserves, overall drives; an entry scoreboard per show; series standings (exhibitor overall, by division and breed, showmanship by species). Point rules are editable per series (defaults from the 2019–20 SDJPS handbook).

## Roadmap

1. Move logins and data to Supabase (email/password sign-up, row-level security).
2. Split into a small Vite project and deploy from this repo (Netlify, Vercel or Cloudflare Pages).
3. Migrate existing show data.
