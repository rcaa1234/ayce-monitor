/**
 * 查詢系統現有使用者和角色
 * 用途：確認系統使用者結構，避免破壞既有功能
 */
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

async function checkUsers() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  try {
    console.log('=== 現有使用者 ===\n');
    const [users] = await conn.execute('SELECT id, email, name, status FROM users LIMIT 10');
    users.forEach(u => {
      console.log(`  ${u.email} (${u.name}) - ${u.status}`);
      console.log(`    ID: ${u.id}`);
    });

    console.log('\n=== 現有角色 ===\n');
    const [roles] = await conn.execute(`
      SELECT r.name, COUNT(ur.user_id) as user_count
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      GROUP BY r.id
    `);
    roles.forEach(r => {
      console.log(`  ${r.name}: ${r.user_count} 位使用者`);
    });

  } finally {
    await conn.end();
  }
}

checkUsers();
