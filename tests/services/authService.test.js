const { initializePassport, registerUser, loginUser, linkGoogleToExistingUser, setPasswordForUser } = require('../../services/authService');
const userRepository = require('../../db/database'); // Mock this module
const passport = require('passport');

// Mock the entire db/database.js module
jest.mock('../../db/database', () => ({
    // Existing mocks...
    findOrCreateUserByGoogleId: jest.fn(),
    getUserById: jest.fn(),
    countUsers: jest.fn(),
    promoteUserToAdmin: jest.fn(),
    getInvitationByCode: jest.fn(),
    markInvitationAsUsed: jest.fn(),
    findUserByGoogleId: jest.fn(),
    // New mocks for username/password auth
    createUser: jest.fn(),
    findUserByEmail: jest.fn(),
    verifyPassword: jest.fn(),
    linkGoogleAccount: jest.fn(),
    setUserPassword: jest.fn(),
    getDB: jest.fn().mockReturnValue({ prepare: jest.fn().mockReturnValue({ run: jest.fn() }) }), // Mock for getDB used in loginUser
}));

// Mock passport's core functions
jest.mock('passport', () => {
    const originalPassport = jest.requireActual('passport');
    originalPassport.serializeUser = jest.fn();
    originalPassport.deserializeUser = jest.fn();
    originalPassport.use = jest.fn(); // Mock the .use() method
    return originalPassport;
});


