const { getSetting, setSetting, getAllSettings } = require('../db/database');

// This placeholder is used to check if a value is the default unconfigured one.
// It's defined in app.js and used for initial config population.
// We use it here to determine if a DB-retrieved value is effectively "not set".
const DEFAULT_PLACEHOLDER = "!!MUST_BE_SET_IN_ENVIRONMENT!!";

exports.getSetupPage = (req, res) => {
    try {
        const setupComplete = getSetting('initial_setup_complete') === 'true';
        if (setupComplete) {
            // If already setup, redirect away from setup page, perhaps to home or login
            return res.redirect('/');
        }

        // Prepare settings to pre-fill the form.
        // These are likely from environment variables or defaults at this stage,
        // reflected in req.app.config which was built considering env vars.
        // The SESSION_SECRET is the one currently active (generated or from env).
        const currentSettings = {
            APP_BASE_URL: req.app.config.APP_BASE_URL !== DEFAULT_PLACEHOLDER ? req.app.config.APP_BASE_URL : (process.env.APP_BASE_URL || ''),
            FLASK_APP_SECRET_KEY: req.app.config.FLASK_APP_SECRET_KEY, // This is the critical one, possibly auto-generated
            OPNSENSE_BASE_URL: req.app.config.OPNSENSE_BASE_URL !== DEFAULT_PLACEHOLDER ? req.app.config.OPNSENSE_BASE_URL : (process.env.OPNSENSE_BASE_URL || ''),
            OPNSENSE_API_KEY: req.app.config.OPNSENSE_API_KEY !== DEFAULT_PLACEHOLDER ? req.app.config.OPNSENSE_API_KEY : (process.env.OPNSENSE_API_KEY || ''),
            // Secrets are not pre-filled beyond what might be in app.config initially
            GOOGLE_CLIENT_ID: req.app.config.GOOGLE_CLIENT_ID !== DEFAULT_PLACEHOLDER ? req.app.config.GOOGLE_CLIENT_ID : (process.env.GOOGLE_CLIENT_ID || ''),
        };
        
        res.render('setup', { 
            title: 'Initial Application Setup',
            settings: currentSettings,
            // flashMessages are handled by res.locals in app.js normally
        });
    } catch (error) {
        console.error("Error in getSetupPage:", error);
        // req.session.flashMessages = { error: "Error loading setup page." }; // Requires session to be configured and saveUninitialized:true
        res.status(500).send("Error loading setup page. Please check logs.");
    }
};

