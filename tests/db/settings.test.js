const dbFunctionsToTest = require('../../db/database');
const { setupTestDb } = require('../helpers/dbHelper');

// Use an object handle for the DB instance so the mock can close over the object
// and access the instance property after it's assigned in beforeAll.
const dbHandle = { instance: null };

jest.mock('../../db/database', () => {
    const originalModule = jest.requireActual('../../db/database');
    return {
        ...originalModule,
        getDB: () => {
            if (!dbHandle.instance) {
                // This error will correctly propagate if tests try to use DB functions
                // before the DB is set up in beforeAll.
                throw new Error("Test DB instance (dbHandle.instance) is not set. Check test setup.");
            }
            return dbHandle.instance;
        },
        initializeDatabase: jest.fn(), // Mock to prevent original from running
    };
});

describe('Application Settings DB Functions (using better-sqlite3)', () => {
    beforeAll(() => {
        // Assign the setup DB to the property of the handle
        dbHandle.instance = setupTestDb();
    });

    beforeEach(() => {
        // Clear the AppSettings table before each test to ensure isolation
        try {
            dbHandle.instance.prepare('DELETE FROM AppSettings').run();
        } catch (error) {
            console.error("Error clearing AppSettings table:", error);
            // Optionally, re-throw or handle to ensure tests don't run in a dirty state
            throw error;
        }
    });

    afterAll(() => {
        // Close the test database connection
        if (dbHandle.instance) {
            dbHandle.instance.close();
            dbHandle.instance = null; // Clear the handle
        }
    });

    test('setSetting should insert a new setting', () => {
        const setResult = dbFunctionsToTest.setSetting('testKey', 'testValue');
        expect(setResult).toBe(true);

        const row = dbHandle.instance.prepare('SELECT value FROM AppSettings WHERE key = ?').get('testKey');
        expect(row).toBeDefined();
        expect(row.value).toBe('testValue');
    });

    test('setSetting should update an existing setting', () => {
        dbFunctionsToTest.setSetting('testKey', 'initialValue');
        const updateResult = dbFunctionsToTest.setSetting('testKey', 'updatedValue');
        expect(updateResult).toBe(true);

        const row = dbHandle.instance.prepare('SELECT value FROM AppSettings WHERE key = ?').get('testKey');
        expect(row).toBeDefined();
        expect(row.value).toBe('updatedValue');
    });
    
    test('setSetting should handle different data types by storing them as strings', () => {
        dbFunctionsToTest.setSetting('numberKey', 123);
        let row = dbHandle.instance.prepare('SELECT value FROM AppSettings WHERE key = ?').get('numberKey');
        expect(row.value).toBe('123');

        dbFunctionsToTest.setSetting('booleanKey', true);
        row = dbHandle.instance.prepare('SELECT value FROM AppSettings WHERE key = ?').get('booleanKey');
        expect(row.value).toBe('true');
    });

    test('getSetting should retrieve an existing setting', () => {
        dbFunctionsToTest.setSetting('testKey', 'specificValue');
        const value = dbFunctionsToTest.getSetting('testKey');
        expect(value).toBe('specificValue');
    });

    test('getSetting should return null for a non-existent key', () => {
        const value = dbFunctionsToTest.getSetting('nonExistentKey');
        expect(value).toBeNull();
    });

    test('getAllSettings should return an empty object if no settings are present', () => {
        const settings = dbFunctionsToTest.getAllSettings();
        expect(settings).toEqual({});
    });

    test('getAllSettings should return all settings as an object', () => {
        dbFunctionsToTest.setSetting('key1', 'value1');
        dbFunctionsToTest.setSetting('key2', 'value2');
        dbFunctionsToTest.setSetting('key3', 'anotherValue');

        const settings = dbFunctionsToTest.getAllSettings();
        expect(settings).toEqual({
            key1: 'value1',
            key2: 'value2',
            key3: 'anotherValue',
        });
    });
    
    test('setSetting should correctly update created_at and updated_at timestamps', () => {
        dbFunctionsToTest.setSetting('timestampTestKey', 'initial');
        const initialRow = dbHandle.instance.prepare('SELECT created_at, updated_at FROM AppSettings WHERE key = ?').get('timestampTestKey');
        expect(initialRow.created_at).toBeDefined();
        expect(initialRow.updated_at).toBeDefined();
        expect(initialRow.created_at).toEqual(initialRow.updated_at);

        return new Promise(resolve => setTimeout(() => {
            dbFunctionsToTest.setSetting('timestampTestKey', 'updated');
            const updatedRow = dbHandle.instance.prepare('SELECT created_at, updated_at FROM AppSettings WHERE key = ?').get('timestampTestKey');
            
            expect(updatedRow.created_at).toEqual(initialRow.created_at);
            expect(updatedRow.updated_at).not.toEqual(initialRow.updated_at);
            expect(typeof updatedRow.updated_at).toBe('string');
            expect(updatedRow.updated_at.length).toBeGreaterThan(0); 
            resolve();
        }, 50));
    });
});
