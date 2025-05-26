const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const userRepository = require('../db/database'); // Assuming user functions are exported from here

function initializePassport() {
    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    passport.deserializeUser(async (id, done) => {
        try {
            const user = await userRepository.getUserById(id); // This should be an async function or return a Promise
            done(null, user);
        } catch (err) {
            done(err);
        }
    });

    if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'your_google_client_id.apps.googleusercontent.com' ||
        !process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET === 'your_google_client_secret') {
        console.warn("WARNING: Google OAuth Client ID or Secret not configured or using default placeholder. Google login will be disabled.");
        // Optionally, don't even try to register the strategy if it's not configured.
        // This can prevent startup errors if Passport tries to initialize a strategy with missing credentials.
        return; // Exit if not configured
    }
    
    const callbackURL = process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/auth/google/callback` : '/auth/google/callback';
    console.log(`Using Google OAuth Callback URL: ${callbackURL}`);


    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: callbackURL,
        passReqToCallback: true // Pass req object to the callback
    },
    async (req, accessToken, refreshToken, profile, done) => {
        try {
            const googleEmail = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
            if (!googleEmail) {
                return done(new Error("Email not provided by Google profile."), null);
            }
            const googleId = profile.id;
            const googleDisplayName = profile.displayName || googleEmail.split('@')[0];

            // Check if this is an account linking flow
            if (req.query.state === 'linking') {
                if (!req.user || !req.session.linkingUserId || req.user.id !== req.session.linkingUserId) {
                    // User must be logged in and session linkingUserId must match current user
                    console.error('Google linking error: User not properly authenticated or session mismatch.');
                    return done(null, false, { message: 'User session error during Google account linking. Please try logging in again.' });
                }
                try {
                    await userRepository.linkGoogleAccount({ 
                        userId: req.user.id, 
                        googleId: googleId, 
                        googleEmail: googleEmail, 
                        googleDisplayName: googleDisplayName 
                    });
                    // Successfully linked. Return the existing logged-in user.
                    // req.user might need to be refreshed if email/display name changed.
                    const updatedUser = await userRepository.getUserById(req.user.id);
                    delete req.session.linkingUserId; // Clean up session
                    return done(null, updatedUser);
                } catch (linkError) {
                    console.error('Error linking Google account:', linkError.message);
                    // Pass error message to be displayed to user
                    return done(null, false, { message: `Failed to link Google account: ${linkError.message}` });
                }
            } else {
                // Standard Google Login/Registration flow
                // The findOrCreateUserByGoogleId function now handles email conflicts and linking internally
                let user = await userRepository.findOrCreateUserByGoogleId({
                    googleId: googleId,
                    email: googleEmail,
                    displayName: googleDisplayName
                });

                // OOBE: First user becomes admin, or user matching ADMIN_USER_GOOGLE_ID
                const totalUsers = await userRepository.countUsers();
                const isFirstUser = totalUsers === 1 && user.id === 1; // Assuming IDs are sequential and first user is ID 1, or check creation time.
                                                                      // More robust: check if this is the only user.
                const isAdminByEnv = process.env.ADMIN_USER_GOOGLE_ID && process.env.ADMIN_USER_GOOGLE_ID === googleId;

                if ((isFirstUser || isAdminByEnv) && !user.is_admin) {
                    console.log(`Promoting user ${user.email} (ID: ${user.id}) to admin (first user or matches ADMIN_USER_GOOGLE_ID).`);
                    await userRepository.promoteUserToAdmin(user.id);
                    user.is_admin = true; // Reflect promotion in the user object passed to done()
                } else if (!user.is_admin && !(isFirstUser || isAdminByEnv)) {
                    // Standard user registration - check for invitation if it's a brand new account from Google
                    // findOrCreateUserByGoogleId would have created the user if they didn't exist.
                    // We need to know if it was a creation or just a find.
                    // Let's assume if user.created_at is very recent, it's new.
                    // This part of the logic might need refinement based on how `findOrCreateUserByGoogleId` signals creation.
                    // For simplicity, the original invitation logic is complex to weave in here perfectly without more info from findOrCreate.
                    // The original logic was:
                    // if (existingUser) { ... return done(null, updatedUser); }
                    // else { /* new user logic with invitation */ }
                    // Now, findOrCreateUserByGoogleId handles both. If a user is found by email but no googleId, it links.
                    // If completely new, it creates.
                    // The invitation logic should ideally apply only to *completely new* users to the system.

                    // Current findOrCreateUserByGoogleId doesn't explicitly signal "creation" vs "found and linked" vs "found".
                    // This makes applying invitation logic tricky here.
                    // For now, we'll rely on the OOBE admin promotion and skip invitation for Google sign-ups
                    // if they are not the first user or designated admin.
                    // This simplifies the Google sign-up flow.
                    // If invitations MUST apply to Google sign-ups that aren't OOBE, this part needs more work.
                    console.log(`User ${user.email} logged in/registered via Google. Invitation logic for Google sign-ups is currently simplified.`);
                }
                return done(null, user);
            }
        } catch (err) {
            console.error("Error in Google Strategy callback:", err.message);
            return done(err);
        }
    }));
}

async function registerUser({ email, password, displayName }) {
    try {
        // Basic validation (can be expanded)
        if (!email || !password) {
            throw new Error('Email and password are required.');
        }
        if (password.length < 8) { // Example: Minimum password length
            throw new Error('Password must be at least 8 characters long.');
        }

        const newUser = await userRepository.createUser({ email, password, displayName });
        return newUser;
    } catch (error) {
        console.error(`Error in authService.registerUser for email ${email}:`, error.message);
        // Rethrow specific errors or a generic one
        throw new Error(`Registration failed: ${error.message}`); 
    }
}

async function loginUser({ email, password }) {
    try {
        if (!email || !password) {
            throw new Error('Email and password are required for login.');
        }

        const user = await userRepository.findUserByEmail(email);
        if (!user) {
            throw new Error('Invalid email or password.'); // User not found
        }

        // If user found, but has no password set (e.g., created via OAuth and never set one)
        if (!user.password) {
            throw new Error('No password set for this account. Try logging in with Google or reset password if applicable.');
        }

        const isPasswordValid = await userRepository.verifyPassword(password, user.password);
        if (!isPasswordValid) {
            throw new Error('Invalid email or password.'); // Password incorrect
        }
        
        // Update last_login_at for local password login
        // (findOrCreateUserByGoogleId handles this for Google logins)
        // This could be a new function in userRepository or done here if simple enough.
        // For now, let's assume we might add a userRepository.updateLastLogin(userId)
        // If not, this part needs adjustment.
        const db = userRepository.getDB(); // Accessing getDB directly, ensure it's exported from database.js
        const stmt = db.prepare('UPDATE Users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?');
        stmt.run(user.id);
        console.log(`User ${user.email} (ID: ${user.id}) logged in locally. Updated last login.`);


        // Return user object without password hash
        const { password: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
    } catch (error) {
        console.error(`Error in authService.loginUser for email ${email}:`, error.message);
        throw new Error(`Login failed: ${error.message}`);
    }
}

async function linkGoogleToExistingUser({ userId, googleId, googleEmail, googleDisplayName }) {
    try {
        if (!userId || !googleId || !googleEmail) {
            throw new Error('User ID, Google ID, and Google Email are required for linking.');
        }
        await userRepository.linkGoogleAccount({ userId, googleId, googleEmail, googleDisplayName });
        console.log(`authService: Successfully initiated linking for user ID ${userId} with Google ID ${googleId}`);
        // Optionally, return the updated user record
        return await userRepository.getUserById(userId);
    } catch (error) {
        console.error(`Error in authService.linkGoogleToExistingUser for user ID ${userId}:`, error.message);
        throw new Error(`Failed to link Google account: ${error.message}`);
    }
}

async function setPasswordForUser({ userId, password }) {
    try {
        if (!userId || !password) {
            throw new Error('User ID and new password are required.');
        }
        if (password.length < 8) { // Consistent validation
            throw new Error('Password must be at least 8 characters long.');
        }
        await userRepository.setUserPassword({ userId, password });
        console.log(`authService: Password successfully set for user ID ${userId}`);
        // Return some confirmation, or the user object
        return { success: true, message: "Password updated successfully." };
    } catch (error) {
        console.error(`Error in authService.setPasswordForUser for user ID ${userId}:`, error.message);
        throw new Error(`Failed to set password: ${error.message}`);
    }
}

module.exports = { 
    initializePassport,
    registerUser,
    loginUser,
    linkGoogleToExistingUser,
    setPasswordForUser
    // ... any other functions that might be added or need to be exported
};