exports.postSetupPage = (req, res) => {
    try {
        const setupAlreadyComplete = getSetting('initial_setup_complete') === 'true';
        if (setupAlreadyComplete) {
            // req.session.flashMessages = { error: "Setup has already been completed." };
            return res.redirect('/');
        }

        const {
            APP_BASE_URL,
            OPNSENSE_BASE_URL,
            OPNSENSE_API_KEY,
            OPNSENSE_API_SECRET, // This will be the new one from form
            GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET // This will be the new one from form
        } = req.body;

        // The SESSION_SECRET to save is the one that was generated/loaded into app.config
        // and shown (read-only) on the setup form.
        const sessionSecretToSave = req.app.config.FLASK_APP_SECRET_KEY;

        if (!sessionSecretToSave || sessionSecretToSave === DEFAULT_PLACEHOLDER) {
            // This should ideally not happen if generation logic is correct
            console.error("CRITICAL: Attempting to save an invalid session secret during setup.");
            // req.session.flashMessages = { error: "Critical error: Invalid session secret. Cannot complete setup." };
            return res.redirect('/setup');
        }
        
        // Save settings
        setSetting('APP_BASE_URL', APP_BASE_URL || ''); // Ensure empty string if undefined
        setSetting('SESSION_SECRET', sessionSecretToSave); 
        
        if (OPNSENSE_BASE_URL) setSetting('OPNSENSE_BASE_URL', OPNSENSE_BASE_URL);
        if (OPNSENSE_API_KEY) setSetting('OPNSENSE_API_KEY', OPNSENSE_API_KEY);
        if (OPNSENSE_API_SECRET) setSetting('OPNSENSE_API_SECRET', OPNSENSE_API_SECRET);
        
        if (GOOGLE_CLIENT_ID) setSetting('GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID);
        if (GOOGLE_CLIENT_SECRET) setSetting('GOOGLE_CLIENT_SECRET', GOOGLE_CLIENT_SECRET);

        // Mark setup as complete
        setSetting('initial_setup_complete', 'true');

        console.log("INFO: Initial setup completed successfully. Settings saved to database.");
        req.session.flashMessages = { success: "Application setup completed successfully! Please restart the application for all settings to take effect." };
        
        // Redirect to login or home page. User might need to log in again if session was temporary or not fully established.
        // A restart is generally good practice after initial setup.
        return res.redirect('/?message=setup_complete'); 

    } catch (error) {
        console.error("Error in postSetupPage:", error);
        req.session.flashMessages = { error: `Error saving setup: ${error.message}` };
        res.redirect('/setup');
    }
};


exports.getAdminSettingsPage = (req, res) => {
    try {
        const dbSettings = getAllSettings();
        const templateSettings = {
            APP_BASE_URL: dbSettings.APP_BASE_URL || '',
            OPNSENSE_BASE_URL: dbSettings.OPNSENSE_BASE_URL || '',
            OPNSENSE_API_KEY: dbSettings.OPNSENSE_API_KEY || '',
            GOOGLE_CLIENT_ID: dbSettings.GOOGLE_CLIENT_ID || '',
            
            // For display purposes in the template for the session secret
            FLASK_APP_SECRET_KEY: dbSettings.SESSION_SECRET || req.app.config.FLASK_APP_SECRET_KEY,

            // Boolean flags for secrets
            OPNSENSE_API_SECRET_IS_SET: !!(dbSettings.OPNSENSE_API_SECRET && dbSettings.OPNSENSE_API_SECRET !== DEFAULT_PLACEHOLDER && dbSettings.OPNSENSE_API_SECRET.trim() !== ''),
            GOOGLE_CLIENT_SECRET_IS_SET: !!(dbSettings.GOOGLE_CLIENT_SECRET && dbSettings.GOOGLE_CLIENT_SECRET !== DEFAULT_PLACEHOLDER && dbSettings.GOOGLE_CLIENT_SECRET.trim() !== ''),
            // SESSION_SECRET_IS_SET: !!(dbSettings.SESSION_SECRET && dbSettings.SESSION_SECRET !== DEFAULT_PLACEHOLDER && dbSettings.SESSION_SECRET.trim() !== '')
        };
        
        // Add a note about the current session secret status (from db or effective config)
        if (templateSettings.FLASK_APP_SECRET_KEY && templateSettings.FLASK_APP_SECRET_KEY !== DEFAULT_PLACEHOLDER) {
            templateSettings.SESSION_SECRET_STATUS_MESSAGE = "Currently Set (Loaded from DB or Environment). Cannot be changed here.";
        } else {
            templateSettings.SESSION_SECRET_STATUS_MESSAGE = "Not Set or Using Default Placeholder! This is a security risk. Set via Environment.";
        }


        res.render('admin_settings', {
            title: 'Admin - Application Settings',
            settings: templateSettings,
            // flashMessages are handled by res.locals in app.js
        });
    } catch (error) {
        console.error("Error in getAdminSettingsPage:", error);
        req.session.flashMessages = { error: "Error loading admin settings page." };
        res.redirect('/admin');
    }
};

exports.postAdminSettingsPage = (req, res) => {
    try {
        const {
            APP_BASE_URL,
            OPNSENSE_BASE_URL,
            OPNSENSE_API_KEY,
            NEW_OPNSENSE_API_SECRET,
            GOOGLE_CLIENT_ID,
            NEW_GOOGLE_CLIENT_SECRET
        } = req.body;

        let changesMade = false;
        let restartRequired = false;

        // Update non-secret settings
        if (APP_BASE_URL !== undefined) {
            const oldAppBaseUrl = getSetting('APP_BASE_URL');
            if (oldAppBaseUrl !== APP_BASE_URL) {
                setSetting('APP_BASE_URL', APP_BASE_URL);
                changesMade = true;
                restartRequired = true; // APP_BASE_URL changes often require restart for OAuth etc.
            }
        }
        if (OPNSENSE_BASE_URL !== undefined) {
            if(getSetting('OPNSENSE_BASE_URL') !== OPNSENSE_BASE_URL) {
                setSetting('OPNSENSE_BASE_URL', OPNSENSE_BASE_URL);
                changesMade = true;
            }
        }
        if (OPNSENSE_API_KEY !== undefined) {
             if(getSetting('OPNSENSE_API_KEY') !== OPNSENSE_API_KEY) {
                setSetting('OPNSENSE_API_KEY', OPNSENSE_API_KEY);
                changesMade = true;
            }
        }
        if (GOOGLE_CLIENT_ID !== undefined) {
            if(getSetting('GOOGLE_CLIENT_ID') !== GOOGLE_CLIENT_ID) {
                setSetting('GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID);
                changesMade = true;
                restartRequired = true; // GOOGLE_CLIENT_ID changes often require restart
            }
        }

        // Update secrets if new values are provided
        if (NEW_OPNSENSE_API_SECRET && NEW_OPNSENSE_API_SECRET.trim() !== '') {
            setSetting('OPNSENSE_API_SECRET', NEW_OPNSENSE_API_SECRET);
            changesMade = true;
        }
        if (NEW_GOOGLE_CLIENT_SECRET && NEW_GOOGLE_CLIENT_SECRET.trim() !== '') {
            setSetting('GOOGLE_CLIENT_SECRET', NEW_GOOGLE_CLIENT_SECRET);
            changesMade = true;
            restartRequired = true; // Google secret changes often require restart
        }
        
        if (changesMade) {
            let message = "Settings updated successfully.";
            if (restartRequired) {
                message += " An application restart is recommended for some changes to take full effect (e.g., Base URL, Google Client settings).";
            }
            req.session.flashMessages = { success: message };
        } else {
            req.session.flashMessages = { info: "No changes were made to the settings." };
        }

        res.redirect('/admin/settings');
    } catch (error) {
        console.error("Error in postAdminSettingsPage:", error);
        req.session.flashMessages = { error: `Error saving admin settings: ${error.message}` };
        res.redirect('/admin/settings');
    }
};
