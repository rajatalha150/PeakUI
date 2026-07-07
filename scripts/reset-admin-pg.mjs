import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const password = process.argv[2] || 'PeakUI#Secure2026!'
const hash = await bcrypt.hash(password, 12)
const { rowCount } = await pool.query(
  'UPDATE "User" SET \"passwordHash\" = $1, \"tokenVersion\" = \"tokenVersion\" + 1 WHERE username = $2',
  [hash, 'admin'],
)
console.log('updated rows', rowCount)
await pool.end()
