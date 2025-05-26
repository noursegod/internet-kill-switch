const express = require('express');
const router = express.Router();
const passport = require('passport'); // For Google linking
const authService = require('../services/authService');
const { isAuthenticated } = require('../middleware/authMiddleware'); // To protect linking routes

// GET /login - Display login page
router.get('/login', (req, res) => {
    // The 'is_google_oauth_configured' variable should be available from res.locals if set by app.js middleware
    // If not, it needs to be explicitly fetched or passed.
    // For now, assume it's available or views handle its absence.
    res.render('login', { 
        pageTitle: 'Login',
        // Pass any necessary variables for the login.ejs template,
        // like is_google_oauth_configured, which is used in the template.
        // These are typically set globally in app.js for all views.
        // We can rely on res.locals set by the context processor in app.js
    });
});

// GET /register - Display registration page
router.get('/register', (req, res) => {
    res.render('register', { 
        pageTitle: 'Register',
        // Pass any necessary variables for the register.ejs template
        // For example, if you want to pass back input values on validation error:
        // input: req.session.input || {} // Clear after use if needed
    });
    // if (req.session.input) delete req.session.input; // Example cleanup
});

// POST /register - User registration
router.post('/register', async (req, res) => {
    const { email, password, displayName, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        // If client-side validation missed this or for API calls
        // It's better to handle this via flash messages for web forms
        req.session.flashMessages = { type: 'error', message: 'Passwords do not match.' };
        return res.redirect('/register'); // Or relevant registration page
    }

    try {
        const user = await authService.registerUser({ email, password, displayName });
        // Log the user in directly after registration
        req.logIn(user, (err) => {
            if (err) {
                console.error('Error logging in after registration:', err);
                req.session.flashMessages = { type: 'error', message: 'Registration successful, but login failed. Please try logging in manually.' };
                return res.redirect('/login');
            }
            req.session.flashMessages = { type: 'success', message: 'Registration successful! You are now logged in.' };
            return res.redirect('/'); // Redirect to home or dashboard
        });
    } catch (error) {
        console.error('Registration route error:', error.message);
        req.session.flashMessages = { type: 'error', message: error.message || 'Registration failed. Please try again.' };
        res.redirect('/register'); // Or relevant registration page
    }
});

// POST /login - User login
router.post('/login', (req, res, next) => {
    // Using a custom callback for passport.authenticate to handle success/failure messages
    // We need a local strategy defined for this to work with passport.authenticate('local', ...)
    // For now, let's call authService.loginUser directly and manually manage session.
    // This approach bypasses needing a passport local strategy if we manage session manually.
    
    const { email, password } = req.body;
    authService.loginUser({ email, password })
        .then(user => {
            req.logIn(user, (err) => {
                if (err) {
                    console.error('Error logging in user:', err);
                    req.session.flashMessages = { type: 'error', message: 'Login failed. Please try again.' };
                    return res.redirect('/login');
                }
                req.session.flashMessages = { type: 'success', message: 'Login successful!' };
                // Check for a returnTo URL for redirecting after login
                const returnTo = req.session.returnTo || '/';
                delete req.session.returnTo; // Clear it after use
                res.redirect(returnTo);
            });
        })
        .catch(error => {
            console.error('Login route error:', error.message);
            req.session.flashMessages = { type: 'error', message: error.message || 'Login failed. Invalid credentials.' };
            res.redirect('/login');
        });
});


// POST /logout - User logout
router.post('/logout', (req, res, next) => {
    const username = req.user ? (req.user.email || req.user.displayName || 'User') : 'User';
    req.logout((err) => {
        if (err) {
            console.error("Error during logout:", err);
            req.session.flashMessages = { type: 'error', message: 'Error during logout.' };
            // Even with error, try to redirect to login or home
            return res.redirect('/'); 
        }
        req.session.flashMessages = { type: 'success', message: 'You have been successfully logged out.' };
        console.log(`${username} logged out successfully.`);
        res.redirect('/login'); // Redirect to login page after logout
    });
});

// GET /link/google - Initiate linking Google account to an existing user
// User must be authenticated locally to link their Google account
router.get('/link/google', isAuthenticated, (req, res, next) => {
    // Store the local user ID in session to retrieve after Google callback
    req.session.linkingUserId = req.user.id; 
    passport.authenticate('google', { 
        scope: ['profile', 'email'],
        // Important: use a different callbackURL for linking vs. initial login if needed,
        // or handle context in the main Google callback. For now, assume main callback can handle it.
        // If a dedicated link callback is used, it should be configured in GoogleStrategy options too.
        // For simplicity, we might reuse the main /auth/google/callback and adapt its logic
        // or create a new strategy instance for linking if state parameter is not enough.
        // Using a state parameter is a common way:
        state: 'linking' 
    })(req, res, next);
});

// GET /link/google/callback - Callback for Google account linking
// This might need to be the same as the main /auth/google/callback,
// or a separate one if Google API allows multiple redirect URIs.
// If it's the same, the GoogleStrategy callback in authService.js needs to handle 'linking' state.
// For now, let's assume it's handled by the main Google callback,
// which will be updated in a later step.
// If a dedicated callback is needed:
// router.get('/link/google/callback', isAuthenticated, passport.authenticate('google', { failureRedirect: '/profile' }), async (req, res) => {
//    // Logic to link req.account (Google profile) to req.session.linkingUserId
//    // This would be custom logic if not handled by the main Google strategy callback
//    // ...
//    delete req.session.linkingUserId;
//    req.session.flashMessages = { type: 'success', message: 'Google account linked successfully!' };
//    res.redirect('/profile'); // Redirect to profile page or settings
// });


module.exports = router;
