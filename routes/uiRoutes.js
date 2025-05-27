const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/authMiddleware');
const OpnsenseService = require('../services/opnsenseService'); // Assuming OpnsenseService is default export
const db = require('../db/database'); // Access all DB functions via this
const { DEFAULT_PLACEHOLDER } = require('../app'); // Import placeholder for config checks, if app.js exports it, or define locally

// Helper to get OPNsense service instance
function getOpnsenseServiceInstance() {
    if (process.env.OPNSENSE_BASE_URL && process.env.OPNSENSE_BASE_URL !== DEFAULT_PLACEHOLDER &&
        process.env.OPNSENSE_API_KEY && process.env.OPNSENSE_API_KEY !== DEFAULT_PLACEHOLDER &&
        process.env.OPNSENSE_API_SECRET && process.env.OPNSENSE_API_SECRET !== DEFAULT_PLACEHOLDER) {
        return new OpnsenseService(
            process.env.OPNSENSE_BASE_URL,
            process.env.OPNSENSE_API_KEY,
            process.env.OPNSENSE_API_SECRET
        );
    }
    return null;
}

// GET / - Home/Index page
router.get('/', (req, res) => {
    const queryMessages = {};
    if (req.query.error) queryMessages.error = req.query.error;
    if (req.query.message) queryMessages.message = req.query.message;

    if (req.query.invitation_code) {
        req.session.invitationCode = req.query.invitation_code;
        console.log(`Invitation code ${req.query.invitation_code} stored in session.`);
        return res.redirect('/'); // Redirect to clean the URL
    }

    if (req.isAuthenticated()) {
        // If authenticated, and was trying to use an invitation, clear it now it's "seen"
        // The actual use of invitation happens at registration/first login in authService.js
        // if (req.session.invitationCode) { 
        //     // We might not want to clear it here, but rather after successful registration/link.
        //     // For now, let's assume authService handles clearing it post-registration.
        // }
        return res.render('index', { 
            pageTitle: 'Welcome - OPNsense Rule Controller', // Added pageTitle
            // user: req.user, // now in res.locals
            invitationCode: req.session.invitationCode, // Pass to template if needed
            // queryMessages, // now in res.locals
            // currentPath: '/' // now in res.locals
        });
    } else {
        // Not authenticated
        return res.render('index', { 
            pageTitle: 'Welcome - OPNsense Rule Controller', // Added pageTitle
            // user: null, // now in res.locals
            invitationCode: req.session.invitationCode,
            // queryMessages, // now in res.locals
            // currentPath: '/' // now in res.locals
        });
    }
});

// GET /login - Render login page
router.get('/login', (req, res) => {
    const queryMessages = {};
    if (req.query.error) queryMessages.error = req.query.error;
    if (req.query.message) queryMessages.message = req.query.message;
    
    // Pass any specific messages for the login page, e.g., from auth failures
    // req.flash() messages are not set up yet, so using query params for now.
    res.render('login', { 
        pageTitle: 'Login - OPNsense Rule Controller', // Added pageTitle
        // user: null, // now in res.locals
        // currentPath: '/login', // now in res.locals
        // messages: req.session.messages || [], // Placeholder for connect-flash; sessionFlashMessages is global
        // queryMessages // Pass query-based messages; queryMessages is global
    });
    // req.session.messages = []; // Clear messages after displaying // sessionFlashMessages handles this
});


