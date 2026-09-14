# AgentLens landing (Vercel)

Marketing site for AgentLens. Separate from the Docker dashboard (`../web`).

## Local

```bash
pnpm install          # from repo root (workspace) or this folder
pnpm run dev          # http://localhost:4050
pnpm run build
```

From the monorepo root:

```bash
pnpm run dev:landing
pnpm run build:landing
```

## Deploy to Vercel

1. Push this repo to GitHub (already: `Ratheshprabakar/AgentLens`).
2. In [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Set:
   - **Root Directory:** `landing`
   - **Framework Preset:** Vite
   - **Build Command:** `pnpm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `pnpm install`
4. Deploy. Leave `VITE_BASE` unset (defaults to `/`).

Or CLI from this folder:

```bash
npx vercel --prod
```
