const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const BCRYPT_SALT_ROUNDS = 10; // Define salt rounds for bcrypt

// Determine the database path. Prioritize environment variable, then default.
// Ensure the path is absolute or correctly relative to the project root.
// Default database path definition (can still use a resolved path for the default)
const defaultDbPath = path.join(path.resolve(__dirname, '../../instance'), 'opnsense_controller.sqlite');
const DATABASE_PATH = process.env.DATABASE_PATH || defaultDbPath;

let dbInstance = null;

function initializeDatabase() {
    if (dbInstance) {
        return dbInstance;
    }

    // Directory creation logic moved here and made conditional
    if (DATABASE_PATH !== ':memory:') {
        const resolvedDbDirectory = path.dirname(DATABASE_PATH);
        if (!fs.existsSync(resolvedDbDirectory)) {
            try {
                fs.mkdirSync(resolvedDbDirectory, { recursive: true });
                console.log(`INFO: Created database directory: ${resolvedDbDirectory}`);
            } catch (mkdirError) {
                console.error(`FATAL: Could not create database directory ${resolvedDbDirectory}:`, mkdirError);
                process.exit(1); // Exit if directory creation fails for a non-memory DB
            }
        }
    }

    // For in-memory DB, dbExists will be false, leading to schema application, which is correct.
    // For file DB, it checks actual file existence.
    const dbExists = (DATABASE_PATH === ':memory:') ? false : fs.existsSync(DATABASE_PATH);


    try {
        console.log(`Attempting to connect to database at: ${DATABASE_PATH}`);
        const db = new Database(DATABASE_PATH, { verbose: console.log });

        if (!dbExists) { // This condition now correctly handles both new file DBs and new in-memory DBs
            console.log("Database file does not exist. Creating and applying schema...");
            const schemaSQLPath = path.join(__dirname, 'schema.sql');
            if (!fs.existsSync(schemaSQLPath)) {
                console.error(`FATAL: Schema file not found at ${schemaSQLPath}`);
                process.exit(1); // Critical error, cannot proceed
            }
            const schemaSQL = fs.readFileSync(schemaSQLPath, 'utf8');
            db.exec(schemaSQL);
            console.log("Database created and schema applied successfully.");
        } else {
            console.log("Database already exists. Connection established.");
            // Here you might want to run migrations if you had a migration system
        }
        
        dbInstance = db;
        return dbInstance;
    } catch (error) {
        console.error("Error during database initialization:", error);
        process.exit(1); // Exit if DB cannot be initialized
    }
}

// Export a function to get the database instance.
// This ensures initializeDatabase() is called and dbInstance is set before use.
function getDB() {
    if (!dbInstance) {
        initializeDatabase();
    }
    return dbInstance;
}

// Initialize and export the DB instance directly if you prefer the module to handle initialization on load.
// However, calling initializeDatabase() explicitly in app.js gives more control over when it happens.
// For this project, we'll export the getDB function for controlled access.

// --- ManagedRules CRUD Functions ---

function addManagedRule({ uuid, description, userId, desiredState = false }) {
    const db = getDB();
    try {
        const stmt = db.prepare(
            'INSERT INTO ManagedRules (opnsense_rule_uuid, description, user_id, desired_state, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        );
        const info = stmt.run(uuid, description, userId, desiredState ? 1 : 0);
        console.log(`Added managed rule: ${uuid} for user ${userId}, ID: ${info.lastInsertRowid}`);
        return { id: info.lastInsertRowid, uuid, userId };
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            console.warn(`Attempted to add duplicate managed rule: UUID ${uuid} for user ${userId}`);
            throw new Error(`Rule with UUID ${uuid} is already managed by this user.`);
        }
        console.error(`Error adding managed rule (UUID: ${uuid}, User: ${userId}):`, error);
        throw error; // Re-throw other errors
    }
}

function removeManagedRule({ uuid, userId }) {
    const db = getDB();
    try {
        const stmt = db.prepare('DELETE FROM ManagedRules WHERE opnsense_rule_uuid = ? AND user_id = ?');
        const info = stmt.run(uuid, userId);
        console.log(`Removed managed rule: ${uuid} for user ${userId}, changes: ${info.changes}`);
        return info.changes; // Number of rows deleted
    } catch (error) {
        console.error(`Error removing managed rule (UUID: ${uuid}, User: ${userId}):`, error);
        throw error;
    }
}