// GET /rules - Display managed rules and fetched OPNsense rules
router.get('/rules', isAuthenticated, async (req, res) => {
    const userId = req.user.id;
    let managedRulesWithStatus = [];
    let fetchedOpnsenseRules = req.session.fetchedOpnsenseRules || null; // Get from session if previously fetched
    let vlanFilterValue = req.session.vlanFilterValue || ''; // Persist filter value

    const opnsenseService = getOpnsenseServiceInstance();
    
    try {
        const userManagedRules = await db.getAllManagedRulesForUser({ userId });

        if (opnsenseService) {
            let liveOpnsenseRules = [];
            try {
                liveOpnsenseRules = await opnsenseService.fetchFirewallRules();
            } catch (opnsenseError) {
                console.error("Error fetching live OPNsense rules for /rules page:", opnsenseError);
                req.flash('error', 'Could not connect to OPNsense to get live rule statuses.'); // Requires connect-flash
            }

            const liveRulesMap = new Map(liveOpnsenseRules.map(r => [r.uuid, r]));

            managedRulesWithStatus = userManagedRules.map(mRule => {
                const liveRule = liveRulesMap.get(mRule.opnsense_rule_uuid);
                let liveStatus = 'unknown'; // Default if not found or error
                if (liveRule) {
                    liveStatus = liveRule.enabled ? 'enabled' : 'disabled';
                } else if (opnsenseService) { // If service is up but rule not in list
                    liveStatus = 'not_found';
                } else { // If service is down
                    liveStatus = 'client_error';
                }
                
                // Check for active timer on the managed rule
                let timerInfo = null;
                if (mRule.timer_active_until) {
                    const now = new Date();
                    const expiry = new Date(mRule.timer_active_until);
                    if (expiry > now) {
                        timerInfo = {
                            expires_in_seconds: Math.round((expiry - now) / 1000),
                            action_on_expiry: mRule.timer_action_on_expiry
                        };
                    }
                }

                return { ...mRule, live_opnsense_status: liveStatus, timer_info: timerInfo };
            });

            // If fetchedOpnsenseRules are from a specific fetch action, filter them if needed
            if (fetchedOpnsenseRules && vlanFilterValue) {
                 fetchedOpnsenseRules = fetchedOpnsenseRules.filter(r => r.interface && r.interface.includes(vlanFilterValue));
            }


        } else {
            // OPNsense not configured, just show DB state
            managedRulesWithStatus = userManagedRules.map(mRule => ({
                ...mRule,
                live_opnsense_status: 'opnsense_unavailable',
                timer_info: null // Cannot determine timer without OPNsense usually
            }));
            req.flash('warning', 'OPNsense API not configured. Displaying stored data only.');
        }
        
        res.render('rules', {
            pageTitle: 'Manage Firewall Rules', // Added pageTitle
            // user: req.user, // now in res.locals
            managedRules: managedRulesWithStatus,
            fetchedOpnsenseRules: fetchedOpnsenseRules, // From session or null
            vlanFilterValue: vlanFilterValue, // For the input field
            // currentPath: '/rules', // now in res.locals
            // messages: req.flash ? req.flash() : {} // For connect-flash if used; sessionFlashMessages is global
        });
    } catch (error) {
        console.error("Error in GET /rules:", error);
        req.flash('error', 'Failed to load rule management page.');
        res.redirect('/'); // Or render an error page
    }
});

// POST /rules/fetch-opnsense - Fetch rules from OPNsense
router.post('/rules/fetch-opnsense', isAuthenticated, async (req, res) => {
    const vlanFilter = req.body.vlanFilter || null;
    const opnsenseService = getOpnsenseServiceInstance();

    if (!opnsenseService) {
        req.flash('error', 'OPNsense API not configured. Cannot fetch rules.');
        return res.redirect('/rules');
    }
    try {
        let rules = await opnsenseService.fetchFirewallRules();
        // Store in session for display on the /rules GET route
        req.session.fetchedOpnsenseRules = rules; 
        req.session.vlanFilterValue = vlanFilter; // Store filter for display
        req.flash('success', `Fetched ${rules.length} rules from OPNsense.` + (vlanFilter ? ` Filter attempted for '${vlanFilter}'.` : ''));
    } catch (error) {
        console.error("Error fetching OPNsense rules:", error);
        req.flash('error', `Failed to fetch rules from OPNsense: ${error.message}`);
        req.session.fetchedOpnsenseRules = null; // Clear on error
    }
    res.redirect('/rules');
});

// POST /rules/manage/add - Add an OPNsense rule to managed list
router.post('/rules/manage/add', isAuthenticated, async (req, res) => {
    const { opnsense_rule_uuid, description } = req.body;
    const userId = req.user.id;

    if (!opnsense_rule_uuid) {
        req.flash('error', 'OPNsense Rule UUID is required.');
        return res.redirect('/rules');
    }
    try {
        await db.addManagedRule({ uuid: opnsense_rule_uuid, description, userId, desiredState: false }); // Default to false (disabled)
        req.flash('success', `Rule ${description || opnsense_rule_uuid} added to managed list.`);
    } catch (error) {
        console.error("Error adding managed rule:", error);
        req.flash('error', `Failed to add rule: ${error.message}`);
    }
    res.redirect('/rules');
});

