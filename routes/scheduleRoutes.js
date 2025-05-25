const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/authMiddleware'); // Assuming isAdmin is not strictly needed for user's own schedules
const scheduleController = require('../controllers/scheduleController');
const db = require('../db/database'); // For fetching managed rules for the form

// Middleware to ensure user is authenticated for all schedule routes
router.use(isAuthenticated);

// GET /schedules - List all schedules for the logged-in user
router.get('/', async (req, res) => {
    try {
        const schedules = await scheduleController.listSchedulesForUser(req, res);
        const managedRules = await db.getAllManagedRulesForUser({ userId: req.user.id });
        
        // Handle flash messages if connect-flash is integrated
        // const messages = req.flash(); // Example: { error: ['Msg 1'], success: ['Msg 2'] }

        res.render('schedules', {
            pageTitle: 'Manage Schedules',
            user: req.user,
            schedules: schedules,
            managedRules: managedRules, // For the "Add Schedule" form dropdown
            currentPath: '/schedules',
            messages: {} // Replace with actual flash messages if implemented
            // queryMessages: { error: req.query.error, success: req.query.success } // If using query params
        });
    } catch (error) {
        console.error("Error rendering schedules page:", error);
        // req.flash('error', 'Could not load schedules page.');
        res.redirect('/'); // Or render a generic error page
    }
});

// POST /schedules/create - Handle new schedule form submission
router.post('/create', async (req, res) => {
    try {
        // Data from form: req.body.managed_rule_id, req.body.cron_expression, etc.
        const result = await scheduleController.createSchedule(req, res);
        if (result.success) {
            req.session.flashMessages = { type: 'success', message: result.message || 'Schedule created successfully.' };
            console.log("Route: Schedule created successfully", result.schedule);
        } else {
            req.session.flashMessages = { type: 'error', message: result.message || 'Failed to create schedule.' };
            console.error("Route: Failed to create schedule", result.message);
        }
    } catch (error) {
        console.error("Error in POST /schedules/create:", error);
        req.session.flashMessages = { type: 'error', message: 'An unexpected error occurred while creating the schedule.' };
    }
    res.redirect('/schedules'); // Redirect back to the schedules list
});

// POST /schedules/:scheduleId/toggle - Toggle is_enabled status
router.post('/:scheduleId/toggle', async (req, res) => {
    try {
        const result = await scheduleController.toggleSchedule(req, res);
        if (result.success) {
            req.session.flashMessages = { type: 'success', message: result.message || 'Schedule status updated.' };
        } else {
            req.session.flashMessages = { type: 'error', message: result.message || 'Failed to update schedule status.' };
        }
    } catch (error) {
        console.error(`Error in POST /schedules/${req.params.scheduleId}/toggle:`, error);
        req.session.flashMessages = { type: 'error', message: 'An unexpected error occurred while toggling schedule status.' };
    }
    res.redirect('/schedules');
});

// POST /schedules/:scheduleId/delete - Delete a schedule
router.post('/:scheduleId/delete', async (req, res) => {
    try {
        const result = await scheduleController.deleteSchedule(req, res);
        if (result.success) {
            req.session.flashMessages = { type: 'success', message: result.message || 'Schedule deleted successfully.' };
        } else {
            req.session.flashMessages = { type: 'error', message: result.message || 'Failed to delete schedule.' };
        }
    } catch (error) {
        console.error(`Error in POST /schedules/${req.params.scheduleId}/delete:`, error);
        req.session.flashMessages = { type: 'error', message: 'An unexpected error occurred while deleting the schedule.' };
    }
    res.redirect('/schedules');
});

module.exports = router;
