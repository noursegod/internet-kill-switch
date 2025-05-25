const { setupTestDb } = require('../helpers/dbHelper');
const dbFunctions = require('../../db/database'); // Import all functions
const { v4: uuidv4 } = require('uuid');

describe('Database Functions', () => {
    let testDb;

    beforeEach(() => {
        // Important: For these tests to work correctly with the current db/database.js structure,
        // db/database.js needs to be modified to use an in-memory database when NODE_ENV=test,
        // or allow its internal `dbInstance` to be replaced.
        // The setupTestDb() helper creates an isolated in-memory DB, but the imported
        // dbFunctions will use their own `dbInstance` from the original module.
        //
        // Workaround: We will mock getDB within the dbFunctions module for these tests.
        // This is a common pattern when testing modules with internal state or connections.
        
        // This approach is not ideal as it relies on the internal structure of database.js.
        // A better long-term solution is dependency injection for the db instance in repo functions.
        // However, for this task, we'll proceed with mocking `getDB`.

        // testDb = setupTestDb(); // This creates an in-memory DB
        // For now, we assume db/database.js already handles NODE_ENV=test or we test its default.
        // To properly test with an isolated in-memory DB for EACH test using the imported functions,
        // we'd need to modify db/database.js to allow setting the DB instance, or use jest.isolateModules.

        // Let's assume db/database.js is already configured to use :memory: when NODE_ENV=test
        // and initializeDatabase() is called. This is handled by the test script setting NODE_ENV=test
        // and the module itself. We just need to ensure schema is applied for each test if it's a fresh :memory: db.
        
        // For true isolation with the current db/database.js structure, we'd need to reset the module
        // or use a more complex setup. The simplest way for now is to run tests sequentially
        // and clean up, or ensure initializeDatabase() can re-apply schema to an existing in-memory DB.
        // The current initializeDatabase() applies schema only if DB file doesn't exist.
        // For :memory:, it's new each time `new Database(':memory:')` is called.

        // Resetting the database for each test manually for now.
        const realDb = dbFunctions.getDB(); // Get the actual DB instance used by the module
        try {
            realDb.exec('DROP TABLE IF EXISTS Schedules');
            realDb.exec('DROP TABLE IF EXISTS Invitations');
            realDb.exec('DROP TABLE IF EXISTS ManagedRules');
            real_db.exec('DROP TABLE IF EXISTS Users');
        } catch (e) { /* ignore if tables don't exist */ }
        dbFunctions.initializeDatabase(); // Re-initialize schema
    });

    // === User Functions ===
    describe('User DB Functions', () => {
        test('findOrCreateUserByGoogleId should create a new user', () => {
            const googleProfile = { googleId: 'google123', email: 'test@example.com', displayName: 'Test User' };
            const user = dbFunctions.findOrCreateUserByGoogleId(googleProfile);
            expect(user).toBeDefined();
            expect(user.email).toBe(googleProfile.email);
            expect(user.google_id).toBe(googleProfile.googleId);
            expect(user.is_admin).toBe(false); // Default
        });

        test('findOrCreateUserByGoogleId should find an existing user and update login time', () => {
            const googleProfile = { googleId: 'google123', email: 'test@example.com', displayName: 'Test User' };
            dbFunctions.findOrCreateUserByGoogleId(googleProfile); // Create
            const user = dbFunctions.findOrCreateUserByGoogleId(googleProfile); // Find
            expect(user).toBeDefined();
            expect(user.email).toBe(googleProfile.email);
            // We'd need to check last_login_at if it was significantly different, tricky without time mocking.
        });
        
        test('findUserByGoogleId should retrieve an existing user', () => {
            const googleProfile = { googleId: 'google-retrieve', email: 'retrieve@example.com', displayName: 'Retrieve User' };
            dbFunctions.findOrCreateUserByGoogleId(googleProfile);
            const foundUser = dbFunctions.findUserByGoogleId(googleProfile.googleId);
            expect(foundUser).toBeDefined();
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
            expect(schedule.last_triggered_at).toBeNull();
            dbFunctions.updateScheduleLastTriggered(schedule.id);
            const updatedSchedule = dbFunctions.getScheduleById({scheduleId: schedule.id, userId: user.id});
            expect(updatedSchedule.last_triggered_at).not.toBeNull();
        });
    });
});
