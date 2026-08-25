// Database setup script - executes schema.sql and seed.sql against Supabase
// Run: node scripts/setup-db.mjs

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://fbnqanywnnjtntvliljw.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibnFhbnl3bm5qdG50dmxpbGp3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjIzMzM0NCwiZXhwIjoyMDkxODA5MzQ0fQ.Lgj3TfGbNPLi_XFrRwZ7Gf-3GXBI8-yTW7ovoTn0J3E'

// Split SQL into individual statements, handling multi-line statements
function splitStatements(sql) {
  // Remove comments
  const lines = sql.split('\n')
  const cleaned = lines
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')

  // Split by semicolons, but be smart about it
  const statements = cleaned
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  return statements
}

async function executeSql(sql, label) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    // If the exec_sql function doesn't exist, we need another approach
    if (text.includes('PGRST202') || text.includes('could not find')) {
      return { needsAlternate: true }
    }
    throw new Error(`${label}: ${resp.status} - ${text}`)
  }
  return { ok: true }
}

async function executeViaQuery(sql) {
  // Try the /pg endpoint (available in newer Supabase)
  const resp = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    return { error: text, status: resp.status }
  }
  return { ok: true, data: await resp.json() }
}

async function main() {
  console.log('🚀 Setting up Draco CRM database...\n')

  // Read SQL files
  const schemaSQL = readFileSync(resolve(__dirname, '../supabase/schema.sql'), 'utf-8')
  const seedSQL = readFileSync(resolve(__dirname, '../supabase/seed.sql'), 'utf-8')

  // Try the /pg/query endpoint first
  console.log('Testing connection...')
  const test = await executeViaQuery('SELECT 1 as ok')

  if (test.ok) {
    console.log('✅ Connected via /pg/query endpoint\n')

    // Execute schema
    console.log('📋 Creating tables...')
    const schemaResult = await executeViaQuery(schemaSQL)
    if (schemaResult.error) {
      console.error('❌ Schema error:', schemaResult.error)
    } else {
      console.log('✅ Schema created successfully\n')
    }

    // Execute seed
    console.log('🌱 Seeding users...')
    const seedResult = await executeViaQuery(seedSQL)
    if (seedResult.error) {
      console.error('❌ Seed error:', seedResult.error)
    } else {
      console.log('✅ Users seeded successfully\n')
    }

    console.log('🎉 Database setup complete!')
  } else {
    console.log(`⚠️  /pg/query not available (${test.status})`)
    console.log('')
    console.log('Please run the SQL manually in Supabase SQL Editor:')
    console.log('1. Go to https://supabase.com/dashboard/project/fbnqanywnnjtntvliljw/sql')
    console.log('2. Copy & paste the contents of supabase/schema.sql and click Run')
    console.log('3. Copy & paste the contents of supabase/seed.sql and click Run')
    console.log('')

    // Try creating tables via REST API as fallback
    console.log('Attempting alternative method...')
    const altResult = await executeSql(schemaSQL, 'schema')
    if (altResult.needsAlternate) {
      console.log('❌ Cannot execute DDL via REST API.')
      console.log('')
      console.log('=== Please copy the SQL below and run in Supabase SQL Editor ===')
      console.log('')
      console.log('--- STEP 1: Schema (paste in SQL Editor and click Run) ---')
      console.log('File: supabase/schema.sql')
      console.log('')
      console.log('--- STEP 2: Seed (paste in SQL Editor and click Run) ---')
      console.log('File: supabase/seed.sql')
    }
  }
}

main().catch(console.error)
