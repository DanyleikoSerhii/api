# Movie API

Backend for Movie Explorer built with Hono + TypeScript, PostgreSQL, Drizzle ORM.

## Setup

```bash
pnpm install
docker compose up -d
pnpm run db:migrate
pnpm run db:seed
pnpm run dev
```

## Download IMDb data

Download the following files from https://datasets.imdbws.com/ and place them in `seeds/`:

- `title.basics.tsv.gz`
- `title.ratings.tsv.gz`
- `title.crew.tsv.gz`
- `title.episode.tsv.gz`
- `title.principals.tsv.gz`
- `name.basics.tsv.gz`

Decompress each file: `gunzip seeds/*.gz`

## Scripts

- `pnpm run dev` — start development server with hot reload
- `pnpm run build` — compile TypeScript
- `pnpm run db:generate` — generate Drizzle migrations
- `pnpm run db:migrate` — run migrations
- `pnpm run db:seed` — seed database from IMDb TSV files (requires TSV files in `seeds/`)
- `pnpm test` — run tests against test database (`DATABASE_URL_TEST`)
- `pnpm test:coverage` — run tests with coverage report

## API

- Health: `GET /health`
- Swagger UI: `GET /api/docs`
- OpenAPI spec: `GET /api/openapi.json`

---

Movie data provided by IMDb. Used under IMDb Non-Commercial Datasets license for educational purposes only.
