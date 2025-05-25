function isAuthenticated(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) { // req.isAuthenticated() is added by Passport
        return next();
    }
    // For server-side rendered pages, redirect to login
    // For API requests, you might want to return a 401 status code
    if (req.accepts('html')) { // Check if the request prefers HTML
        // Store the original URL to redirect back after login
        // req.session.returnTo = req.originalUrl; // Requires saveUninitialized:true for anonymous sessions
        console.log("isAuthenticated: User not authenticated, redirecting to /login. Original URL:", req.originalUrl);
        res.redirect('/login?message=unauthenticated');
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
                // req.session.messages = ['Forbidden: You do not have admin privileges.']; // Example if using session for messages
                res.status(403).send('Forbidden: You do not have admin privileges. <a href="/">Go Home</a>'); // Simple HTML response
            } else {
                res.status(403).json({ error: 'Forbidden: Admin privileges required.' });
            }
        }
    } else {
        // User is not even authenticated
        console.log("isAdmin: User not authenticated. Cannot check admin status.");
         if (req.accepts('html')) {
            // req.session.returnTo = req.originalUrl;
            res.redirect('/login?message=unauthenticated_admin_area');
        } else {
            res.status(401).json({ error: 'User not authenticated. Please log in.' });
        }
    }
}

module.exports = { isAuthenticated, isAdmin };
