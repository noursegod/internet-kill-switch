// tests/helpers/dbHelper.js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Construct the absolute path to schema.sql relative to this helper file
const schemaPath = path.resolve(__dirname, '../../db/schema.sql');
let schemaSQL;

try {
    schemaSQL = fs.readFileSync(schemaPath, 'utf8');
} catch (error) {
    console.error(`FATAL: Could not read schema file at ${schemaPath}. Ensure the path is correct.`);
    console.error("Error details:", error);
    process.exit(1); // Exit if schema can't be loaded, tests are meaningless
}

/**
 * Sets up a fresh in-memory SQLite database with the schema applied.
 * @returns {Database.Database} An instance of the better-sqlite3 database.
 */
function setupTestDb() {
    try {
        const db = new Database(':memory:'); // Creates a new in-memory database for each call
        db.exec(schemaSQL); // Apply the schema
        return db;
    } catch (error) {
        console.error("Failed to set up the test database:", error);
        throw error; // Re-throw to fail the test setup if DB init fails
    }
}

/**
 * Injects the test DB instance into the main database module (db/database.js).
 * This is one way to ensure your DB functions use the test DB.
 * Requires db/database.js to be modifiable or to export a setter for its dbInstance.
 * 
 * A cleaner way might be to pass the `db` instance to each repository function,
 * e.g., `addUser({ dbInstance: testDb, userData })`.
 * 
 * For now, this example assumes db/database.js can have its instance replaced or
 * that it checks NODE_ENV=test to use :memory:.
 * 
 * Let's assume db/database.js has a (hypothetical) function like:
 * `setTestDbInstance(instance)` for this helper to work directly.
 * Or, if db/database.js already handles NODE_ENV=test to use :memory:,
 * then this function might just call initializeDatabase() from there and return the instance.
 * 
 * Given the current structure of db/database.js (global dbInstance),
 * directly replacing its getDB method or its internal instance is tricky without modifying it.
 * The most robust way for tests is to pass the db instance to each function.
 * 
 * This helper will primarily focus on providing the setupTestDb function.
 * Tests should then import this and pass the returned db instance to repository functions.
 */

module.exports = { setupTestDb };
