import mysql from 'mysql2/promise';
import config from '../config';
import { generateUUID } from '../utils/uuid';

const roles = [
  { name: 'admin', description: '系統管理員' },
  { name: 'content_creator', description: '內容創作者' },
  { name: 'reviewer', description: '審稿者' },
];

async function seed() {
  let connection: mysql.Connection | null = null;

  try {
    console.log('Starting database seeding...');

    connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
    });

    // Insert roles
    console.log('Inserting roles...');
    for (const role of roles) {
      const roleId = generateUUID();
      await connection.execute(
        'INSERT IGNORE INTO roles (id, name) VALUES (?, ?)',
        [roleId, role.name]
      );
      console.log(`  ✓ Role created: ${role.name}`);
    }

    // Check if admin user exists
    const [existingUsers] = await connection.execute<any>(
      'SELECT id FROM users WHERE email = ?',
      ['admin@example.com']
    );

    if (existingUsers.length === 0) {
      console.log('Creating default admin user...');
      console.log('⚠️  WARNING: Please update the following after seeding:');
      console.log('   - Admin email');
      console.log('   - Admin LINE user ID');
      console.log('');

      const adminId = generateUUID();

      await connection.execute(
        `INSERT INTO users (id, email, password_hash, name, line_user_id, status)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
        [adminId, 'admin@example.com', '', 'System Admin', null]
      );

      // Assign admin role
      const [adminRole] = await connection.execute<any>(
        'SELECT id FROM roles WHERE name = ?',
        ['admin']
      );

      if (adminRole.length > 0) {
        await connection.execute(
          'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
          [adminId, adminRole[0].id]
        );
      }

      console.log('  ✓ Admin user created: admin@example.com');
      console.log('  ⚠️  Please update LINE user ID manually!');
    } else {
      console.log('  ℹ  Admin user already exists, skipping...');
    }

    console.log('');
    console.log('✓ Database seeding completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Update admin user with your LINE user ID:');
    console.log('   UPDATE users SET line_user_id = "YOUR_LINE_USER_ID" WHERE email = "admin@example.com";');
    console.log('');
    console.log('2. Set up Threads account via OAuth flow');
    console.log('3. Start the server: npm run dev');
    console.log('4. Start the worker: npm run worker');
  } catch (error) {
    console.error('✗ Seeding failed:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run seeding if called directly
if (require.main === module) {
  seed()
    .then(() => {
      console.log('Seeding process completed.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding process failed:', error);
      process.exit(1);
    });
}

export default seed;