describe('Auth Service - Passport Configuration', () => {
    let mockGoogleStrategyCallback;

    beforeEach(() => {
        // Reset all mocks from db/database.js
        Object.values(userRepository).forEach(mockFn => {
            if (jest.isMockFunction(mockFn)) {
                mockFn.mockReset();
            }
        });
        
        // Reset passport mocks
        passport.serializeUser.mockReset();
        passport.deserializeUser.mockReset();
        passport.use.mockReset();

        // Capture the strategy callback when passport.use is called
        passport.use.mockImplementation((strategy) => {
            // The actual strategy instance has the callback as its _verify property
            // For GoogleStrategy, the callback is the second argument to its constructor,
            // which is then typically stored in strategy._verify by Passport.
            // This is a bit of an internal detail, but common for testing Passport strategies.
            // If the strategy instance itself is passed directly, we can grab its verify function.
            if (strategy && typeof strategy._verify === 'function') {
                 mockGoogleStrategyCallback = strategy._verify;
            } else {
                // Fallback if the structure is different or if strategy is not what we expect
                // This might happen if the GoogleStrategy constructor itself is mocked.
                // For now, we assume passport.use is called with the actual strategy instance.
                console.warn("Could not directly capture GoogleStrategy callback. Ensure passport.use is called with a strategy instance that has a _verify method.");
            }
        });
        
        // Set up necessary environment variables (can be overridden in specific tests)
        process.env.GOOGLE_CLIENT_ID = 'test-client-id';
        process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
        process.env.APP_BASE_URL = 'http://localhost:3000';

        initializePassport(); // This will call passport.use and set mockGoogleStrategyCallback
    });

    test('serializeUser should call done with user.id', () => {
        const user = { id: 1, email: 'test@example.com' };
        const done = jest.fn();
        // passport.serializeUser is called with a callback. We need to invoke that callback.
        // The mockImplementation allows us to capture that callback.
        let serializeCb;
        passport.serializeUser.mockImplementation(cb => { serializeCb = cb; });
        initializePassport(); // Re-initialize to capture the new implementation
        
        serializeCb(user, done);
        expect(done).toHaveBeenCalledWith(null, user.id);
    });

    test('deserializeUser should call done with user object or error', async () => {
        const userId = 1;
        const mockUser = { id: userId, email: 'test@example.com' };
        const done = jest.fn();
        userRepository.getUserById.mockResolvedValue(mockUser);

        let deserializeCb;
        passport.deserializeUser.mockImplementation(cb => { deserializeCb = cb; });
        initializePassport(); // Re-initialize

        await deserializeCb(userId, done);
        expect(userRepository.getUserById).toHaveBeenCalledWith(userId);
        expect(done).toHaveBeenCalledWith(null, mockUser);

        // Test error case
        const dbError = new Error("DB error");
        userRepository.getUserById.mockRejectedValue(dbError);
        await deserializeCb(userId, done);
        expect(done).toHaveBeenCalledWith(dbError);
    });
    
    describe('GoogleStrategy Callback', () => {
        const mockProfile = {
            id: 'google123',
            displayName: 'Test User',
            emails: [{ value: 'test@example.com' }],
        };
        // Default mockReq for non-linking flow
        const mockReq = { 
            session: {},
            query: {} // Ensure query object exists
        };
        const mockAccessToken = 'access-token';
        const mockRefreshToken = 'refresh-token';
        const mockDone = jest.fn();

        beforeEach(() => {
            mockDone.mockReset();
            userRepository.findUserByGoogleId.mockReset();
            userRepository.findOrCreateUserByGoogleId.mockReset();
            userRepository.countUsers.mockReset();
            userRepository.promoteUserToAdmin.mockReset();
            userRepository.getInvitationByCode.mockReset();
            userRepository.markInvitationAsUsed.mockReset();
            userRepository.getUserById.mockReset(); // Ensure this is reset too for re-fetch after admin promotion
            
            // Ensure mockGoogleStrategyCallback is set
            if (!mockGoogleStrategyCallback) {
                 initializePassport(); // Attempt to re-initialize if not set
                 if (!mockGoogleStrategyCallback && passport.use.mock.calls.length > 0 && passport.use.mock.calls[0][0] && passport.use.mock.calls[0][0]._verify) {
                    mockGoogleStrategyCallback = passport.use.mock.calls[0][0]._verify;
                 } else {
                    throw new Error("GoogleStrategy callback not captured. Check passport.use mock in beforeEach.");
                 }
            }
        });

        test('should find and return existing user (standard login)', async () => {
            const existingUser = { ...mockProfile, id: 1, google_id: mockProfile.id, email: mockProfile.emails[0].value, is_admin: false };
            userRepository.findOrCreateUserByGoogleId.mockResolvedValue(existingUser); 

            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, mockProfile, mockDone);
            
            expect(userRepository.findOrCreateUserByGoogleId).toHaveBeenCalledWith(expect.objectContaining({ 
                googleId: mockProfile.id,
                email: mockProfile.emails[0].value 
            }));
            expect(mockDone).toHaveBeenCalledWith(null, existingUser);
        });

        test('should create new user and promote if first user (OOBE - standard login)', async () => {
            userRepository.countUsers.mockResolvedValue(1); // After creation, this will be the first user
            const newUser = { id: 1, google_id: mockProfile.id, email: mockProfile.emails[0].value, displayName: mockProfile.displayName, is_admin: false };
            userRepository.findOrCreateUserByGoogleId.mockResolvedValue(newUser); // Simulates user creation
            userRepository.promoteUserToAdmin.mockResolvedValue(1); 
            // No need to mock getUserById for re-fetch here as the callback itself updates user.is_admin

            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, mockProfile, mockDone);

            expect(userRepository.findOrCreateUserByGoogleId).toHaveBeenCalledWith(expect.objectContaining({ googleId: mockProfile.id }));
            expect(userRepository.promoteUserToAdmin).toHaveBeenCalledWith(newUser.id);
            expect(mockDone).toHaveBeenCalledWith(null, expect.objectContaining({ is_admin: true }));
        });
        
        test('should promote user if ADMIN_USER_GOOGLE_ID matches (standard login)', async () => {
            process.env.ADMIN_USER_GOOGLE_ID = mockProfile.id;
            userRepository.countUsers.mockResolvedValue(5); // Not the first user
            const newUser = { id: 2, google_id: mockProfile.id, email: mockProfile.emails[0].value, displayName: mockProfile.displayName, is_admin: false };
            userRepository.findOrCreateUserByGoogleId.mockResolvedValue(newUser);
            userRepository.promoteUserToAdmin.mockResolvedValue(1);

            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, mockProfile, mockDone);
            expect(userRepository.promoteUserToAdmin).toHaveBeenCalledWith(newUser.id);
            expect(mockDone).toHaveBeenCalledWith(null, expect.objectContaining({ is_admin: true }));
            delete process.env.ADMIN_USER_GOOGLE_ID; // Clean up env var
        });

        // Invitation logic is simplified in the new Google callback, so these tests are removed/adjusted.
        // The new callback primarily relies on findOrCreateUserByGoogleId and OOBE admin promotion.
        // No explicit invitation check in Google strategy anymore.

        test('should handle missing email in profile (standard login)', async () => {
            const profileNoEmail = { ...mockProfile, emails: null };
            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, profileNoEmail, mockDone);
            expect(mockDone).toHaveBeenCalledWith(expect.any(Error), null);
            expect(mockDone.mock.calls[0][0].message).toBe("Email not provided by Google profile.");
        });

        // Tests for account linking flow
        test('GoogleStrategy callback should link account if state is "linking" and user is authenticated', async () => {
            const linkingReq = { 
                query: { state: 'linking' }, 
                user: { id: 1, email: 'localuser@example.com' }, // Existing logged-in user
                session: { linkingUserId: 1 } 
            };
            const googleProfileForLink = { id: 'google789', emails: [{ value: 'localuser@example.com' }], displayName: 'Local User Google' };
            const updatedUserAfterLink = { ...linkingReq.user, google_id: 'google789', display_name: 'Local User Google' };

            userRepository.linkGoogleAccount.mockResolvedValue(1); // Assume success
            userRepository.getUserById.mockResolvedValue(updatedUserAfterLink); // Mock user refresh

            await mockGoogleStrategyCallback(linkingReq, mockAccessToken, mockRefreshToken, googleProfileForLink, mockDone);

            expect(userRepository.linkGoogleAccount).toHaveBeenCalledWith({
                userId: linkingReq.user.id,
                googleId: googleProfileForLink.id,
                googleEmail: googleProfileForLink.emails[0].value,
                googleDisplayName: googleProfileForLink.displayName
            });
            expect(userRepository.getUserById).toHaveBeenCalledWith(linkingReq.user.id);
            expect(linkingReq.session.linkingUserId).toBeUndefined(); // Should be cleaned up
            expect(mockDone).toHaveBeenCalledWith(null, updatedUserAfterLink);
        });

        test('GoogleStrategy callback should fail linking if session linkingUserId does not match req.user.id', async () => {
            const linkingReq = { 
                query: { state: 'linking' }, 
                user: { id: 1 }, 
                session: { linkingUserId: 2 } // Mismatch
            };
            const googleProfileForLink = { id: 'google789', emails: [{ value: 'localuser@example.com' }], displayName: 'Local User Google' };
            await mockGoogleStrategyCallback(linkingReq, mockAccessToken, mockRefreshToken, googleProfileForLink, mockDone);
            expect(mockDone).toHaveBeenCalledWith(null, false, { message: 'User session error during Google account linking. Please try logging in again.' });
        });

        test('GoogleStrategy callback should handle errors from linkGoogleAccount', async () => {
            const linkingReq = { 
                query: { state: 'linking' }, 
                user: { id: 1, email: 'localuser@example.com' },
                session: { linkingUserId: 1 } 
            };
            const googleProfileForLink = { id: 'google789', emails: [{ value: 'localuser@example.com' }], displayName: 'Local User Google' };
            const linkError = new Error("DB unique constraint failed");
            userRepository.linkGoogleAccount.mockRejectedValue(linkError);

            await mockGoogleStrategyCallback(linkingReq, mockAccessToken, mockRefreshToken, googleProfileForLink, mockDone);
            expect(mockDone).toHaveBeenCalledWith(null, false, { message: `Failed to link Google account: ${linkError.message}` });
        });
    });
});