function getManagedRuleByUuid({ uuid, userId }) {
    const db = getDB();
    try {
        const stmt = db.prepare('SELECT * FROM ManagedRules WHERE opnsense_rule_uuid = ? AND user_id = ?');
        const rule = stmt.get(uuid, userId);
        return rule ? { ...rule, desired_state: !!rule.desired_state } : undefined; // Convert 0/1 to boolean
    } catch (error) {
        console.error(`Error getting managed rule by UUID (UUID: ${uuid}, User: ${userId}):`, error);
        throw error;
    }
}

function getAllManagedRulesForUser({ userId }) {
    const db = getDB();
    try {
        const stmt = db.prepare('SELECT * FROM ManagedRules WHERE user_id = ? ORDER BY description, opnsense_rule_uuid');
        const rules = stmt.all(userId);
        return rules.map(rule => ({ ...rule, desired_state: !!rule.desired_state })); // Convert 0/1 to boolean
    } catch (error) {
        console.error(`Error getting all managed rules for user (User: ${userId}):`, error);
        throw error;
    }
}

function updateManagedRuleDesiredState({ uuid, userId, desiredState }) {
    const db = getDB();
    try {
        const stmt = db.prepare(
            'UPDATE ManagedRules SET desired_state = ?, updated_at = CURRENT_TIMESTAMP WHERE opnsense_rule_uuid = ? AND user_id = ?'
        );
        const info = stmt.run(desiredState ? 1 : 0, uuid, userId);
        console.log(`Updated desired state for rule: ${uuid}, user ${userId} to ${desiredState}, changes: ${info.changes}`);
        return info.changes;
    } catch (error) {
        console.error(`Error updating desired state for rule (UUID: ${uuid}, User: ${userId}):`, error);
        throw error;
    }
}

function updateManagedRuleTimer({ uuid, userId, timerActiveUntil, timerActionOnExpiry }) {
    const db = getDB();
    try {
        // Ensure timerActiveUntil is either a valid ISO8601 string or null
        const formattedTimerActiveUntil = timerActiveUntil 
            ? (typeof timerActiveUntil === 'string' ? timerActiveUntil : new Date(timerActiveUntil).toISOString()) 
            : null;

        const stmt = db.prepare(
            'UPDATE ManagedRules SET timer_active_until = ?, timer_action_on_expiry = ?, updated_at = CURRENT_TIMESTAMP WHERE opnsense_rule_uuid = ? AND user_id = ?'
        );
        const info = stmt.run(formattedTimerActiveUntil, timerActionOnExpiry, uuid, userId);
        console.log(`Updated timer for rule: ${uuid}, user ${userId}, until: ${formattedTimerActiveUntil}, action: ${timerActionOnExpiry}, changes: ${info.changes}`);
        return info.changes;
    } catch (error) {
        console.error(`Error updating timer for rule (UUID: ${uuid}, User: ${userId}):`, error);
        throw error;
    }
}

/**
 * Fetches rules with timers that have expired.
 * It selects rules where timer_active_until is not NULL and is less than or equal to the current UTC time.
 * Also fetches user_id and opnsense_rule_uuid.
 * @returns {Array<object>} An array of rule objects with expired timers.
 */
function getExpiredTimerRules() {
    const db = getDB();
    try {
        // SQLite stores DATETIME as TEXT in ISO8601 format (YYYY-MM-DD HH:MM:SS.SSS) if using toISOString()
        // We can compare these strings directly, or convert to unixepoch.
        // Using strftime('%s', ...) converts to unixepoch seconds.
        const stmt = db.prepare(`
            SELECT id, opnsense_rule_uuid, user_id, desired_state, timer_active_until, timer_action_on_expiry 
            FROM ManagedRules 
            WHERE timer_active_until IS NOT NULL AND strftime('%s', timer_active_until) <= strftime('%s', 'now')
        `);
        const rules = stmt.all();
        return rules.map(rule => ({ 
            ...rule, 
            desired_state: !!rule.desired_state, 
            // timer_active_until is already a string, can be parsed to Date by caller if needed
        }));
    } catch (error) {
        console.error('Error getting rules with expired timers:', error);
        throw error;
    }
}


