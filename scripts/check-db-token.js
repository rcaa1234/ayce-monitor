const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

async function checkToken() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const [rows] = await connection.execute(`
    SELECT
      ta.username,
      t.access_token,
      LENGTH(t.access_token) as token_length,
      t.status,
      t.expires_at
    FROM threads_auth t
    JOIN threads_accounts ta ON t.account_id = ta.id
    WHERE ta.status = 'ACTIVE'
    ORDER BY t.created_at DESC
    LIMIT 1
  `);

  console.log('Database check:');
  console.log('Rows found:', rows.length);

  if (rows.length > 0) {
    const row = rows[0];
    console.log('Username:', row.username);
    console.log('Token length:', row.token_length);
    console.log('Token preview:', row.access_token ? row.access_token.substring(0, 50) + '...' : 'NULL');
    console.log('Status:', row.status);
    console.log('Expires at:', row.expires_at);
  }

  await connection.end();
}

checkToken().catch(console.error);
