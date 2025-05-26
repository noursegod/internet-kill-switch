function isAuthenticated(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) { // req.isAuthenticated() is added by Passport
        return next();
    }
    // For server-side rendered pages, redirect to login
    // For API requests, you might want to return a 401 status code
    if (req.accepts('html')) { // Check if the request prefers HTML
        // Store the original URL to redirect back after login
        req.session.returnTo = req.originalUrl; // Requires saveUninitialized:true for anonymous sessions
        console.log("isAuthenticated: User not authenticated, redirecting to /login. Original URL:", req.originalUrl);
        res.redirect('/auth/login?message=unauthenticated');
    } else {
        // For API requests, send a 401 Unauthorized status
        res.status(401).json({ error: 'User not authenticated. Please log in.' });
    }
}

function isAdmin(req, res, next) {
    // First, check if the user is authenticated
    if (req.isAuthenticated && req.isAuthenticated()) {
        // Then check if the authenticated user is an admin
        if (req.user && (req.user.is_admin === 1 || req.user.is_admin === true)) { // SQLite might return 1/0 for boolean
            return next();
        } else {
            // User is authenticated but not an admin
            console.log(`isAdmin: User ${req.user.email} is not an admin. Access denied.`);
            if (req.accepts('html')) {
                req.session.flashMessages = { type: 'error', message: 'Forbidden: You do not have admin privileges.' };
                res.status(403).redirect('/?error=forbidden'); // Redirect to home with error, or a specific forbidden page
            } else {
                res.status(403).json({ error: 'Forbidden: Admin privileges required.' });
            }
        }
    } else {
        // User is not even authenticated
        console.log("isAdmin: User not authenticated. Cannot check admin status.");
         if (req.accepts('html')) {
            req.session.returnTo = req.originalUrl; // Store original URL here too
            res.redirect('/auth/login?message=unauthenticated_admin_area'); // Corrected redirect to /auth/login
        } else {
            res.status(401).json({ error: 'User not authenticated. Please log in.' });
        }
    }
}

module.exports = { isAuthenticated, isAdmin };