module.exports = { 
    getDB, 
    initializeDatabase, 
    DATABASE_PATH,
    // ManagedRules functions
    addManagedRule,
    removeManagedRule,
    getManagedRuleByUuid,
    getAllManagedRulesForUser,
    updateManagedRuleDesiredState,
    updateManagedRuleTimer,
    getExpiredTimerRules, // This is the actual function name in the code
    // User and OOBE functions
    findOrCreateUserByGoogleId, // Ensure this is the updated version
    getUserById,
    countUsers,
    createUser,
    findUserByEmail,
    verifyPassword,
    linkGoogleAccount,
    setUserPassword,
    promoteUserToAdmin,
    // Invitation functions
    createInvitationCode,
    getInvitationByCode,
    markInvitationAsUsed,
    getAllInvitations,
    // Schedule functions
    addSchedule,
    getScheduleById,
    getAllSchedulesForUser,
    getAllActiveSchedules,
    updateSchedule,
    removeSchedule,
    updateScheduleLastTriggered,
    // AppSettings functions
    getSetting,
    setSetting,
    getAllSettings,
};

// --- AppSettings Functions ---

/**
 * Retrieves a specific setting from the AppSettings table.
 * @param {string} key The key of the setting to retrieve.
 * @returns {string|null} The value of the setting, or null if not found.
 */
function getSetting(key) {
    const db = getDB();
    try {
        const stmt = db.prepare('SELECT value FROM AppSettings WHERE key = ?');
        const row = stmt.get(key);
        return row ? row.value : null;
    } catch (error) {
        console.error(`Error getting setting (Key: ${key}):`, error);
        throw error;
    }
}

/**
 * Sets a specific setting in the AppSettings table.
 * Uses SQLite's UPSERT capability.
 * @param {string} key The key of the setting to set.
 * @param {string} value The value of the setting.
 * @returns {boolean} True if successful.
 */
