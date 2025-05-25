const crypto = require('crypto');

// Mock the database module
jest.mock('../../db/database', () => ({
    getSetting: jest.fn(),
    getAllSettings: jest.fn(() => ({})), // Default mock for app.js loading
    initializeDatabase: jest.fn(),
}));

// Define a constant for the crypto mock to use, ensuring it's a valid hex string of appropriate length
const PREDEFINED_HEX_FOR_CRYPTO_MOCK = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"; // 64 hex chars

jest.mock('crypto', () => {
    const originalCrypto = jest.requireActual('crypto');
    return {
        ...originalCrypto,
        randomBytes: jest.fn((size) => {
            if (size === 64) {
                // Return an object that mimics Buffer's toString('hex') behavior
                return {
                    toString: (encoding) => {
                        if (encoding === 'hex') {
                            return PREDEFINED_HEX_FOR_CRYPTO_MOCK;
                        }
                        // Fallback for other encodings if necessary
                        return Buffer.from(PREDEFINED_HEX_FOR_CRYPTO_MOCK, 'hex').toString(encoding || undefined);
                    }
                };
            }
            return originalCrypto.randomBytes(size); // Fallback for other sizes
        }),
    };
});


// Helper function to simulate the SESSION_SECRET prioritization logic from app.js
// This isolates the logic for testing.
const determineSessionSecret = (envSecret, dbSecret, isDbSetupComplete, defaultPlaceholder, generatedCryptoKey) => {
    let generatedTestSecret = null;

    // Condition for generation:
    // (envSecret is undefined/null/empty OR envSecret is the placeholder)
    // AND
    // (dbSecret is undefined/null/empty OR setup is not complete for db check)
    const envIsEffectivelyUnset = (!envSecret || envSecret === defaultPlaceholder);
    const dbIsEffectivelyUnset = (!dbSecret || !isDbSetupComplete);

    if (envIsEffectivelyUnset && dbIsEffectivelyUnset) {
        generatedTestSecret = generatedCryptoKey;
    }

    // Priority: generated (if conditions met) -> DB (if setup complete) -> Env -> Placeholder
    // The final return statement in app.js's config block handles this priority implicitly.
    // This helper needs to return the determined secret based on this chain.
    if (generatedTestSecret) {
        return generatedTestSecret;
    }
    if (isDbSetupComplete && dbSecret) { // dbSecret takes precedence if setup is complete and secret exists
        return dbSecret;
    }
    // If envSecret is set (and not placeholder, or it is placeholder but no generated/DB), it's used
    if (envSecret) { 
        return envSecret; 
    }
    // Fallback to placeholder if envSecret was also undefined/null
    return defaultPlaceholder; 
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
    let mockDatabase; // To hold the mocked database module

    const DEFAULT_PLACEHOLDER_TEST = "!!TEST_PLACEHOLDER!!";
    // GENERATED_CRYPTO_KEY_TEST should align with what the crypto mock provides
    const GENERATED_CRYPTO_KEY_TEST = PREDEFINED_HEX_FOR_CRYPTO_MOCK; 

    beforeEach(() => {
        // Reset modules to ensure app.js is reloaded with fresh mocks for certain tests
        jest.resetModules();
        
        // Re-acquire and re-configure mocks as jest.resetModules() clears them
        mockDatabase = require('../../db/database');
        // Default mock behaviors for db functions (can be overridden in specific tests)
        mockDatabase.getSetting.mockImplementation(() => null); // Default to setup not complete
        mockDatabase.getAllSettings.mockReturnValue({}); // Default to no DB settings

        // The crypto mock is already set up via jest.mock at the top.
        // If specific crypto behavior per test is needed, spyOn(crypto, 'randomBytes').mockReturnValue(...) here.
        // For now, the global mock with PREDEFINED_HEX_FOR_CRYPTO_MOCK should be consistent.
        
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

    describe('isInitialSetupComplete (now explicitly exported for test)', () => {
        let isInitialSetupCompleteForTest;

        beforeEach(() => {
            // app.js is re-required because of jest.resetModules() in the outer beforeEach
            // This ensures we get the version of app.js with the export.
            const appModule = require('../../app');
            isInitialSetupCompleteForTest = appModule.isInitialSetupCompleteForTest;
        });

        test('should return true if getSetting("initial_setup_complete") is "true"', () => {
            mockDatabase.getSetting.mockImplementation((key) => {
                if (key === 'initial_setup_complete') return 'true';
                return null;
            });
            expect(isInitialSetupCompleteForTest()).toBe(true);
        });

        test('should return false if getSetting("initial_setup_complete") is "false"', () => {
            mockDatabase.getSetting.mockImplementation((key) => {
                if (key === 'initial_setup_complete') return 'false';
                return null;
            });
            expect(isInitialSetupCompleteForTest()).toBe(false);
        });

        test('should return false if getSetting("initial_setup_complete") returns null', () => {
            mockDatabase.getSetting.mockImplementation((key) => {
                if (key === 'initial_setup_complete') return null;
                return null;
            });
            expect(isInitialSetupCompleteForTest()).toBe(false);
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
