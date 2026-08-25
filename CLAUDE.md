# Draco LOP - 登泰國際物流營運管理平台 (Draco Logistic Operation Platform)

## Tech Stack
- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase (PostgreSQL + Auth + RLS)
- Deployed on Vercel
- PWA enabled

## Project Structure
- `src/app/(main)/` - Protected pages with shared layout (sidebar + bottom nav)
- `src/app/login/` - Auth login page
- `src/app/api/` - API routes (cron, webhook, auth callback)
- `src/lib/` - Supabase clients, auth context, utilities
- `src/types/` - TypeScript type definitions
- `supabase/` - SQL schema and seed data

## Key Commands
- `npm run dev` - Start dev server
- `npm run build` - Build for production

## Database
- Run `supabase/schema.sql` in Supabase SQL Editor first
- Then run `supabase/seed.sql` for initial user data
- Enable `pg_trgm` extension for fuzzy search

## Environment Variables
Copy `.env.local.example` to `.env.local` and fill in Supabase credentials.