// POST /rules/manage/:ruleUuid/toggle - Toggle the state of a managed rule
router.post('/rules/manage/:ruleUuid/toggle', isAuthenticated, async (req, res) => {
    const { ruleUuid } = req.params;
    const userId = req.user.id;
    const opnsenseService = getOpnsenseServiceInstance();

    if (!opnsenseService) {
        req.session.flashMessages = { type: 'error', message: 'OPNsense API not configured. Cannot toggle rule.' };
        return res.redirect('/rules');
    }
    try {
        const managedRule = await db.getManagedRuleByUuid({ uuid: ruleUuid, userId });
        if (!managedRule) {
            req.session.flashMessages = { type: 'error', message: 'Rule not found or not managed by you.' };
            return res.redirect('/rules');
        }

        // Clear any active timer before manual toggle
        if (managedRule.timer_active_until && new Date(managedRule.timer_active_until) > new Date()) {
            await db.updateManagedRuleTimer({ uuid: ruleUuid, userId, timerActiveUntil: null, timerActionOnExpiry: null });
            req.session.flashMessages = { type: 'info', message: `Active timer for rule ${managedRule.description || ruleUuid} cleared due to manual toggle.` };
            // Note: This will overwrite subsequent success/error messages for the toggle itself if not handled carefully.
            // A better approach might be to collect messages in an array in req.session.flashMessages.
            // For now, the last message set wins.
        }

        // Determine target state based on current *desired_state* in DB
        const newDesiredState = !managedRule.desired_state; 
        let opnsenseSuccess;

        if (newDesiredState) { // If new desired state is to enable
            opnsenseSuccess = await opnsenseService.enableRule(ruleUuid);
        } else { // If new desired state is to disable
            opnsenseSuccess = await opnsenseService.disableRule(ruleUuid);
        }

        if (opnsenseSuccess) {
            await db.updateManagedRuleDesiredState({ uuid: ruleUuid, userId, desiredState: newDesiredState });
            req.session.flashMessages = { type: 'success', message: `Rule ${managedRule.description || ruleUuid} desired state changed to ${newDesiredState ? 'Enabled' : 'Disabled'}, and OPNsense updated.` };
        } else {
            // If OPNsense action failed, we don't update the desired_state in the DB.
            // The user will see the discrepancy and can try again.
            req.session.flashMessages = { type: 'error', message: `Failed to update rule ${managedRule.description || ruleUuid} on OPNsense. Desired state in app unchanged.` };
        }
    } catch (error) {
        console.error(`Error toggling rule ${ruleUuid}:`, error);
        req.session.flashMessages = { type: 'error', message: `Error toggling rule: ${error.message}` };
    }
    res.redirect('/rules');
});

// POST /rules/manage/:ruleUuid/remove - Remove a rule from management
router.post('/rules/manage/:ruleUuid/remove', isAuthenticated, async (req, res) => {
    const { ruleUuid } = req.params;
    const userId = req.user.id;
    try {
        const changes = await db.removeManagedRule({ uuid: ruleUuid, userId });
        if (changes > 0) {
            req.session.flashMessages = { type: 'success', message: `Rule ${ruleUuid} removed from management.` };
        } else {
            req.session.flashMessages = { type: 'error', message: 'Rule not found or not managed by you.' };
        }
    } catch (error) {
        console.error(`Error removing managed rule ${ruleUuid}:`, error);
        req.session.flashMessages = { type: 'error', message: `Error removing rule: ${error.message}` };
    }
    res.redirect('/rules');
});

