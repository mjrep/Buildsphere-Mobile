const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkUser() {
  try {
    const res = await pool.query('SELECT email FROM "public"."users" WHERE email = $1', ['ceo@buildsphere.com']);
    if (res.rows.length > 0) {
      console.log('✅ User ceo@buildsphere.com exists in database.');
    } else {
      console.log('❌ User ceo@buildsphere.com NOT found.');
    }
  } catch (err) {
    console.error('❌ Database error:', err.message);
  } finally {
    await pool.end();
  }
}

checkUser();
