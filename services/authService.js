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
    async (req, accessToken, refreshToken, profile, done) => { // req is now the first argument
        try {
            const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
            if (!email) {
                return done(new Error("Email not provided by Google profile."), null);
            }

            // Check if user already exists
            let existingUser = await userRepository.findUserByGoogleId(profile.id); // Assumes findUserByGoogleId is created

            if (existingUser) {
                 // Existing user, update last login and potentially details
                const updatedUser = await userRepository.findOrCreateUserByGoogleId({ // This will find and update
                    googleId: profile.id,
                    email: email,
                    displayName: profile.displayName || email.split('@')[0]
                });
                return done(null, updatedUser);
            }

            // New user registration logic
            const totalUsers = await userRepository.countUsers();
            const isFirstUser = totalUsers === 0;
            const isAdminByEnv = process.env.ADMIN_USER_GOOGLE_ID && process.env.ADMIN_USER_GOOGLE_ID === profile.id;

            if (isFirstUser || isAdminByEnv) {
                // First user or designated admin bypasses invitation
                console.log(`New user ${email} is either first user or matches ADMIN_USER_GOOGLE_ID. Bypassing invitation.`);
                let newUser = await userRepository.findOrCreateUserByGoogleId({
                    googleId: profile.id,
                    email: email,
                    displayName: profile.displayName || email.split('@')[0]
                });
                await userRepository.promoteUserToAdmin(newUser.id);
                newUser.is_admin = true; // Reflect promotion
                console.log(`OOBE: User ${newUser.email} (ID: ${newUser.id}) promoted to admin.`);
                return done(null, newUser);
            }

            // Not the first user, and not designated admin, so invitation code is required
            const invitationCode = req.session.invitationCode;
            if (!invitationCode) {
                console.log(`New user ${email} requires an invitation code, but none found in session.`);
                return done(null, false, { message: 'Invitation code required for new users.' });
            }

            const invitation = await userRepository.getInvitationByCode(invitationCode);
            if (!invitation || invitation.is_used) {
                console.log(`New user ${email} provided an invalid or already used invitation code: ${invitationCode}.`);
                return done(null, false, { message: 'Invalid or used invitation code.' });
            }

            // Valid invitation code, proceed to create user
            let newUser = await userRepository.findOrCreateUserByGoogleId({
                googleId: profile.id,
                email: email,
                displayName: profile.displayName || email.split('@')[0]
            });

            // Mark invitation as used
            await userRepository.markInvitationAsUsed(invitationCode, newUser.id);
            console.log(`New user ${newUser.email} registered successfully using invitation code ${invitationCode}.`);
            
            // Clear invitation code from session
            if (req.session.invitationCode) {
                 delete req.session.invitationCode;
                 req.session.save(err => { // Explicitly save session if needed, depending on store
                    if (err) console.error("Error saving session after deleting invitationCode:", err);
                 });
            }
            
            return done(null, newUser);

        } catch (err) {
            console.error("Error in Google Strategy callback:", err);
            return done(err);
        }
    }));
}

module.exports = { initializePassport };