function setSetting(key, value) {
    const db = getDB();
    try {
        // Using INSERT ... ON CONFLICT ... DO UPDATE (UPSERT)
        // The 'excluded.' prefix refers to the values that would have been inserted if there was no conflict.
        // CURRENT_TIMESTAMP will handle created_at on initial insert.
        // We explicitly set updated_at to CURRENT_TIMESTAMP on both insert and update.
        const stmt = db.prepare(
            `INSERT INTO AppSettings (key, value, created_at, updated_at) 
             VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
        );
        stmt.run(key, String(value)); // Ensure value is stored as text
        console.log(`Setting '${key}' set/updated successfully.`);
        return true;
    } catch (error) {
        console.error(`Error setting '${key}':`, error);
        throw error;
    }
}

/**
 * Retrieves all settings from the AppSettings table.
 * @returns {object} An object where keys are setting keys and values are setting values.
 */
function getAllSettings() {
    const db = getDB();
    try {
        const stmt = db.prepare('SELECT key, value FROM AppSettings');
        const rows = stmt.all();
        const settings = {};
        for (const row of rows) {
            settings[row.key] = row.value;
        }
        return settings;
    } catch (error) {
        console.error('Error getting all settings:', error);
        throw error;
    }
}


// --- User and OOBE DB Functions ---

/**
 * Finds an existing user by their Google ID or creates a new one.
 * The is_admin field is NOT set by this function; OOBE logic handles that.
 * @param {object} params
 * @param {string} params.googleId
 * @param {string} params.email
 * @param {string} params.displayName
 * @returns {object} The found or created user object.
 */
function findOrCreateUserByGoogleId({ googleId, email, displayName }) {
    const db = getDB();
    try {
        // Check if a user exists with the provided email
        let user = db.prepare('SELECT * FROM Users WHERE email = ?').get(email);

        if (user) {
            // User with this email exists. Link Google ID if not already linked.
            if (!user.google_id) {
                const stmt = db.prepare('UPDATE Users SET google_id = ?, display_name = COALESCE(?, display_name), last_login_at = CURRENT_TIMESTAMP WHERE id = ?');
                stmt.run(googleId, displayName, user.id);
                console.log(`Linked Google ID ${googleId} to existing user ${user.email} (ID: ${user.id}).`);
                user.google_id = googleId; // Update in-memory object
                if (displayName) user.display_name = displayName;
            } else if (user.google_id !== googleId) {
                // This email is associated with a DIFFERENT Google ID. This is a conflict.
                console.error(`Conflict: Email ${email} is already linked to a different Google ID.`);
                throw new Error(`Email ${email} is already linked to a different Google account.`);
            }
            // Update display name if provided and different, and last login
            const updateStmt = db.prepare('UPDATE Users SET display_name = COALESCE(?, display_name), last_login_at = CURRENT_TIMESTAMP WHERE id = ?');
            updateStmt.run(displayName, user.id);
            if (displayName) user.display_name = displayName;
            
            console.log(`User ${user.email} (ID: ${user.id}) logged in with Google. Updated last login and display name if changed.`);
            return { ...user, is_admin: !!user.is_admin };
        } else {
            // No user with this email. Check if googleId is already in use (should be rare if email is primary check now)
            user = db.prepare('SELECT * FROM Users WHERE google_id = ?').get(googleId);
            if (user) {
                // A user exists with this google_id but a different email. This is unusual.
                // Update their email if it's provided and different.
                if (email && user.email !== email) {
                    console.warn(`User with Google ID ${googleId} exists but has a different email (${user.email}). Updating to ${email}.`);
                    const stmt = db.prepare('UPDATE Users SET email = ?, display_name = COALESCE(?, display_name), last_login_at = CURRENT_TIMESTAMP WHERE google_id = ?');
                    stmt.run(email, displayName, googleId);
                    user.email = email;
                } else {
                   const stmt = db.prepare('UPDATE Users SET last_login_at = CURRENT_TIMESTAMP, display_name = COALESCE(?, display_name) WHERE google_id = ?');
                   stmt.run(displayName, googleId);
                }
                if (displayName) user.display_name = displayName;
                console.log(`User with Google ID ${googleId} logged in. Email updated if necessary.`);
                return { ...user, is_admin: !!user.is_admin };
            }

            // New user: Neither email nor googleId found.
            if (!email) {
                console.error("findOrCreateUserByGoogleId: Email is required to create a new user from Google profile.");
                throw new Error("Email is required to create a new user.");
            }
            const stmt = db.prepare(
                'INSERT INTO Users (google_id, email, display_name, created_at, last_login_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
            );
            const info = stmt.run(googleId, email, displayName);
            console.log(`New user created with ID: ${info.lastInsertRowid} (Email: ${email}, GoogleID: ${googleId})`);
            const newUser = db.prepare('SELECT * FROM Users WHERE id = ?').get(info.lastInsertRowid);
            return { ...newUser, is_admin: !!newUser.is_admin };
        }
    } catch (error) {
        console.error(`Error in findOrCreateUserByGoogleId (Email: ${email}, GoogleID: ${googleId}):`, error);
        throw error;
    }
}

/**
 * Finds a user by their Google ID.
 * @param {string} googleId The user's Google ID.
 * @returns {object|undefined} The user object or undefined if not found.
 */
function findUserByGoogleId(googleId) {
    const db = getDB();
    try {
        const stmt = db.prepare('SELECT * FROM Users WHERE google_id = ?');
        const user = stmt.get(googleId);
        return user ? { ...user, is_admin: !!user.is_admin } : undefined;
    } catch (error) {
        console.error(`Error in findUserByGoogleId (GoogleID: ${googleId}):`, error);
        throw error;
    }
}

async function createUser({ email, password, displayName = null }) {
    const db = getDB();
    try {
        let existingUser = db.prepare('SELECT * FROM Users WHERE email = ?').get(email);
        if (existingUser) {
            throw new Error('User with this email already exists.');
        }

        const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
        const stmt = db.prepare(
            'INSERT INTO Users (email, password, display_name, created_at, last_login_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        );
        const info = stmt.run(email, hashedPassword, displayName);
        console.log(`New user created with ID: ${info.lastInsertRowid} (Email: ${email})`);
        const newUser = db.prepare('SELECT * FROM Users WHERE id = ?').get(info.lastInsertRowid);
        return { ...newUser, is_admin: !!newUser.is_admin };
    } catch (error) {
        console.error(`Error in createUser (Email: ${email}):`, error);
        throw error;
    }
}

function findUserByEmail(email) {
    const db = getDB();
    try {
        const stmt = db.prepare('SELECT * FROM Users WHERE email = ?');
        const user = stmt.get(email);
        return user ? { ...user, is_admin: !!user.is_admin } : undefined;
    } catch (error) {
        console.error(`Error in findUserByEmail (Email: ${email}):`, error);
        throw error;
    }
}

async function verifyPassword(candidatePassword, hashedPassword) {
    if (!hashedPassword) { // User might exist via OAuth but has no local password set
       return false;
    }
    return await bcrypt.compare(candidatePassword, hashedPassword);
}

function linkGoogleAccount({ userId, googleId, googleEmail, googleDisplayName }) {
    const db = getDB();
    try {
        // Check if this Google ID is already linked to another account
        const existingGoogleLink = db.prepare('SELECT * FROM Users WHERE google_id = ? AND id != ?').get(googleId, userId);
        if (existingGoogleLink) {
            throw new Error('This Google account is already linked to another user.');
        }

        // Check if the googleEmail is linked to another account (other than the current userId's existing email)
        const userByGoogleEmail = db.prepare('SELECT * FROM Users WHERE email = ? AND id != ?').get(googleEmail, userId);
        if (userByGoogleEmail && userByGoogleEmail.google_id && userByGoogleEmail.google_id !== googleId) {
            throw new Error(`The email ${googleEmail} is associated with a different Google account.`);
        }
         // If the target user's current email is different from googleEmail, and googleEmail is already in use by another user (that is not the current user)
        const currentUser = db.prepare('SELECT * FROM Users WHERE id = ?').get(userId);
        if (currentUser.email !== googleEmail) {
           const conflictingEmailUser = db.prepare('SELECT * FROM Users WHERE email = ? AND id != ?').get(googleEmail, userId);
           if (conflictingEmailUser) {
               throw new Error(`The email ${googleEmail} from Google is already in use by another account.`);
           }
        }


        const stmt = db.prepare(
            'UPDATE Users SET google_id = ?, email = ?, display_name = COALESCE(?, display_name), last_login_at = CURRENT_TIMESTAMP WHERE id = ?'
        );
        // We update the user's email to the Google email, as it's verified by Google.
        // COALESCE is used for display_name to keep existing if Google one is null/empty.
        const info = stmt.run(googleId, googleEmail, googleDisplayName, userId);
        if (info.changes === 0) {
            throw new Error('User not found or no changes made.');
        }
        console.log(`Linked Google ID ${googleId} to user ID ${userId}. Email updated to ${googleEmail}.`);
        return info.changes;
    } catch (error) {
        console.error(`Error in linkGoogleAccount (UserID: ${userId}, GoogleID: ${googleId}):`, error);
        throw error;
    }
}

async function setUserPassword({ userId, password }) {
    const db = getDB();
    try {
        const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
        const stmt = db.prepare('UPDATE Users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        const info = stmt.run(hashedPassword, userId);
        if (info.changes === 0) {
            throw new Error('User not found or password not updated.');
        }
        console.log(`Password updated for user ID ${userId}.`);
        return info.changes;
    } catch (error) {
        console.error(`Error in setUserPassword (UserID: ${userId}):`, error);
        throw error;
    }
}

// --- Schedule DB Functions ---

function addSchedule({ managedRuleId, userId, cronExpression, actionToPerform, isEnabled = true }) {
    const db = getDB();
    try {
        const stmt = db.prepare(
            'INSERT INTO Schedules (managed_rule_id, user_id, cron_expression, action_to_perform, is_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        );
        const info = stmt.run(managedRuleId, userId, cronExpression, actionToPerform, isEnabled ? 1 : 0);
        console.log(`Added schedule ID ${info.lastInsertRowid} for rule ${managedRuleId}, user ${userId}.`);
        return { id: info.lastInsertRowid, managedRuleId, userId, cronExpression, actionToPerform, isEnabled };
    } catch (error) {
        console.error(`Error adding schedule for rule ${managedRuleId}, user ${userId}:`, error);
        throw error;
    }
}

function getScheduleById({ scheduleId, userId }) {
    const db = getDB();
    try {
        // Optionally join with ManagedRules to get rule description if needed often
        const stmt = db.prepare('SELECT s.*, mr.description as managed_rule_description, mr.opnsense_rule_uuid FROM Schedules s JOIN ManagedRules mr ON s.managed_rule_id = mr.id WHERE s.id = ? AND s.user_id = ?');
        const schedule = stmt.get(scheduleId, userId);
        return schedule ? { ...schedule, is_enabled: !!schedule.is_enabled } : undefined;
    } catch (error) {
        console.error(`Error getting schedule ID ${scheduleId} for user ${userId}:`, error);
        throw error;
    }
}

function getAllSchedulesForUser({ userId }) {
    const db = getDB();
    try {
        const stmt = db.prepare('SELECT s.*, mr.description as managed_rule_description, mr.opnsense_rule_uuid FROM Schedules s JOIN ManagedRules mr ON s.managed_rule_id = mr.id WHERE s.user_id = ? ORDER BY s.created_at DESC');
        const schedules = stmt.all(userId);
        return schedules.map(s => ({ ...s, is_enabled: !!s.is_enabled }));
    } catch (error) {
        console.error(`Error getting all schedules for user ${userId}:`, error);
        throw error;
    }
}

function getAllActiveSchedules() {
    const db = getDB();
    try {
        // This query needs to join with ManagedRules to get opnsense_rule_uuid for the job
        const stmt = db.prepare(`
            SELECT s.*, mr.opnsense_rule_uuid, mr.description as managed_rule_description 
            FROM Schedules s
            JOIN ManagedRules mr ON s.managed_rule_id = mr.id
            WHERE s.is_enabled = 1
        `);
        const schedules = stmt.all();
        return schedules.map(s => ({ ...s, is_enabled: !!s.is_enabled }));
    } catch (error) {
        console.error("Error getting all active schedules:", error);
        throw error;
    }
}

function updateSchedule({ scheduleId, userId, cronExpression, actionToPerform, isEnabled }) {
    const db = getDB();
    let query = 'UPDATE Schedules SET updated_at = CURRENT_TIMESTAMP';
    const params = [];

    if (cronExpression !== undefined) {
        query += ', cron_expression = ?';
        params.push(cronExpression);
    }
    if (actionToPerform !== undefined) {
        query += ', action_to_perform = ?';
        params.push(actionToPerform);
    }
    if (isEnabled !== undefined) {
        query += ', is_enabled = ?';
        params.push(isEnabled ? 1 : 0);
    }
    
    query += ' WHERE id = ? AND user_id = ?';
    params.push(scheduleId, userId);

    if (params.length <= 2) { // Only scheduleId and userId, no actual fields to update
        console.warn(`UpdateSchedule called for ID ${scheduleId} without any fields to update.`);
        return 0; // No changes made
    }

    try {
        const stmt = db.prepare(query);
        const info = stmt.run(...params);
        console.log(`Updated schedule ID ${scheduleId} for user ${userId}, changes: ${info.changes}`);
        return info.changes;
    } catch (error) {
        console.error(`Error updating schedule ID ${scheduleId} for user ${userId}:`, error);
        throw error;
    }
}

function removeSchedule({ scheduleId, userId }) {
    const db = getDB();
    try {
        const stmt = db.prepare('DELETE FROM Schedules WHERE id = ? AND user_id = ?');
        const info = stmt.run(scheduleId, userId);
        console.log(`Removed schedule ID ${scheduleId} for user ${userId}, changes: ${info.changes}`);
        return info.changes;
    } catch (error) {
        console.error(`Error removing schedule ID ${scheduleId} for user ${userId}:`, error);
        throw error;
    }
}

function updateScheduleLastTriggered(scheduleId) {
    const db = getDB();
    try {
        const stmt = db.prepare('UPDATE Schedules SET last_triggered_at = CURRENT_TIMESTAMP WHERE id = ?');
        const info = stmt.run(scheduleId);
        if (info.changes > 0) {
            // console.log(`Updated last_triggered_at for schedule ID ${scheduleId}.`); // Can be noisy
        }
        return info.changes;
    } catch (error) {
        console.error(`Error updating last_triggered_at for schedule ID ${scheduleId}:`, error);
        throw error;
    }
}


/**
 * Finds a user by their primary key (id).
 * @param {number} id The user's primary key.
 * @returns {object|undefined} The user object or undefined if not found.
 */
function getUserById(id) {
    const db = getDB();
    try {
        const stmt = db.prepare('SELECT * FROM Users WHERE id = ?');
        const user = stmt.get(id);
        return user ? { ...user, is_admin: !!user.is_admin } : undefined; // Convert boolean
    } catch (error) {
        console.error(`Error in getUserById (ID: ${id}):`, error);
        throw error;
    }
}

// --- Invitation DB Functions ---
const { v4: uuidv4 } = require('uuid'); // For generating unique codes

/**
 * Creates a new invitation code.
 * @param {object} params
 * @param {number} params.adminUserId The ID of the admin user creating the invitation.
 * @returns {string} The generated invitation code.
 */
function createInvitationCode({ adminUserId }) {
    const db = getDB();
    const newCode = uuidv4(); // Generate a UUID for the code
    try {
        const stmt = db.prepare(
            'INSERT INTO Invitations (code, created_by_user_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
        );
        const info = stmt.run(newCode, adminUserId);
        console.log(`Invitation code '${newCode}' created by admin ${adminUserId}, ID: ${info.lastInsertRowid}`);
        return newCode;
    } catch (error) {
        // It's extremely unlikely to have a UUID collision, but handle it defensively
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            console.warn("UUID collision for invitation code (highly unlikely). Retrying might be an option or just error out.");
            throw new Error("Failed to generate a unique invitation code. Please try again.");
        }
        console.error(`Error creating invitation code (AdminID: ${adminUserId}):`, error);
        throw error;
    }
}

/**
 * Retrieves an invitation by its code.
 * @param {string} code The invitation code.
 * @returns {object|undefined} The invitation object or undefined if not found.
 */
function getInvitationByCode(code) {
    const db = getDB();
    try {
        const stmt = db.prepare('SELECT * FROM Invitations WHERE code = ?');
        const invitation = stmt.get(code);
        return invitation ? { ...invitation, is_used: !!invitation.is_used } : undefined; // Convert boolean
    } catch (error) {
        console.error(`Error getting invitation by code (Code: ${code}):`, error);
        throw error;
    }
}

/**
 * Marks an invitation code as used.
 * @param {string} code The invitation code to mark as used.
 * @param {number} userIdThe ID of the user who used the code.
 * @returns {number} The number of rows changed (should be 1 if successful).
 */
function markInvitationAsUsed(code, userId) {
    const db = getDB();
    try {
        const stmt = db.prepare('UPDATE Invitations SET is_used = 1, used_by_user_id = ? WHERE code = ? AND is_used = 0');
        const info = stmt.run(userId, code);
        if (info.changes > 0) {
            console.log(`Invitation code '${code}' marked as used by user ${userId}.`);
        } else {
            // This could happen if the code was already used or doesn't exist.
            // getInvitationByCode should be called first to check validity.
            console.warn(`Invitation code '${code}' not found or already used when trying to mark as used for user ${userId}.`);
        }
        return info.changes;
    } catch (error) {
        console.error(`Error marking invitation as used (Code: ${code}, UserID: ${userId}):`, error);
        throw error;
    }
}

/**
 * Retrieves all invitation codes, their status, and creator information.
 * (Primarily for admin UI)
 * @returns {Array<object>} An array of invitation objects.
 */
function getAllInvitations() {
    const db = getDB();
    try {
        // Join with Users table to get creator's email/name if needed
        const stmt = db.prepare(`
            SELECT i.*, u.email as created_by_email 
            FROM Invitations i 
            LEFT JOIN Users u ON i.created_by_user_id = u.id
            ORDER BY i.created_at DESC
        `);
        const invitations = stmt.all();
        return invitations.map(inv => ({ ...inv, is_used: !!inv.is_used }));
    } catch (error) {
        console.error("Error getting all invitations:", error);
        throw error;
    }
}

/**
 * Counts the total number of users in the Users table.
 * @returns {number} The total number of users.
 */
function countUsers() {
    const db = getDB();
    try {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM Users');
        const result = stmt.get();
        return result.count;
    } catch (error) {
        console.error("Error in countUsers:", error);
        throw error;
    }
}

/**
 * Promotes a user to an admin.
 * @param {number} userId The ID of the user to promote.
 * @returns {number} The number of rows changed (should be 1 if successful).
 */
function promoteUserToAdmin(userId) {
    const db = getDB();
    try {
        const stmt = db.prepare('UPDATE Users SET is_admin = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        const info = stmt.run(userId);
        if (info.changes > 0) {
            console.log(`User ${userId} promoted to admin.`);
        } else {
            console.warn(`User ${userId} not found or no change made during admin promotion.`);
        }
        return info.changes;
    } catch (error) {
        console.error(`Error in promoteUserToAdmin (UserID: ${userId}):`, error);
        throw error;
    }
}
