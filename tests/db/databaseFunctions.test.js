const { setupTestDb } = require('../helpers/dbHelper');
const dbFunctions = require('../../db/database'); // These are the functions we want to test
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

// Use an object handle for the DB instance, similar to settings.test.js
const dbHandle = { instance: null };

jest.mock('../../db/database', () => {
    const originalModule = jest.requireActual('../../db/database');
    return {
        ...originalModule,
        getDB: () => {
            if (!dbHandle.instance) {
                throw new Error("Test DB instance (dbHandle.instance) is not set in databaseFunctions.test.js. Check test setup.");
            }
            return dbHandle.instance;
        },
        initializeDatabase: jest.fn(), // Mock to prevent original from running and creating files
    };
});

describe('Database Functions (CRUD operations)', () => { // Updated describe block
    beforeAll(() => { // Changed from beforeEach to beforeAll for DB setup
        dbHandle.instance = setupTestDb();
    });

    beforeEach(() => {
        // Clear all relevant tables before each test
        try {
            dbHandle.instance.exec('DELETE FROM Schedules');
            dbHandle.instance.exec('DELETE FROM Invitations');
            dbHandle.instance.exec('DELETE FROM AppSettings'); // Added AppSettings
            dbHandle.instance.exec('DELETE FROM ManagedRules');
            dbHandle.instance.exec('DELETE FROM Users');
        } catch (e) { 
            console.error("Error clearing tables in databaseFunctions.test.js:", e.message);
            // If tables don't exist on first run of a test, that's fine.
            // The schema should ensure they exist.
        }
    });

    afterAll(() => { // Added afterAll to close DB connection
        if (dbHandle.instance) {
            dbHandle.instance.close();
            dbHandle.instance = null;
        }
    });

    // === User Functions ===
    describe('User DB Functions', () => {
        test('findOrCreateUserByGoogleId should create a new user', () => {
            const googleProfile = { googleId: 'google123', email: 'test@example.com', displayName: 'Test User' };
            const user = dbFunctions.findOrCreateUserByGoogleId(googleProfile); // dbFunctions here will use the mocked getDB
            expect(user).toBeDefined();
            expect(user.email).toBe(googleProfile.email);
            expect(user.google_id).toBe(googleProfile.googleId);
            expect(user.is_admin).toBe(false); // Default
        });
        
        // Note: findUserByGoogleId is not explicitly in the new function list, 
        // but it's related and used by existing tests. Keeping a basic test for it.
        test('findUserByGoogleId should retrieve an existing user by Google ID', () => {
            const googleProfile = { googleId: 'google-retrieve', email: 'retrieve@example.com', displayName: 'Retrieve User' };
            dbFunctions.findOrCreateUserByGoogleId(googleProfile); // Create the user
            const foundUser = dbFunctions.findUserByGoogleId(googleProfile.googleId); // Test the find function
            expect(foundUser).toBeDefined();
            expect(foundUser.google_id).toBe(googleProfile.googleId);
            expect(foundUser.email).toBe(googleProfile.email);
        });


        test('getUserById should retrieve an existing user by ID', () => {
            const newUser = dbFunctions.findOrCreateUserByGoogleId({ googleId: 'userbyid', email: 'userbyid@example.com', displayName: 'User By ID' });
            const foundUser = dbFunctions.getUserById(newUser.id);
            expect(foundUser).toBeDefined();
            expect(foundUser.id).toBe(newUser.id);
        });

        test('countUsers should return the correct number of users', () => {
            expect(dbFunctions.countUsers()).toBe(0);
            dbFunctions.findOrCreateUserByGoogleId({ googleId: 'user1', email: 'user1@example.com', displayName: 'User 1' });
            expect(dbFunctions.countUsers()).toBe(1);
            dbFunctions.findOrCreateUserByGoogleId({ googleId: 'user2', email: 'user2@example.com', displayName: 'User 2' });
            expect(dbFunctions.countUsers()).toBe(2);
        });

        test('promoteUserToAdmin should set is_admin to true', () => {
            const user = dbFunctions.findOrCreateUserByGoogleId({ googleId: 'adminpromote', email: 'adminpromote@example.com', displayName: 'Admin Promote' });
            expect(user.is_admin).toBe(false);
            dbFunctions.promoteUserToAdmin(user.id);
            const promotedUser = dbFunctions.getUserById(user.id);
            expect(promotedUser.is_admin).toBe(true);
        });
    });

    describe('User Authentication DB Functions', () => {
        // beforeEach already clears Users table

        describe('createUser', () => {
            test('should create a new user with a hashed password', async () => {
                const userData = { email: 'local@example.com', password: 'password123', displayName: 'Local User' };
                const user = await dbFunctions.createUser(userData);
                expect(user).toBeDefined();
                expect(user.email).toBe(userData.email);
                expect(user.password).toBeDefined();
                expect(user.password).not.toBe(userData.password); // Ensure it's hashed
                const isValidPassword = await bcrypt.compare(userData.password, user.password);
                expect(isValidPassword).toBe(true);
                expect(user.google_id).toBeNull();
            });

            test('should throw error if email already exists', async () => {
                const userData = { email: 'conflict@example.com', password: 'password123' };
                await dbFunctions.createUser(userData);
                await expect(dbFunctions.createUser(userData)).rejects.toThrow('User with this email already exists.');
            });
        });

        describe('findUserByEmail', () => {
            test('should find an existing user by email', async () => {
                const userData = { email: 'findme@example.com', password: 'password123' };
                await dbFunctions.createUser(userData);
                const foundUser = dbFunctions.findUserByEmail(userData.email);
                expect(foundUser).toBeDefined();
                expect(foundUser.email).toBe(userData.email);
            });

            test('should return undefined if user does not exist', () => {
                const foundUser = dbFunctions.findUserByEmail('donotexist@example.com');
                expect(foundUser).toBeUndefined();
            });
        });

        describe('verifyPassword', () => {
            let userId;
            beforeEach(async () => {
                const user = await dbFunctions.createUser({ email: 'verify@example.com', password: 'correctpassword' });
                userId = user.id;
            });

            test('should return true for a correct password', async () => {
                const user = dbFunctions.getUserById(userId);
                const isValid = await dbFunctions.verifyPassword('correctpassword', user.password);
                expect(isValid).toBe(true);
            });

            test('should return false for an incorrect password', async () => {
                const user = dbFunctions.getUserById(userId);
                const isValid = await dbFunctions.verifyPassword('wrongpassword', user.password);
                expect(isValid).toBe(false);
            });
            
            test('should return false if user has no password set (null password hash)', async () => {
                // Create user without local password (e.g. via Google first)
                const googleUser = dbFunctions.findOrCreateUserByGoogleId({ googleId: 'gp123', email: 'gp@example.com', displayName: 'Google Passwordless' });
                // Manually ensure password is null for this test case if findOrCreate doesn't guarantee it
                dbHandle.instance.prepare('UPDATE Users SET password = NULL WHERE id = ?').run(googleUser.id);
                const userWithoutPassword = dbFunctions.getUserById(googleUser.id);
                
                expect(userWithoutPassword.password).toBeNull();
                const isValid = await dbFunctions.verifyPassword('anypassword', userWithoutPassword.password);
                expect(isValid).toBe(false);
            });
        });

        describe('setUserPassword', () => {
            test('should update the password for a user', async () => {
                const user = await dbFunctions.createUser({ email: 'setpass@example.com', password: 'oldpassword' });
                await dbFunctions.setUserPassword({ userId: user.id, password: 'newpassword' });
                const updatedUser = dbFunctions.getUserById(user.id);
                const isOldPasswordValid = await bcrypt.compare('oldpassword', updatedUser.password);
                expect(isOldPasswordValid).toBe(false);
                const isNewPasswordValid = await bcrypt.compare('newpassword', updatedUser.password);
                expect(isNewPasswordValid).toBe(true);
            });

            test('should throw error if user not found', async () => {
                await expect(dbFunctions.setUserPassword({ userId: 999, password: 'newpassword' })).rejects.toThrow('User not found or password not updated.');
            });
        });
        
        describe('linkGoogleAccount', () => {
            let localUser;
            beforeEach(async () => {
                localUser = await dbFunctions.createUser({ email: 'linktest@example.com', password: 'password123', displayName: 'Link Test' });
            });

            test('should successfully link a Google account to an existing local user', async () => {
                const googleProfile = { userId: localUser.id, googleId: 'googlelink123', googleEmail: 'linktest@example.com', googleDisplayName: 'Link Test Google' };
                await dbFunctions.linkGoogleAccount(googleProfile);
                const updatedUser = dbFunctions.getUserById(localUser.id);
                expect(updatedUser.google_id).toBe(googleProfile.googleId);
                expect(updatedUser.display_name).toBe(googleProfile.googleDisplayName);
            });

            test('should update email if Google email is different and available', async () => {
                const googleProfile = { userId: localUser.id, googleId: 'googlelink123', googleEmail: 'newemail@example.com', googleDisplayName: 'Link Test Google' };
                await dbFunctions.linkGoogleAccount(googleProfile);
                const updatedUser = dbFunctions.getUserById(localUser.id);
                expect(updatedUser.email).toBe(googleProfile.googleEmail);
            });

            test('should throw error if Google ID is already linked to another user', async () => {
                const anotherUser = dbFunctions.findOrCreateUserByGoogleId({ googleId: 'existingGoogleId', email: 'another@example.com', displayName: 'Another Google User'});
                
                const googleProfile = { userId: localUser.id, googleId: 'existingGoogleId', googleEmail: 'linktest@example.com', googleDisplayName: 'Link Test Google' };
                await expect(dbFunctions.linkGoogleAccount(googleProfile)).rejects.toThrow('This Google account is already linked to another user.');
            });

            test('should throw error if Google email is used by another account', async () => {
                await dbFunctions.createUser({ email: 'conflictemail@example.com', password: 'password1'});
                const googleProfile = { userId: localUser.id, googleId: 'newGoogleIdForLocal', googleEmail: 'conflictemail@example.com', googleDisplayName: 'Link Test Google' };
                await expect(dbFunctions.linkGoogleAccount(googleProfile)).rejects.toThrow('The email conflictemail@example.com from Google is already in use by another account.');
            });
        });

        describe('findOrCreateUserByGoogleId (Updated Tests)', () => {
            test('Scenario 1: New user (neither email nor Google ID exists)', () => {
                const profile = { googleId: 'newG1', email: 'new1@example.com', displayName: 'New User 1' };
                const user = dbFunctions.findOrCreateUserByGoogleId(profile);
                expect(user).toBeDefined();
                expect(user.email).toBe(profile.email);
                expect(user.google_id).toBe(profile.googleId);
                expect(user.password).toBeNull();
            });

            test('Scenario 2: Existing Google ID (user logs in with Google again)', () => {
                const profile = { googleId: 'existingG2', email: 'existing2@example.com', displayName: 'Existing User 2' };
                dbFunctions.findOrCreateUserByGoogleId(profile); 
                const user = dbFunctions.findOrCreateUserByGoogleId({ ...profile, displayName: 'Updated Name' }); 
                expect(user.display_name).toBe('Updated Name');
                expect(user.google_id).toBe(profile.googleId);
                expect(user.email).toBe(profile.email); // Email should remain consistent
            });

            test('Scenario 3: Existing email, but no Google ID (local user, then Google login with same email)', async () => {
                const localEmail = 'localThenGoogle@example.com';
                const localUser = await dbFunctions.createUser({ email: localEmail, password: 'password123', displayName: 'Local Original' });
                
                const googleProfile = { googleId: 'googleForLocal', email: localEmail, displayName: 'Google Name' };
                const linkedUser = dbFunctions.findOrCreateUserByGoogleId(googleProfile);
                
                expect(linkedUser).toBeDefined();
                expect(linkedUser.id).toBe(localUser.id);
                expect(linkedUser.google_id).toBe(googleProfile.googleId);
                expect(linkedUser.email).toBe(localEmail);
                expect(linkedUser.display_name).toBe(googleProfile.displayName); 
                expect(linkedUser.password).toBeDefined(); 
            });

            test('Scenario 4: Email conflict (Google email belongs to another user with a different Google ID)', async () => {
                dbFunctions.findOrCreateUserByGoogleId({ googleId: 'gOriginal', email: 'conflictEmail@example.com', displayName: 'User A' });
                const conflictingProfile = { googleId: 'gNew', email: 'conflictEmail@example.com', displayName: 'User B' };
                // The implementation of findOrCreateUserByGoogleId throws if a user with the email exists and has a DIFFERENT google_id
                await expect(() => dbFunctions.findOrCreateUserByGoogleId(conflictingProfile)).toThrow('Email conflictEmail@example.com is already linked to a different Google account.');
            });
            
            test('Scenario 5: Google ID exists, email in profile is different, and that email is taken by another user', async () => {
                dbFunctions.findOrCreateUserByGoogleId({ googleId: 'gid1', email: 'userX@example.com', displayName: 'User X' });
                await dbFunctions.createUser({ email: 'userY@example.com', password: 'password'});
                
                const profileAttempt = { googleId: 'gid1', email: 'userY@example.com', displayName: 'User X Updated Profile' };
                // Current findOrCreateUserByGoogleId attempts to update the email for the user matching 'gid1'.
                // This will cause a UNIQUE constraint error because 'userY@example.com' is already taken.
                await expect(() => dbFunctions.findOrCreateUserByGoogleId(profileAttempt))
                    .toThrow(/UNIQUE constraint failed: Users.email/i);
            });
        });
    });

    // === ManagedRule Functions ===
    describe('ManagedRule DB Functions', () => {
        let user;
        beforeEach(() => {
            user = dbFunctions.findOrCreateUserByGoogleId({ googleId: 'ruleuser', email: 'ruleuser@example.com', displayName: 'Rule User' });
        });

        test('addManagedRule should add a new managed rule', () => {
            const ruleData = { uuid: uuidv4(), description: 'Test Rule 1', userId: user.id, desiredState: true };
            const addedRule = dbFunctions.addManagedRule(ruleData);
            expect(addedRule).toBeDefined();
            expect(addedRule.uuid).toBe(ruleData.uuid);
            
            const retrieved = dbFunctions.getManagedRuleByUuid({ uuid: ruleData.uuid, userId: user.id });
            expect(retrieved).toBeDefined();
            expect(retrieved.description).toBe('Test Rule 1');
            expect(retrieved.desired_state).toBe(true);
        });

        test('addManagedRule should throw error for duplicate UUID for same user', () => {
            const ruleData = { uuid: uuidv4(), description: 'Test Rule Dup', userId: user.id };
            dbFunctions.addManagedRule(ruleData);
            expect(() => dbFunctions.addManagedRule(ruleData)).toThrow(/already managed by this user/);
        });
        
        test('removeManagedRule should delete a rule', () => {
            const ruleData = { uuid: uuidv4(), description: 'To Delete', userId: user.id };
            dbFunctions.addManagedRule(ruleData);
            const changes = dbFunctions.removeManagedRule({ uuid: ruleData.uuid, userId: user.id });
            expect(changes).toBe(1);
            expect(dbFunctions.getManagedRuleByUuid({ uuid: ruleData.uuid, userId: user.id })).toBeUndefined();
        });

        test('getAllManagedRulesForUser should retrieve all rules for a user', () => {
            dbFunctions.addManagedRule({ uuid: uuidv4(), description: 'Rule A', userId: user.id });
            dbFunctions.addManagedRule({ uuid: uuidv4(), description: 'Rule B', userId: user.id });
            const rules = dbFunctions.getAllManagedRulesForUser({ userId: user.id });
            expect(rules.length).toBe(2);
        });

        test('updateManagedRuleDesiredState should update the state', () => {
            const ruleData = { uuid: uuidv4(), description: 'State Update Rule', userId: user.id, desiredState: false };
            dbFunctions.addManagedRule(ruleData);
            dbFunctions.updateManagedRuleDesiredState({ uuid: ruleData.uuid, userId: user.id, desiredState: true });
            const updatedRule = dbFunctions.getManagedRuleByUuid({ uuid: ruleData.uuid, userId: user.id });
            expect(updatedRule.desired_state).toBe(true);
        });

        test('updateManagedRuleTimer should set timer fields', () => {
            const ruleData = { uuid: uuidv4(), description: 'Timer Rule', userId: user.id };
            const addedRule = dbFunctions.addManagedRule(ruleData);
            const expiry = new Date(Date.now() + 3600000).toISOString();
            dbFunctions.updateManagedRuleTimer({ uuid: addedRule.uuid, userId: user.id, timerActiveUntil: expiry, timerActionOnExpiry: 'disable' });
            const updatedRule = dbFunctions.getManagedRuleByUuid({ uuid: addedRule.uuid, userId: user.id });
            expect(updatedRule.timer_active_until).toBe(expiry);
            expect(updatedRule.timer_action_on_expiry).toBe('disable');
        });

        test('getExpiredTimerRules should retrieve rules with past timer_active_until', async () => {
            const pastTime = new Date(Date.now() - 10000).toISOString(); // 10 seconds ago
            const futureTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

            const ruleExpired = dbFunctions.addManagedRule({ uuid: uuidv4(), description: 'Timer Expired', userId: user.id });
            dbFunctions.updateManagedRuleTimer({ uuid: ruleExpired.uuid, userId: user.id, timerActiveUntil: pastTime, timerActionOnExpiry: 'disable' });
            
            const ruleActive = dbFunctions.addManagedRule({ uuid: uuidv4(), description: 'Timer Active', userId: user.id });
            dbFunctions.updateManagedRuleTimer({ uuid: ruleActive.uuid, userId: user.id, timerActiveUntil: futureTime, timerActionOnExpiry: 'enable' });

            const ruleNoTimer = dbFunctions.addManagedRule({ uuid: uuidv4(), description: 'No Timer', userId: user.id });

            // Need to wait a moment for 'now' in the query to be after pastTime
            await new Promise(resolve => setTimeout(resolve, 50)); 

            const expiredRules = dbFunctions.getExpiredTimerRules();
            expect(expiredRules.length).toBe(1);
            expect(expiredRules[0].opnsense_rule_uuid).toBe(ruleExpired.uuid);
        });
    });

    // === Invitation Functions ===
    describe('Invitation DB Functions', () => {
        let adminUser;
        beforeEach(() => {
            adminUser = dbFunctions.findOrCreateUserByGoogleId({ googleId: 'admininv', email: 'admininv@example.com', displayName: 'Admin Inv' });
            dbFunctions.promoteUserToAdmin(adminUser.id); // Make this user an admin
        });

        test('createInvitationCode should generate a unique code', () => {
            const code1 = dbFunctions.createInvitationCode({ adminUserId: adminUser.id });
            expect(code1).toBeDefined();
            expect(typeof code1).toBe('string');
            const code2 = dbFunctions.createInvitationCode({ adminUserId: adminUser.id });
            expect(code2).not.toBe(code1);
        });

        test('getInvitationByCode should retrieve an invitation', () => {
            const code = dbFunctions.createInvitationCode({ adminUserId: adminUser.id });
            const invitation = dbFunctions.getInvitationByCode(code);
            expect(invitation).toBeDefined();
            expect(invitation.code).toBe(code);
            expect(invitation.is_used).toBe(false);
            expect(invitation.created_by_user_id).toBe(adminUser.id);
        });

        test('markInvitationAsUsed should mark a code as used', () => {
            const code = dbFunctions.createInvitationCode({ adminUserId: adminUser.id });
            const guestUser = dbFunctions.findOrCreateUserByGoogleId({ googleId: 'guest', email: 'guest@example.com', displayName: 'Guest' });
            
            const changes = dbFunctions.markInvitationAsUsed(code, guestUser.id);
            expect(changes).toBe(1);
            const usedInvitation = dbFunctions.getInvitationByCode(code);
            expect(usedInvitation.is_used).toBe(true);
            expect(usedInvitation.used_by_user_id).toBe(guestUser.id);
        });

        test('getAllInvitations should retrieve all invitations with creator email', () => {
            dbFunctions.createInvitationCode({ adminUserId: adminUser.id });
            dbFunctions.createInvitationCode({ adminUserId: adminUser.id });
            const invitations = dbFunctions.getAllInvitations();
            expect(invitations.length).toBe(2);
            expect(invitations[0].created_by_email).toBe(adminUser.email);
        });
    });

    // === Schedule Functions ===
    describe('Schedule DB Functions', () => {
        let user;
        let managedRule;
        beforeEach(() => {
            user = dbFunctions.findOrCreateUserByGoogleId({ googleId: 'scheduleuser', email: 'scheduleuser@example.com', displayName: 'Schedule User' });
            managedRule = dbFunctions.addManagedRule({ uuid: uuidv4(), description: 'Rule for Schedules', userId: user.id });
        });

        test('addSchedule should create a new schedule', () => {
            const scheduleData = { managedRuleId: managedRule.id, userId: user.id, cronExpression: '0 0 * * *', actionToPerform: 'enable' };
            const schedule = dbFunctions.addSchedule(scheduleData);
            expect(schedule).toBeDefined();
            expect(schedule.id).toBeGreaterThan(0);
            expect(schedule.cron_expression).toBe('0 0 * * *');
        });

        test('getScheduleById should retrieve a specific schedule for a user', () => {
            const scheduleData = { managedRuleId: managedRule.id, userId: user.id, cronExpression: '0 1 * * *', actionToPerform: 'disable' };
            const addedSchedule = dbFunctions.addSchedule(scheduleData);
            const retrieved = dbFunctions.getScheduleById({ scheduleId: addedSchedule.id, userId: user.id });
            expect(retrieved).toBeDefined();
            expect(retrieved.id).toBe(addedSchedule.id);
            expect(retrieved.managed_rule_description).toBe(managedRule.description);
        });

        test('getAllSchedulesForUser should list all schedules for a user', () => {
            dbFunctions.addSchedule({ managedRuleId: managedRule.id, userId: user.id, cronExpression: '0 2 * * *', actionToPerform: 'enable' });
            dbFunctions.addSchedule({ managedRuleId: managedRule.id, userId: user.id, cronExpression: '0 3 * * *', actionToPerform: 'disable' });
            const schedules = dbFunctions.getAllSchedulesForUser({ userId: user.id });
            expect(schedules.length).toBe(2);
        });
        
        test('getAllActiveSchedules should retrieve all enabled schedules', () => {
            dbFunctions.addSchedule({ managedRuleId: managedRule.id, userId: user.id, cronExpression: '0 4 * * *', actionToPerform: 'enable', isEnabled: true });
            dbFunctions.addSchedule({ managedRuleId: managedRule.id, userId: user.id, cronExpression: '0 5 * * *', actionToPerform: 'disable', isEnabled: false });
            const activeSchedules = dbFunctions.getAllActiveSchedules();
            expect(activeSchedules.length).toBe(1);
            expect(activeSchedules[0].cron_expression).toBe('0 4 * * *');
        });


        test('updateSchedule should modify an existing schedule', () => {
            const schedule = dbFunctions.addSchedule({ managedRuleId: managedRule.id, userId: user.id, cronExpression: '0 6 * * *', actionToPerform: 'enable', isEnabled: true });
            const changes = dbFunctions.updateSchedule({ scheduleId: schedule.id, userId: user.id, cronExpression: '0 7 * * *', isEnabled: false });
            expect(changes).toBe(1);
            const updated = dbFunctions.getScheduleById({ scheduleId: schedule.id, userId: user.id });
            expect(updated.cron_expression).toBe('0 7 * * *');
            expect(updated.is_enabled).toBe(false);
        });

        test('removeSchedule should delete a schedule', () => {
            const schedule = dbFunctions.addSchedule({ managedRuleId: managedRule.id, userId: user.id, cronExpression: '0 8 * * *', actionToPerform: 'disable' });
            const changes = dbFunctions.removeSchedule({ scheduleId: schedule.id, userId: user.id });
            expect(changes).toBe(1);
            expect(dbFunctions.getScheduleById({ scheduleId: schedule.id, userId: user.id })).toBeUndefined();
        });
        
        test('updateScheduleLastTriggered should update the timestamp', () => {
            const schedule = dbFunctions.addSchedule({ managedRuleId: managedRule.id, userId: user.id, cronExpression: '0 9 * * *', actionToPerform: 'enable' });
                    // last_triggered_at might not be part of the returned object from addSchedule, depending on implementation
                    // Let's fetch it to check initial state
                    let fetchedSchedule = dbFunctions.getScheduleById({scheduleId: schedule.id, userId: user.id});
                    expect(fetchedSchedule.last_triggered_at).toBeNull();
                    
            dbFunctions.updateScheduleLastTriggered(schedule.id);
            const updatedSchedule = dbFunctions.getScheduleById({scheduleId: schedule.id, userId: user.id});
            expect(updatedSchedule.last_triggered_at).not.toBeNull();
        });
    });
});
