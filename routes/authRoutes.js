const express = require('express');
const passport = require('passport');
const router = express.Router();

// Route to start Google OAuth authentication
// Scope requests user's profile and email
router.get('/google', (req, res, next) => {
    // Before redirecting to Google, check if OAuth is configured.
    // This check might also be in a global middleware or directly in app.js for the /auth prefix.
    // For now, checking here.
    if (!process.env.GOOGLE_CLIENT_ID || 
        process.env.GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com' || // Check against placeholder
        !process.env.GOOGLE_CLIENT_SECRET ||
        process.env.GOOGLE_CLIENT_SECRET === 'YOUR_GOOGLE_CLIENT_SECRET_HERE') { // Check against placeholder
        
        // In a real app, you might flash a message or render an error page.
        // req.flash is not available unless connect-flash is used.
        // For simplicity, redirecting with a query parameter for the client to display an error.
        // Or, if this is an API, return a JSON error.
        // Since this is server-side rendered for now, redirecting to login with an error.
        console.error("authRoutes: Google OAuth not configured. Cannot initiate login.");
        req.session.flashMessages = { type: 'error', message: 'Google OAuth is not configured by the administrator. Login is not possible.' };
        return res.redirect('/login');
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});


// Google OAuth callback route
// This is where Google redirects the user after they have authenticated with Google.
router.get('/google/callback', 
    passport.authenticate('google', { 
        // failureRedirect: '/login?error=google_auth_failed', // Redirect to login page on failure
        // Using custom callback to set session flash message
        // failureFlash: true // Requires connect-flash middleware
    }),
    (req, res, next) => { // Custom callback to handle success and failure from passport.authenticate
        passport.authenticate('google', { failureRedirect: '/login' }, (err, user, info) => {
            if (err) {
                console.error("Google auth error:", err);
                req.session.flashMessages = { type: 'error', message: 'An error occurred during Google authentication.' };
                return res.redirect('/login');
            }
            if (!user) {
                const failureMessage = info && info.message ? info.message : 'Google authentication failed. Please try again.';
                console.warn("Google auth failed (no user):", failureMessage);
                req.session.flashMessages = { type: 'error', message: failureMessage };
                return res.redirect('/login');
            }
            req.logIn(user, (loginErr) => {
                if (loginErr) {
                    console.error("Error logging in user after Google auth:", loginErr);
                    req.session.flashMessages = { type: 'error', message: 'Error logging you in after Google authentication.' };
                    return res.redirect('/login');
                }
                // Successful authentication.
                console.log("Successful Google OAuth callback. User:", user.email);
                req.session.flashMessages = { type: 'success', message: `Welcome, ${user.displayName || user.email}!` };
                return res.redirect('/'); 
            });
        })(req, res, next);
    }
);

// Logout route
router.post('/logout', (req, res, next) => {
    if (req.user) { 
        const username = req.user.email || req.user.displayName || 'User';
        req.logout((err) => {
            if (err) {
                console.error("Error during logout:", err);
                req.session.flashMessages = { type: 'error', message: 'Error during logout.' };
                return res.redirect('/'); // Or an error page
            }
            req.session.flashMessages = { type: 'success', message: 'You have been successfully logged out.' };
            console.log(`${username} logged out successfully.`);
            return res.redirect('/login');
        });
    } else {
        return res.redirect('/login');
    }
});

module.exports = router;
