const crypto = require('crypto');

// Mock the database module
jest.mock('../../db/database', () => ({
    getSetting: jest.fn(),
    getAllSettings: jest.fn(),
    initializeDatabase: jest.fn(), // Mock initializeDatabase as it's called early in app.js
}));

// Mock crypto.randomBytes
jest.mock('crypto', () => ({
    ...jest.requireActual('crypto'), // Import and retain default behavior
    randomBytes: jest.fn(),
}));


// Helper function to simulate the SESSION_SECRET prioritization logic from app.js
// This isolates the logic for testing.
const determineSessionSecret = (envSecret, dbSecret, isDbSetupComplete, defaultPlaceholder, generatedCryptoKey) => {
    let generatedTestSecret = null;
    if (!envSecret && !(isDbSetupComplete && dbSecret)) {
        if (!envSecret || envSecret === defaultPlaceholder) {
            if (!(isDbSetupComplete && dbSecret)) {
                generatedTestSecret = generatedCryptoKey; // Simulate crypto generation
            }
        }
    }
    return generatedTestSecret || (isDbSetupComplete && dbSecret) || envSecret || defaultPlaceholder;
};

// Helper function to simulate general config key prioritization
const determineConfigValue = (dbValue, envValue, isDbSetupComplete, defaultValue) => {
    if (isDbSetupComplete && dbValue !== undefined && dbValue !== null) { // Allow empty string from DB
        return dbValue;
    }
    if (envValue !== undefined && envValue !== null) { // Allow empty string from ENV
        return envValue;
    }
    return defaultValue;
};


