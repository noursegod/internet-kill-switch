const express = require('express');
const router = express.Router();
const ejs = require('ejs'); // Added EJS
const path = require('path'); // Added Path
const { isAuthenticated } = require('../middleware/authMiddleware'); // Assuming isAdmin is not strictly needed for user's own schedules
const scheduleController = require('../controllers/scheduleController');
const db = require('../db/database'); // For fetching managed rules for the form

// Middleware to ensure user is authenticated for all schedule routes
router.use(isAuthenticated);

// GET /schedules - List all schedules for the logged-in user
router.get('/', async (req, res, next) => { // Added next
    try {
        // Data fetching remains the same
        const schedulesFromController = await scheduleController.listSchedulesForUser(req, res); // Renamed to avoid conflict
        const managedRulesFromDb = await db.getAllManagedRulesForUser({ userId: req.user.id }); // Renamed

        const pageData = {
            pageTitle: 'Manage Schedules',
            schedules: schedulesFromController,
            managedRules: managedRulesFromDb
            // user, currentPath, messages, queryMessages are in res.locals or handled by sessionFlashMessages
        };
        
        const contentHtml = await ejs.renderFile(
            path.join(req.app.get('views'), 'schedules.ejs'),
            { ...pageData, ...res.locals },
            { async: true }
        );
        res.render('layout', {
            pageTitle: pageData.pageTitle,
            body: contentHtml
        });
    } catch (error) {
        console.error("Error in GET /schedules (controller logic or rendering):", error);
        // req.flash('error', 'Could not load schedules page.'); // req.flash not reliable
        req.session.flashMessages = { type: 'error', message: 'Could not load schedules page.' };
        // res.redirect('/'); // Redirecting here might be problematic.
        next(error); // Propagate error
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
