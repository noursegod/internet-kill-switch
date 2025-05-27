const ejs = require('ejs'); // Added EJS
const path = require('path'); // Added Path
const { getSetting, setSetting, getAllSettings } = require('../db/database');

// Helper function for URL validation
function isValidHttpUrl(string) {
  if (!string) return false; // Catches empty or null strings early
  let url;
  try {
    url = new URL(string);
  } catch (_) {
    return false;  
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

// This placeholder is used to check if a value is the default unconfigured one.
// It's defined in app.js and used for initial config population.
// We use it here to determine if a DB-retrieved value is effectively "not set".
const DEFAULT_PLACEHOLDER = "!!MUST_BE_SET_IN_ENVIRONMENT!!";

exports.getSetupPage = async (req, res, next) => { // Made async, added next
    try {
        const setupComplete = getSetting('initial_setup_complete') === 'true';
        if (setupComplete) {
            return res.redirect('/');
        }

        const pageData = {
            pageTitle: 'Application Setup',
            settings: { // Initial settings from config/env (these are defaults before setup is complete)
                APP_BASE_URL: req.app.config.APP_BASE_URL !== DEFAULT_PLACEHOLDER ? req.app.config.APP_BASE_URL : (process.env.APP_BASE_URL || ''),
                SESSION_SECRET: req.app.config.SESSION_SECRET,
                OPNSENSE_BASE_URL: req.app.config.OPNSENSE_BASE_URL !== DEFAULT_PLACEHOLDER ? req.app.config.OPNSENSE_BASE_URL : (process.env.OPNSENSE_BASE_URL || ''),
                OPNSENSE_API_KEY: req.app.config.OPNSENSE_API_KEY !== DEFAULT_PLACEHOLDER ? req.app.config.OPNSENSE_API_KEY : (process.env.OPNSENSE_API_KEY || ''),
                GOOGLE_CLIENT_ID: req.app.config.GOOGLE_CLIENT_ID !== DEFAULT_PLACEHOLDER ? req.app.config.GOOGLE_CLIENT_ID : (process.env.GOOGLE_CLIENT_ID || ''),
            },
            formData: req.session.setupFormPrefill || {}
        };
        if (req.session.setupFormPrefill) delete req.session.setupFormPrefill;
        
        const contentHtml = await ejs.renderFile(
            path.join(req.app.get('views'), 'setup.ejs'),
            { ...pageData, ...res.locals },
            { async: true }
        );
        res.render('layout', {
            pageTitle: pageData.pageTitle,
            body: contentHtml
        });
    } catch (err) { // Changed error variable name for consistency
        console.error(`Error in getSetupPage or rendering setup.ejs/layout:`, err);
        // req.session.flashMessages = { error: "Error loading setup page. Please check logs." };
        // res.redirect('/login'); // Redirecting here might be problematic.
        next(err); // Propagate error
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
            OPNSENSE_API_SECRET,
            GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET
        } = req.body;

        // Validation
        if (!APP_BASE_URL || APP_BASE_URL.trim() === '') {
            req.session.flashMessages = { error: "Validation failed: Application Base URL is required." };
            req.session.setupFormPrefill = req.body;
            return res.redirect('/setup');
        }
        if (!isValidHttpUrl(APP_BASE_URL)) {
            req.session.flashMessages = { error: "Validation failed: Application Base URL must be a valid HTTP/HTTPS URL." };
            req.session.setupFormPrefill = req.body;
            return res.redirect('/setup');
        }
        if (OPNSENSE_BASE_URL && !isValidHttpUrl(OPNSENSE_BASE_URL)) {
            req.session.flashMessages = { error: "Validation failed: OPNsense Base URL must be a valid HTTP/HTTPS URL if provided." };
            req.session.setupFormPrefill = req.body;
            return res.redirect('/setup');
        }
        if (OPNSENSE_BASE_URL && OPNSENSE_BASE_URL.trim() !== '' && (!OPNSENSE_API_KEY || OPNSENSE_API_KEY.trim() === '' || !OPNSENSE_API_SECRET || OPNSENSE_API_SECRET.trim() === '')) {
            req.session.flashMessages = { error: "Validation failed: If OPNsense Base URL is provided, API Key and Secret are required."};
            req.session.setupFormPrefill = req.body;
            return res.redirect('/setup');
        }
        if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.trim() !== '' && (!GOOGLE_CLIENT_SECRET || GOOGLE_CLIENT_SECRET.trim() === '')) {
            req.session.flashMessages = { error: "Validation failed: If Google Client ID is provided, Google Client Secret is required."};
            req.session.setupFormPrefill = req.body;
            return res.redirect('/setup');
        }
        // Add more specific checks for other fields if necessary (e.g. not just whitespace)

        const sessionSecretToSave = req.app.config.SESSION_SECRET; // Updated key
        if (!sessionSecretToSave || sessionSecretToSave === DEFAULT_PLACEHOLDER) {
            console.error("CRITICAL: Attempting to save an invalid session secret during setup.");
            req.session.flashMessages = { error: "Critical error: Invalid session secret. Cannot complete setup." };
            return res.redirect('/setup');
        }
        
        // Save settings (ensure empty strings for optional fields if not provided, to clear them if necessary)
        setSetting('APP_BASE_URL', APP_BASE_URL);
        setSetting('SESSION_SECRET', sessionSecretToSave); 
        
        setSetting('OPNSENSE_BASE_URL', OPNSENSE_BASE_URL || '');
        setSetting('OPNSENSE_API_KEY', OPNSENSE_API_KEY || '');
        if (OPNSENSE_API_SECRET && OPNSENSE_API_SECRET.trim() !== '') setSetting('OPNSENSE_API_SECRET', OPNSENSE_API_SECRET);
        else if (!OPNSENSE_BASE_URL) setSetting('OPNSENSE_API_SECRET', ''); // Clear if base url also cleared
        
        setSetting('GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID || '');
        if (GOOGLE_CLIENT_SECRET && GOOGLE_CLIENT_SECRET.trim() !== '') setSetting('GOOGLE_CLIENT_SECRET', GOOGLE_CLIENT_SECRET);
        else if (!GOOGLE_CLIENT_ID) setSetting('GOOGLE_CLIENT_SECRET', ''); // Clear if client id also cleared

        setSetting('initial_setup_complete', 'true');
        delete req.session.setupFormPrefill; // Clear prefill data on success

        console.log("INFO: Initial setup completed successfully. Settings saved to database.");
        req.session.flashMessages = { success: "Application setup completed successfully! Please restart the application for all settings to take effect." };
        
        return res.redirect('/?message=setup_complete'); 

    } catch (error) {
        console.error("Error in postSetupPage:", error);
        req.session.flashMessages = { error: `Error saving setup: ${error.message}` };
        req.session.setupFormPrefill = req.body; // Preserve data on unexpected error too
        res.redirect('/setup');
    }
};


exports.getAdminSettingsPage = (req, res) => {
    try {
        const dbSettings = getAllSettings();
        const formData = req.session.adminSettingsFormPrefill || {};
        delete req.session.adminSettingsFormPrefill;

        const templateSettings = {
            // Prioritize formData for prefill, then dbSettings, then empty string
            APP_BASE_URL: formData.APP_BASE_URL || dbSettings.APP_BASE_URL || '',
            OPNSENSE_BASE_URL: formData.OPNSENSE_BASE_URL || dbSettings.OPNSENSE_BASE_URL || '',
            OPNSENSE_API_KEY: formData.OPNSENSE_API_KEY || dbSettings.OPNSENSE_API_KEY || '',
            GOOGLE_CLIENT_ID: formData.GOOGLE_CLIENT_ID || dbSettings.GOOGLE_CLIENT_ID || '',
            
            // For display purposes in the template for the session secret
            SESSION_SECRET_DISPLAY: dbSettings.SESSION_SECRET || req.app.config.SESSION_SECRET, // Updated key

            OPNSENSE_API_SECRET_IS_SET: !!(dbSettings.OPNSENSE_API_SECRET && dbSettings.OPNSENSE_API_SECRET !== DEFAULT_PLACEHOLDER && dbSettings.OPNSENSE_API_SECRET.trim() !== ''),
            GOOGLE_CLIENT_SECRET_IS_SET: !!(dbSettings.GOOGLE_CLIENT_SECRET && dbSettings.GOOGLE_CLIENT_SECRET !== DEFAULT_PLACEHOLDER && dbSettings.GOOGLE_CLIENT_SECRET.trim() !== ''),
        };
        
        // Use the new display key for the status message logic
        if (templateSettings.SESSION_SECRET_DISPLAY && templateSettings.SESSION_SECRET_DISPLAY !== DEFAULT_PLACEHOLDER) {
            templateSettings.SESSION_SECRET_STATUS_MESSAGE = "Currently Set (Loaded from DB or Environment). Cannot be changed here.";
        } else {
            templateSettings.SESSION_SECRET_STATUS_MESSAGE = "Not Set or Using Default Placeholder! This is a security risk. Set via Environment.";
        }

        const pageData = {
            pageTitle: 'Admin - Settings',
            settings: templateSettings,
            formData: formData
        };

        const contentHtml = await ejs.renderFile(
            path.join(req.app.get('views'), 'admin_settings.ejs'),
            { ...pageData, ...res.locals },
            { async: true }
        );
        res.render('layout', {
            pageTitle: pageData.pageTitle,
            body: contentHtml
        });
    } catch (err) { // Changed error variable name for consistency
        console.error(`Error in getAdminSettingsPage or rendering admin_settings.ejs/layout:`, err);
        // req.session.flashMessages = { error: "Error loading admin settings page." };
        // res.redirect('/admin'); // Redirecting here might be problematic.
        next(err); // Propagate error
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

        // Validation
        if (APP_BASE_URL && !isValidHttpUrl(APP_BASE_URL)) {
            req.session.flashMessages = { error: "Validation failed: Application Base URL must be a valid HTTP/HTTPS URL." };
            req.session.adminSettingsFormPrefill = req.body;
            return res.redirect('/admin/settings');
        }
        if (OPNSENSE_BASE_URL && !isValidHttpUrl(OPNSENSE_BASE_URL)) {
            req.session.flashMessages = { error: "Validation failed: OPNsense Base URL must be a valid HTTP/HTTPS URL if provided." };
            req.session.adminSettingsFormPrefill = req.body;
            return res.redirect('/admin/settings');
        }
        if (NEW_OPNSENSE_API_SECRET && NEW_OPNSENSE_API_SECRET.trim() === '') {
            req.session.flashMessages = { error: "Validation failed: New OPNsense API Secret cannot be just whitespace if provided." };
            req.session.adminSettingsFormPrefill = req.body;
            return res.redirect('/admin/settings');
        }
        if (NEW_GOOGLE_CLIENT_SECRET && NEW_GOOGLE_CLIENT_SECRET.trim() === '') {
            req.session.flashMessages = { error: "Validation failed: New Google Client Secret cannot be just whitespace if provided." };
            req.session.adminSettingsFormPrefill = req.body;
            return res.redirect('/admin/settings');
        }
        // Ensure that if OPNsense API Key is provided, the URL is also there
        if (OPNSENSE_API_KEY && OPNSENSE_API_KEY.trim() !== '' && (!OPNSENSE_BASE_URL || OPNSENSE_BASE_URL.trim() === '')) {
            req.session.flashMessages = { error: "Validation failed: OPNsense Base URL is required if OPNsense API Key is provided." };
            req.session.adminSettingsFormPrefill = req.body;
            return res.redirect('/admin/settings');
        }
        // Ensure that if Google Client ID is provided, the secret is also there (or new one)
        const currentGoogleSecretIsSet = !!(getSetting('GOOGLE_CLIENT_SECRET') && getSetting('GOOGLE_CLIENT_SECRET') !== DEFAULT_PLACEHOLDER && getSetting('GOOGLE_CLIENT_SECRET').trim() !== '');
        if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.trim() !== '' && !currentGoogleSecretIsSet && (!NEW_GOOGLE_CLIENT_SECRET || NEW_GOOGLE_CLIENT_SECRET.trim() === '')) {
            req.session.flashMessages = { error: "Validation failed: Google Client Secret is required if Google Client ID is provided and no secret is currently set." };
            req.session.adminSettingsFormPrefill = req.body;
            return res.redirect('/admin/settings');
        }


        let changesMade = false;
        let restartRequired = false;

        if (APP_BASE_URL !== undefined) {
            const oldAppBaseUrl = getSetting('APP_BASE_URL') || (process.env.APP_BASE_URL || '');
            if (oldAppBaseUrl !== APP_BASE_URL) {
                setSetting('APP_BASE_URL', APP_BASE_URL);
                changesMade = true;
                restartRequired = true; 
            }
        }
        if (OPNSENSE_BASE_URL !== undefined) {
            const oldOpnBaseUrl = getSetting('OPNSENSE_BASE_URL') || (process.env.OPNSENSE_BASE_URL || '');
            if(oldOpnBaseUrl !== OPNSENSE_BASE_URL) {
                setSetting('OPNSENSE_BASE_URL', OPNSENSE_BASE_URL);
                changesMade = true;
            }
        }
        if (OPNSENSE_API_KEY !== undefined) {
            const oldOpnApiKey = getSetting('OPNSENSE_API_KEY') || (process.env.OPNSENSE_API_KEY || '');
             if(oldOpnApiKey !== OPNSENSE_API_KEY) {
                setSetting('OPNSENSE_API_KEY', OPNSENSE_API_KEY);
                changesMade = true;
            }
        }
        if (GOOGLE_CLIENT_ID !== undefined) {
            const oldGoogleClientId = getSetting('GOOGLE_CLIENT_ID') || (process.env.GOOGLE_CLIENT_ID || '');
            if(oldGoogleClientId !== GOOGLE_CLIENT_ID) {
                setSetting('GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID);
                changesMade = true;
                restartRequired = true; 
            }
        }

        if (NEW_OPNSENSE_API_SECRET && NEW_OPNSENSE_API_SECRET.trim() !== '') {
            setSetting('OPNSENSE_API_SECRET', NEW_OPNSENSE_API_SECRET);
            changesMade = true;
        }
        if (NEW_GOOGLE_CLIENT_SECRET && NEW_GOOGLE_CLIENT_SECRET.trim() !== '') {
            setSetting('GOOGLE_CLIENT_SECRET', NEW_GOOGLE_CLIENT_SECRET);
            changesMade = true;
            restartRequired = true; 
        }
        
        if (changesMade) {
            let message = "Settings updated successfully.";
            if (restartRequired) {
                message += " An application restart is recommended for some changes to take full effect.";
            }
            req.session.flashMessages = { success: message };
        } else {
            req.session.flashMessages = { info: "No changes were made to the settings." };
        }
        delete req.session.adminSettingsFormPrefill; // Clear prefill data on success or no change

        res.redirect('/admin/settings');
    } catch (error) {
        console.error("Error in postAdminSettingsPage:", error);
        req.session.flashMessages = { error: `Error saving admin settings: ${error.message}` };
        req.session.adminSettingsFormPrefill = req.body; // Preserve data on unexpected error too
        res.redirect('/admin/settings');
    }
};