describe('App Configuration Logic', () => {
    let app; // To hold the app instance if we load app.js
    let mockDatabase;

    const DEFAULT_PLACEHOLDER_TEST = "!!TEST_PLACEHOLDER!!";
    const GENERATED_CRYPTO_KEY_TEST = "test_generated_crypto_key";

    beforeEach(() => {
        // Reset mocks before each test
        jest.resetModules(); // Important to reset modules if app.js is re-required
        mockDatabase = require('../../db/database');
        crypto.randomBytes.mockReturnValue(Buffer.from(GENERATED_CRYPTO_KEY_TEST, 'hex'));
        
        // Reset process.env, but save original
        process.env.ORIGINAL_NODE_ENV = process.env.NODE_ENV;
        delete process.env.NODE_ENV; // allow test to set it if needed
    });

    afterEach(() => {
        // Restore process.env
        if (process.env.ORIGINAL_NODE_ENV) {
            process.env.NODE_ENV = process.env.ORIGINAL_NODE_ENV;
            delete process.env.ORIGINAL_NODE_ENV;
        } else {
            delete process.env.NODE_ENV;
        }
        jest.restoreAllMocks();
    });

    describe('isInitialSetupComplete (simulated via app.js loading)', () => {
        test('should return true if getSetting("initial_setup_complete") is "true"', () => {
            mockDatabase.getSetting.mockImplementation((key) => {
                if (key === 'initial_setup_complete') return 'true';
                return null;
            });
            // Load app.js to make its global functions available, including isInitialSetupComplete
            // This is tricky because app.js has side effects (like initializing DB, setting app.config)
            // We are relying on the mocks to control these side effects.
            app = require('../../app'); 
            expect(app.isInitialSetupComplete()).toBe(true);
        });

        test('should return false if getSetting("initial_setup_complete") is "false"', () => {
            mockDatabase.getSetting.mockImplementation((key) => {
                if (key === 'initial_setup_complete') return 'false';
                return null;
            });
            app = require('../../app');
            expect(app.isInitialSetupComplete()).toBe(false);
        });

        test('should return false if getSetting("initial_setup_complete") returns null', () => {
            mockDatabase.getSetting.mockImplementation((key) => {
                if (key === 'initial_setup_complete') return null;
                return null;
            });
            app = require('../../app');
            expect(app.isInitialSetupComplete()).toBe(false);
        });

        test('should return false and log error if getSetting throws an error', () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            mockDatabase.getSetting.mockImplementation((key) => {
                if (key === 'initial_setup_complete') throw new Error("DB error");
                return null;
            });
            app = require('../../app');
            expect(app.isInitialSetupComplete()).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error checking initial setup status"), expect.any(String));
            consoleErrorSpy.mockRestore();
        });
    });

    describe('SESSION_SECRET Prioritization (using helper)', () => {
        test('should use generated secret if nothing else is set and env is placeholder', () => {
            const secret = determineSessionSecret(DEFAULT_PLACEHOLDER_TEST, null, false, DEFAULT_PLACEHOLDER_TEST, GENERATED_CRYPTO_KEY_TEST);
            expect(secret).toBe(GENERATED_CRYPTO_KEY_TEST);
        });
        
        test('should use generated secret if env is undefined and no db secret', () => {
            const secret = determineSessionSecret(undefined, null, false, DEFAULT_PLACEHOLDER_TEST, GENERATED_CRYPTO_KEY_TEST);
            expect(secret).toBe(GENERATED_CRYPTO_KEY_TEST);
        });

        test('should use env secret if set and no db secret (even if placeholder initially suggested generation)', () => {
            const envSecretValue = "env_provided_secret";
            const secret = determineSessionSecret(envSecretValue, null, false, DEFAULT_PLACEHOLDER_TEST, GENERATED_CRYPTO_KEY_TEST);
            expect(secret).toBe(envSecretValue);
        });

        test('should use db secret if setup complete and db secret exists', () => {
            const dbSecretValue = "db_provided_secret";
            const secret = determineSessionSecret("env_secret", dbSecretValue, true, DEFAULT_PLACEHOLDER_TEST, GENERATED_CRYPTO_KEY_TEST);
            expect(secret).toBe(dbSecretValue);
        });
        
        test('should prioritize db secret over env secret when setup is complete', () => {
            const dbSecretValue = "db_secret_takes_priority";
            const envSecretValue = "env_secret_also_present";
            const secret = determineSessionSecret(envSecretValue, dbSecretValue, true, DEFAULT_PLACEHOLDER_TEST, GENERATED_CRYPTO_KEY_TEST);
            expect(secret).toBe(dbSecretValue);
        });

        test('should prioritize env secret over generated if db setup not complete', () => {
            const envSecretValue = "env_secret_no_db_setup";
            const secret = determineSessionSecret(envSecretValue, "db_secret_exists_but_not_complete", false, DEFAULT_PLACEHOLDER_TEST, GENERATED_CRYPTO_KEY_TEST);
            expect(secret).toBe(envSecretValue);
        });
        
        test('should not generate a secret if env secret is valid (not placeholder) even if no DB secret', () => {
             const envSecretValue = "valid_env_secret";
             // Simulate crypto.randomBytes not being called by checking if generatedTestSecret would be null
             let generatedTestSecret = null;
             if (!envSecretValue && !(false && null)) { // from app.js logic
                 if (!envSecretValue || envSecretValue === DEFAULT_PLACEHOLDER_TEST) {
                     if (!(false && null)) {
                         generatedTestSecret = GENERATED_CRYPTO_KEY_TEST;
                     }
                 }
             }
             expect(generatedTestSecret).toBeNull();
             const finalSecret = determineSessionSecret(envSecretValue, null, false, DEFAULT_PLACEHOLDER_TEST, GENERATED_CRYPTO_KEY_TEST);
             expect(finalSecret).toBe(envSecretValue);
        });

        test('should use placeholder if all other sources are unavailable or placeholders themselves and generation somehow fails (though helper assumes generation success)', () => {
            // This case implies generatedCryptoKey would be null/undefined if crypto.randomBytes failed or wasn't called
            const secret = determineSessionSecret(DEFAULT_PLACEHOLDER_TEST, null, false, DEFAULT_PLACEHOLDER_TEST, null);
            expect(secret).toBe(DEFAULT_PLACEHOLDER_TEST); // Falls back to env (placeholder), then to default (placeholder)
        });
    });

    describe('General Config Value Prioritization (using helper)', () => {
        const DEFAULT_VALUE_TEST = "default_api_key";

        test('should use db value if setup complete and db value exists', () => {
            const value = determineConfigValue("db_api_key", "env_api_key", true, DEFAULT_VALUE_TEST);
            expect(value).toBe("db_api_key");
        });
        
        test('should use db value if setup complete and db value is an empty string', () => {
            const value = determineConfigValue("", "env_api_key", true, DEFAULT_VALUE_TEST);
            expect(value).toBe("");
        });

        test('should use env value if setup not complete, even if db value exists', () => {
            const value = determineConfigValue("db_api_key", "env_api_key", false, DEFAULT_VALUE_TEST);
            expect(value).toBe("env_api_key");
        });
        
        test('should use env value if setup complete but db value is null or undefined', () => {
            let value = determineConfigValue(null, "env_api_key", true, DEFAULT_VALUE_TEST);
            expect(value).toBe("env_api_key");
            value = determineConfigValue(undefined, "env_api_key_2", true, DEFAULT_VALUE_TEST);
            expect(value).toBe("env_api_key_2");
        });
        
        test('should use env value if setup complete, db value is undefined, and env value is an empty string', () => {
            const value = determineConfigValue(undefined, "", true, DEFAULT_VALUE_TEST);
            expect(value).toBe("");
        });

        test('should use default value if setup complete but both db and env values are null/undefined', () => {
            let value = determineConfigValue(null, null, true, DEFAULT_VALUE_TEST);
            expect(value).toBe(DEFAULT_VALUE_TEST);
            value = determineConfigValue(undefined, undefined, true, DEFAULT_VALUE_TEST);
            expect(value).toBe(DEFAULT_VALUE_TEST);
        });
        
        test('should use default value if setup not complete and env value is null/undefined', () => {
            let value = determineConfigValue("db_val_not_used", null, false, DEFAULT_VALUE_TEST);
            expect(value).toBe(DEFAULT_VALUE_TEST);
            value = determineConfigValue("db_val_not_used_2", undefined, false, DEFAULT_VALUE_TEST);
            expect(value).toBe(DEFAULT_VALUE_TEST);
        });
    });
});
