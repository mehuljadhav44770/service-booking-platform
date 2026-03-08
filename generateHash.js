const bcrypt = require('bcryptjs');

async function generateHash() {
  const password = 'Admin@123';  // your chosen admin password
  const hash = await bcrypt.hash(password, 10);
  console.log('Hashed password:', hash);
}

generateHash();