// --- Timer Routes for Managed Rules ---
router.post('/rules/manage/:ruleUuid/timer/start', isAuthenticated, async (req, res) => {
    const { ruleUuid } = req.params;
    const userId = req.user.id;
    const { duration_minutes, action_during_timer } = req.body;

    if (!duration_minutes || !action_during_timer) {
        req.session.flashMessages = { type: 'error', message: 'Duration and action for timer are required.' };
        return res.redirect('/rules');
    }
    if (!isOpnsenseFullyConfigured()) { 
        req.session.flashMessages = { type: 'error', message: 'OPNsense is not fully configured. Cannot start timer.' };
        return res.redirect('/rules');
    }

    try {
        const rule = await db.getManagedRuleByUuid({ uuid: ruleUuid, userId });
        if (!rule) {
            req.session.flashMessages = { type: 'error', message: 'Managed rule not found.' };
            return res.redirect('/rules');
        }

        const opnsenseService = getOpnsenseServiceInstance(); 
        let opnsenseActionSuccess = false;
        const targetStateDuringTimer = action_during_timer === 'enable';
        
        if (targetStateDuringTimer) {
            opnsenseActionSuccess = await opnsenseService.enableRule(ruleUuid);
        } else {
            opnsenseActionSuccess = await opnsenseService.disableRule(ruleUuid);
        }

        if (opnsenseActionSuccess) {
            const expiryTime = new Date(Date.now() + parseInt(duration_minutes) * 60000);
            const actionOnExpiry = targetStateDuringTimer ? 'disable' : 'enable';
            await db.updateManagedRuleTimer({ 
                uuid: ruleUuid, 
                userId, 
                timerActiveUntil: expiryTime.toISOString(), 
                timerActionOnExpiry: actionOnExpiry 
            });
            await db.updateManagedRuleDesiredState({ uuid: ruleUuid, userId, desiredState: targetStateDuringTimer});
            req.session.flashMessages = { type: 'success', message: `Timer started for rule ${rule.description || ruleUuid}. It will be ${action_during_timer}d for ${duration_minutes} minutes.` };
        } else {
            req.session.flashMessages = { type: 'error', message: `Failed to ${action_during_timer} rule ${rule.description || ruleUuid} on OPNsense to start timer.` };
        }
    } catch (error) {
        console.error(`Error starting timer for rule ${ruleUuid}:`, error);
        req.session.flashMessages = { type: 'error', message: `Error starting timer: ${error.message}` };
    }
    res.redirect('/rules');
});

router.post('/rules/manage/:ruleUuid/timer/cancel', isAuthenticated, async (req, res) => {
    const { ruleUuid } = req.params;
    const userId = req.user.id;
    try {
        const rule = await db.getManagedRuleByUuid({ uuid: ruleUuid, userId });
        if (!rule) {
            req.session.flashMessages = { type: 'error', message: 'Managed rule not found.' };
            return res.redirect('/rules');
        }
        await db.updateManagedRuleTimer({ uuid: ruleUuid, userId, timerActiveUntil: null, timerActionOnExpiry: null });
        req.session.flashMessages = { type: 'success', message: `Timer cancelled for rule ${rule.description || ruleUuid}.` };
    } catch (error) {
        console.error(`Error cancelling timer for rule ${ruleUuid}:`, error);
        req.session.flashMessages = { type: 'error', message: `Error cancelling timer: ${error.message}` };
    }
    res.redirect('/rules');
});


module.exports = router;

// Helper to check full OPNsense configuration for route handlers
// Re-defined here to avoid import complexities if app.js DEFAULT_PLACEHOLDER is not exported
const OPNSENSE_DEFAULT_PLACEHOLDER = "!!MUST_BE_SET_IN_ENVIRONMENT!!"; // Or import if available
function isOpnsenseFullyConfigured() {
    return process.env.OPNSENSE_API_KEY && process.env.OPNSENSE_API_KEY !== OPNSENSE_DEFAULT_PLACEHOLDER &&
           process.env.OPNSENSE_API_SECRET && process.env.OPNSENSE_API_SECRET !== OPNSENSE_DEFAULT_PLACEHOLDER &&
           process.env.OPNSENSE_BASE_URL && process.env.OPNSENSE_BASE_URL !== OPNSENSE_DEFAULT_PLACEHOLDER;
}

// Note: connect-flash middleware is not installed yet.
// req.flash() calls are placeholders and will not work until it's added and configured in app.js.
// For now, user feedback might be limited or rely on redirects with query parameters.
