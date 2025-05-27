const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');
const adminController = require('../controllers/adminController');
const settingsController = require('../controllers/settingsController'); // Import settings controller

// All routes in this file will be protected by isAuthenticated and isAdmin
router.use(isAuthenticated);
router.use(isAdmin);

// GET /admin/invitations - Display page to manage invitations
router.get('/invitations', async (req, res) => {
    try {
        const invitations = await adminController.listInvitations(req, res); // Call controller
        // Ensure your views path is configured in app.js if not already
        // app.set('view engine', 'ejs');
        // app.set('views', path.join(__dirname, 'views'));
        res.render('admin_invitations', { 
            invitations: invitations,
            // user: req.user, // user is now in res.locals
            pageTitle: "Admin - Invitations" 
        });
    } catch (error) {
        console.error("Error rendering admin invitations page:", error);
        res.status(500).send("Error loading admin invitations page.");
    }
});

// POST /admin/invitations/create - Generate a new invitation code
router.post('/invitations/create', async (req, res) => {
    try {
        const result = await adminController.generateInvitation(req, res); // Call controller
        if (result.success) {
            req.session.flashMessages = { type: 'success', message: `Invitation code ${result.code} created successfully.` };
            console.log(`Admin route: Invitation created - ${result.code}`);
        } else {
            req.session.flashMessages = { type: 'error', message: result.message || 'Failed to create invitation code.' };
            console.error(`Admin route: Failed to create invitation - ${result.message}`);
        }
        res.redirect('/admin/invitations'); // Redirect back to the invitations page
    } catch (error) {
        console.error("Error generating invitation via admin route:", error);
        req.session.flashMessages = { type: 'error', message: 'An unexpected error occurred while creating the invitation.' };
        res.redirect('/admin/invitations');
    }
});

// --- Application Settings Routes (Admin only) ---
// GET /admin/settings - Display the application settings page
router.get('/settings', settingsController.getAdminSettingsPage);

// POST /admin/settings - Handle submission of application settings form
router.post('/settings', settingsController.postAdminSettingsPage);

module.exports = router;