describe('Auth Service - Username/Password', () => {
    beforeEach(() => {
        // Reset relevant mocks from userRepository before each test in this block
        userRepository.createUser.mockReset();
        userRepository.findUserByEmail.mockReset();
        userRepository.verifyPassword.mockReset();
        // Check if getDB and subsequent calls are actual mocks before trying to reset
        if (jest.isMockFunction(userRepository.getDB().prepare().run)) {
             userRepository.getDB().prepare().run.mockReset();
        }
        if (jest.isMockFunction(userRepository.getDB().prepare)) {
            userRepository.getDB().prepare.mockReset();
        }
         if (jest.isMockFunction(userRepository.getDB)) {
            userRepository.getDB.mockReset();
            // Re-establish the mock structure for getDB for subsequent tests in this block if needed
            userRepository.getDB.mockReturnValue({ prepare: jest.fn().mockReturnValue({ run: jest.fn() }) });
        }
        userRepository.linkGoogleAccount.mockReset();
        userRepository.setUserPassword.mockReset();
        userRepository.getUserById.mockReset();
    });

    describe('registerUser', () => {
        test('should register a new user successfully', async () => {
            const userData = { email: 'newuser@example.com', password: 'password123', displayName: 'New User' };
            const mockNewUser = { id: 1, ...userData, password: 'hashedpassword' }; // createUser returns the user object
            userRepository.createUser.mockResolvedValue(mockNewUser);
            
            const result = await registerUser(userData);
            expect(userRepository.createUser).toHaveBeenCalledWith(userData);
            expect(result).toEqual(mockNewUser);
        });

        test('should throw error if email or password not provided', async () => {
            await expect(registerUser({ email: 'test@example.com', password: '' })).rejects.toThrow('Email and password are required.');
            await expect(registerUser({ email: '', password: 'password123' })).rejects.toThrow('Email and password are required.');
        });
        
        test('should throw error if password is too short', async () => {
            await expect(registerUser({ email: 'test@example.com', password: 'short' })).rejects.toThrow('Password must be at least 8 characters long.');
        });

        test('should throw error if createUser fails (e.g., email exists)', async () => {
            userRepository.createUser.mockRejectedValue(new Error('User already exists'));
            await expect(registerUser({ email: 'exists@example.com', password: 'password123' })).rejects.toThrow('Registration failed: User already exists');
        });
    });

    describe('loginUser', () => {
        const loginCredentials = { email: 'test@example.com', password: 'password123' };
        const mockUser = { id: 1, email: 'test@example.com', password: 'hashedpassword', is_admin: false };

        beforeEach(() => {
            // Ensure getDB().prepare().run() is freshly mocked for each loginUser test
            const mockStatement = { run: jest.fn() };
            const mockPrepare = jest.fn().mockReturnValue(mockStatement);
            userRepository.getDB.mockReturnValue({ prepare: mockPrepare });
        });

        test('should login user successfully', async () => {
            userRepository.findUserByEmail.mockResolvedValue(mockUser);
            userRepository.verifyPassword.mockResolvedValue(true);
            
            const { password, ...expectedUserWithoutPassword } = mockUser;
            const result = await loginUser(loginCredentials);
            
            expect(userRepository.findUserByEmail).toHaveBeenCalledWith(loginCredentials.email);
            expect(userRepository.verifyPassword).toHaveBeenCalledWith(loginCredentials.password, mockUser.password);
            expect(userRepository.getDB().prepare).toHaveBeenCalledWith('UPDATE Users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?');
            expect(userRepository.getDB().prepare().run).toHaveBeenCalledWith(mockUser.id);
            expect(result).toEqual(expectedUserWithoutPassword);
        });
        
        test('should throw error for missing email or password', async () => {
            await expect(loginUser({ email: 'test@example.com', password: ''})).rejects.toThrow('Email and password are required for login.');
        });

        test('should throw error if user not found', async () => {
            userRepository.findUserByEmail.mockResolvedValue(undefined);
            await expect(loginUser(loginCredentials)).rejects.toThrow('Invalid email or password.');
        });

        test('should throw error if password is not set for user', async () => {
            userRepository.findUserByEmail.mockResolvedValue({ ...mockUser, password: null });
            await expect(loginUser(loginCredentials)).rejects.toThrow('No password set for this account.');
        });
        
        test('should throw error for incorrect password', async () => {
            userRepository.findUserByEmail.mockResolvedValue(mockUser);
            userRepository.verifyPassword.mockResolvedValue(false);
            await expect(loginUser(loginCredentials)).rejects.toThrow('Invalid email or password.');
        });
    });
    
    describe('linkGoogleToExistingUser', () => {
        const linkData = { userId: 1, googleId: 'google123', googleEmail: 'user@example.com', googleDisplayName: 'User Google' };
        const mockUser = { id: 1, email: 'user@example.com', google_id: 'google123' };

        test('should link Google account successfully', async () => {
            userRepository.linkGoogleAccount.mockResolvedValue(1); // Assume success returns number of rows changed
            userRepository.getUserById.mockResolvedValue(mockUser);
            
            const result = await linkGoogleToExistingUser(linkData);
            expect(userRepository.linkGoogleAccount).toHaveBeenCalledWith(linkData);
            expect(userRepository.getUserById).toHaveBeenCalledWith(linkData.userId);
            expect(result).toEqual(mockUser);
        });

        test('should throw error for missing parameters', async () => {
            await expect(linkGoogleToExistingUser({ userId: 1, googleId: 'g123', googleEmail: '' })).rejects.toThrow('User ID, Google ID, and Google Email are required for linking.');
        });

        test('should throw error if linkGoogleAccount fails', async () => {
            userRepository.linkGoogleAccount.mockRejectedValue(new Error('DB constraint failed'));
            await expect(linkGoogleToExistingUser(linkData)).rejects.toThrow('Failed to link Google account: DB constraint failed');
        });
    });

    describe('setPasswordForUser', () => {
        const setData = { userId: 1, password: 'newPassword123' };

        test('should set password successfully', async () => {
            userRepository.setUserPassword.mockResolvedValue(1); // Assume success
            const result = await setPasswordForUser(setData);
            expect(userRepository.setUserPassword).toHaveBeenCalledWith(setData);
            expect(result).toEqual({ success: true, message: "Password updated successfully." });
        });

        test('should throw error for missing parameters', async () => {
            await expect(setPasswordForUser({ userId: 1, password: '' })).rejects.toThrow('User ID and new password are required.');
        });
        
        test('should throw error if password is too short', async () => {
            await expect(setPasswordForUser({ userId: 1, password: 'short' })).rejects.toThrow('Password must be at least 8 characters long.');
        });

        test('should throw error if setUserPassword fails', async () => {
            userRepository.setUserPassword.mockRejectedValue(new Error('User not found'));
            await expect(setPasswordForUser(setData)).rejects.toThrow('Failed to set password: User not found');
        });
    });
});
