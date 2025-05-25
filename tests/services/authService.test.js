const { initializePassport } = require('../../services/authService');
const userRepository = require('../../db/database'); // Mock this module
const passport = require('passport');

// Mock the entire db/database.js module
jest.mock('../../db/database', () => ({
    findOrCreateUserByGoogleId: jest.fn(),
    getUserById: jest.fn(),
    countUsers: jest.fn(),
    promoteUserToAdmin: jest.fn(),
    getInvitationByCode: jest.fn(),
    markInvitationAsUsed: jest.fn(),
    findUserByGoogleId: jest.fn(), // Ensure this is mocked
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
        const mockReq = { session: {} }; // Mock request object with session
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

        test('should find and return existing user', async () => {
            const existingUser = { ...mockProfile, id: 1, google_id: mockProfile.id, email: mockProfile.emails[0].value, is_admin: false };
            userRepository.findUserByGoogleId.mockResolvedValue(existingUser);
            // findOrCreateUserByGoogleId will be called by the strategy if findUserByGoogleId returns a user (for updates)
            userRepository.findOrCreateUserByGoogleId.mockResolvedValue(existingUser); 

            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, mockProfile, mockDone);
            
            expect(userRepository.findUserByGoogleId).toHaveBeenCalledWith(mockProfile.id);
            expect(userRepository.findOrCreateUserByGoogleId).toHaveBeenCalledWith(expect.objectContaining({ googleId: mockProfile.id }));
            expect(mockDone).toHaveBeenCalledWith(null, existingUser);
        });

        test('should create new user and promote if first user (OOBE)', async () => {
            userRepository.findUserByGoogleId.mockResolvedValue(null); // No existing user
            userRepository.countUsers.mockResolvedValue(0); // This is the first user
            const newUser = { id: 1, google_id: mockProfile.id, email: mockProfile.emails[0].value, displayName: mockProfile.displayName, is_admin: false };
            const adminUser = { ...newUser, is_admin: true };
            userRepository.findOrCreateUserByGoogleId.mockResolvedValue(newUser);
            userRepository.promoteUserToAdmin.mockResolvedValue(1); // Assume success
            userRepository.getUserById.mockResolvedValue(adminUser); // Simulate re-fetch after promotion

            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, mockProfile, mockDone);

            expect(userRepository.findOrCreateUserByGoogleId).toHaveBeenCalledWith(expect.objectContaining({ googleId: mockProfile.id }));
            expect(userRepository.promoteUserToAdmin).toHaveBeenCalledWith(newUser.id);
            expect(mockDone).toHaveBeenCalledWith(null, expect.objectContaining({ is_admin: true }));
        });
        
        test('should promote user if ADMIN_USER_GOOGLE_ID matches', async () => {
            process.env.ADMIN_USER_GOOGLE_ID = mockProfile.id;
            userRepository.findUserByGoogleId.mockResolvedValue(null);
            userRepository.countUsers.mockResolvedValue(5); // Not the first user
            const newUser = { id: 2, google_id: mockProfile.id, email: mockProfile.emails[0].value, displayName: mockProfile.displayName, is_admin: false };
            const adminUser = { ...newUser, is_admin: true };
            userRepository.findOrCreateUserByGoogleId.mockResolvedValue(newUser);
            userRepository.promoteUserToAdmin.mockResolvedValue(1);
            userRepository.getUserById.mockResolvedValue(adminUser);

            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, mockProfile, mockDone);
            expect(userRepository.promoteUserToAdmin).toHaveBeenCalledWith(newUser.id);
            expect(mockDone).toHaveBeenCalledWith(null, expect.objectContaining({ is_admin: true }));
            delete process.env.ADMIN_USER_GOOGLE_ID; // Clean up env var
        });


        test('should require invitation for new user if not first or admin by env', async () => {
            userRepository.findUserByGoogleId.mockResolvedValue(null);
            userRepository.countUsers.mockResolvedValue(5); // Not first user
            // No ADMIN_USER_GOOGLE_ID set for this profile.id

            mockReq.session.invitationCode = null; // No invitation code in session

            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, mockProfile, mockDone);
            
            expect(mockDone).toHaveBeenCalledWith(null, false, { message: 'Invitation code required for new users.' });
        });

        test('should fail if invitation code is invalid or used', async () => {
            userRepository.findUserByGoogleId.mockResolvedValue(null);
            userRepository.countUsers.mockResolvedValue(5);
            mockReq.session.invitationCode = 'invalid-code';
            userRepository.getInvitationByCode.mockResolvedValue(null); // Invalid code

            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, mockProfile, mockDone);
            expect(mockDone).toHaveBeenCalledWith(null, false, { message: 'Invalid or used invitation code.' });

            userRepository.getInvitationByCode.mockResolvedValue({ code: 'used-code', is_used: true }); // Used code
            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, mockProfile, mockDone);
            expect(mockDone).toHaveBeenCalledWith(null, false, { message: 'Invalid or used invitation code.' });
        });

        test('should create new user with valid invitation code', async () => {
            userRepository.findUserByGoogleId.mockResolvedValue(null);
            userRepository.countUsers.mockResolvedValue(5);
            mockReq.session.invitationCode = 'valid-code';
            const mockInvitation = { code: 'valid-code', is_used: false, id: 1 };
            userRepository.getInvitationByCode.mockResolvedValue(mockInvitation);
            const newUser = { id: 3, google_id: mockProfile.id, email: mockProfile.emails[0].value, displayName: mockProfile.displayName, is_admin: false };
            userRepository.findOrCreateUserByGoogleId.mockResolvedValue(newUser);
            userRepository.markInvitationAsUsed.mockResolvedValue(1);
            mockReq.session.save = jest.fn(cb => cb()); // Mock session.save

            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, mockProfile, mockDone);

            expect(userRepository.getInvitationByCode).toHaveBeenCalledWith('valid-code');
            expect(userRepository.findOrCreateUserByGoogleId).toHaveBeenCalledWith(expect.objectContaining({ googleId: mockProfile.id }));
            expect(userRepository.markInvitationAsUsed).toHaveBeenCalledWith('valid-code', newUser.id);
            expect(mockReq.session.invitationCode).toBeUndefined(); // Should be deleted
            expect(mockDone).toHaveBeenCalledWith(null, newUser);
        });
        
        test('should handle missing email in profile', async () => {
            const profileNoEmail = { ...mockProfile, emails: null };
            await mockGoogleStrategyCallback(mockReq, mockAccessToken, mockRefreshToken, profileNoEmail, mockDone);
            expect(mockDone).toHaveBeenCalledWith(expect.any(Error), null);
            expect(mockDone.mock.calls[0][0].message).toBe("Email not provided by Google profile.");
        });

    });
});
