const dbFunctions = require('../../db/database'); // Path to the actual database functions
const { setupTestDb } = require('../helpers/dbHelper');

// Hold the test database instance
let testDb;

// Mock the getDB function from the database module to return our testDb
jest.mock('../../db/database', () => {
    const originalModule = jest.requireActual('../../db/database');
    return {
        ...originalModule,
        // Override getDB to return the testDb instance when it's set.
        // This allows setSetting, getSetting, getAllSettings to use the in-memory test DB.
        getDB: () => testDb,
    };
});

describe('Application Settings DB Functions (using better-sqlite3)', () => {
    beforeAll(() => {
        // Set up a new in-memory database instance for all tests in this suite
        testDb = setupTestDb(); 
        // At this point, any call to dbFunctions.getDB() within the scope of these tests
        // will receive the testDb instance due to the jest.mock above.
    });

    beforeEach(() => {
        // Clear the AppSettings table before each test to ensure isolation
        try {
            testDb.prepare('DELETE FROM AppSettings').run();
        } catch (error) {
            console.error("Error clearing AppSettings table:", error);
            // Optionally, re-throw or handle to ensure tests don't run in a dirty state
            throw error;
        }
    });

    afterAll(() => {
        // Close the test database connection
        if (testDb) {
            testDb.close();
        }
    });

    test('setSetting should insert a new setting', () => {
        const setResult = dbFunctions.setSetting('testKey', 'testValue');
        expect(setResult).toBe(true); // Assuming setSetting returns true on success

        const row = testDb.prepare('SELECT value FROM AppSettings WHERE key = ?').get('testKey');
        expect(row).toBeDefined();
        expect(row.value).toBe('testValue');
    });

    test('setSetting should update an existing setting', () => {
        dbFunctions.setSetting('testKey', 'initialValue'); // Insert
        const updateResult = dbFunctions.setSetting('testKey', 'updatedValue'); // Update
        expect(updateResult).toBe(true);

        const row = testDb.prepare('SELECT value FROM AppSettings WHERE key = ?').get('testKey');
        expect(row).toBeDefined();
        expect(row.value).toBe('updatedValue');
    });
    
    test('setSetting should handle different data types by storing them as strings', () => {
        dbFunctions.setSetting('numberKey', 123);
        let row = testDb.prepare('SELECT value FROM AppSettings WHERE key = ?').get('numberKey');
        expect(row.value).toBe('123'); // Values are stored as TEXT

        dbFunctions.setSetting('booleanKey', true);
        row = testDb.prepare('SELECT value FROM AppSettings WHERE key = ?').get('booleanKey');
        expect(row.value).toBe('true');
    });

    test('getSetting should retrieve an existing setting', () => {
        dbFunctions.setSetting('testKey', 'specificValue');
        const value = dbFunctions.getSetting('testKey');
        expect(value).toBe('specificValue');
    });

    test('getSetting should return null for a non-existent key', () => {
        const value = dbFunctions.getSetting('nonExistentKey');
        expect(value).toBeNull();
    });

    test('getAllSettings should return an empty object if no settings are present', () => {
        const settings = dbFunctions.getAllSettings();
        expect(settings).toEqual({});
    });

    test('getAllSettings should return all settings as an object', () => {
        dbFunctions.setSetting('key1', 'value1');
        dbFunctions.setSetting('key2', 'value2');
        dbFunctions.setSetting('key3', 'anotherValue');

        const settings = dbFunctions.getAllSettings();
        expect(settings).toEqual({
            key1: 'value1',
            key2: 'value2',
            key3: 'anotherValue',
        });
    });
    
    test('setSetting should correctly update created_at and updated_at timestamps', () => {
        // Insert
        dbFunctions.setSetting('timestampTestKey', 'initial');
        const initialRow = testDb.prepare('SELECT created_at, updated_at FROM AppSettings WHERE key = ?').get('timestampTestKey');
        expect(initialRow.created_at).toBeDefined();
        expect(initialRow.updated_at).toBeDefined();
        expect(initialRow.created_at).toEqual(initialRow.updated_at);

        // Wait a bit to ensure timestamps can differ if resolution allows
        return new Promise(resolve => setTimeout(() => {
            // Update
            dbFunctions.setSetting('timestampTestKey', 'updated');
            const updatedRow = testDb.prepare('SELECT created_at, updated_at FROM AppSettings WHERE key = ?').get('timestampTestKey');
            
            expect(updatedRow.created_at).toEqual(initialRow.created_at); // created_at should not change
            expect(updatedRow.updated_at).not.toEqual(initialRow.updated_at); // updated_at should change
            // Basic check that updated_at is a valid timestamp string (format depends on CURRENT_TIMESTAMP)
            expect(typeof updatedRow.updated_at).toBe('string');
            expect(updatedRow.updated_at.length).toBeGreaterThan(0); 
            resolve();
        }, 50)); // 50ms delay; adjust if needed for timestamp resolution
    });
});
