const bcrypt = require("bcrypt");
const pool = require("./db"); // reuse your db.js connection

(async () => {
  try {
    const tempPassword = "mehul1234"; 
    const hashed = await bcrypt.hash(tempPassword, 10);

    // reset all users' passwords
    const userResult = await pool.query("UPDATE users SET password_hash=$1", [hashed]);

    // reset all service_providers' passwords
    const providerResult = await pool.query("UPDATE service_providers SET password_hash=$1", [hashed]);

    console.log(`✅ Password reset for ${userResult.rowCount} users`);
    console.log(`✅ Password reset for ${providerResult.rowCount} service providers`);
    console.log(`ℹ️ Temporary password for everyone: ${tempPassword}`);
    process.exit();
  } catch (err) {
    console.error("❌ Error resetting passwords:", err);
    process.exit(1);
  }
})();
