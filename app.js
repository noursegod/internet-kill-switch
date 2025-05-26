const express = require('express');
const crypto = require('crypto'); // Added for session secret generation
const dotenv = require('dotenv');
const path = require('path'); // Required for path.join
const session = require('express-session');
const passport = require('passport');

// Load environment variables from .env file
dotenv.config();

// Database and settings-related imports
const { initializeDatabase, getSetting, getAllSettings } = require('./db/database'); // Added getAllSettings

// --- Early Database Initialization & Settings Loading ---
// Initialize database synchronously here to make it available for config loading.
// better-sqlite3 is synchronous, so this is okay.
initializeDatabase(); 
console.log("Database connection initialized for configuration loading.");

let dbSettings = {};
let setupComplete = false;
try {
    // isInitialSetupComplete uses getSetting, which requires DB to be initialized.
    setupComplete = isInitialSetupComplete(); 
    if (setupComplete) {
        dbSettings = getAllSettings(); // Synchronous call
        console.log("INFO: Initial setup complete. Loaded settings from database.");
    } else {
        console.log("INFO: Initial setup not complete. Will use environment variables or defaults. Database settings (except setup flag) not loaded yet.");
    }
} catch (error) {
    console.error("Error during initial setup check or fetching settings from database. Proceeding with environment variables/defaults:", error);
    // setupComplete remains false, dbSettings remains empty.
}

// --- Initial Setup State Function (Definition moved before usage) ---
function isInitialSetupComplete() {
    try {
        // Ensure DB is initialized before trying to get a setting.
        // getDB() function from database.js handles initialization if not already done.
        // However, direct call to getSetting should be fine if initializeDatabase() in startServer
        // or an early getDB() call has already run.
        // If app.js ensures initializeDatabase() is called before routes that might trigger this,
        // then simply calling getSetting is okay.
        const setupComplete = getSetting('initial_setup_complete');
        return setupComplete === 'true';
    } catch (error) {
        // This might happen if the database isn't initialized yet or table AppSettings doesn't exist.
        // Log the error and assume setup is not complete.
        console.error("Error checking initial setup status from database, assuming setup not complete:", error.message);
        // It's crucial that if the DB isn't ready, we don't crash but default to "setup needed".
        return false; 
    }
}

// Services (some might be initialized after DB if they depend on it)
const { initializePassport } = require('./services/authService');
const schedulerService = require('./services/schedulerService');

// --- Application Setup ---
const app = express();

// --- Configuration Loading & Management ---
const DEFAULT_PLACEHOLDER = "!!MUST_BE_SET_IN_ENVIRONMENT!!";
const DEFAULT_SQLITE_URL = "sqlite:///app.db"; // Will be relative to project root if instance folder is not used

// Generate session secret if not provided (this needs to happen before app.config is defined)
let generatedSessionSecret = null;
if (!process.env.SESSION_SECRET && !(setupComplete && dbSettings.SESSION_SECRET)) {
    // Generate a secret if no env secret AND no DB secret (only if setup is complete for DB check)
    // Or if env secret is placeholder AND no DB secret
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === DEFAULT_PLACEHOLDER) {
        if (!(setupComplete && dbSettings.SESSION_SECRET)) { // Avoid generating if DB has one and setup is complete
            generatedSessionSecret = crypto.randomBytes(64).toString('hex');
            console.log("INFO: No SESSION_SECRET provided via environment or database (or setup not complete for DB check), and environment value is placeholder or missing. A new secure secret has been generated for initial setup or current use. This will be saved during setup if not already set.");
        }
    }
}


app.config = {
    // Priority:
    // 1. Generated (for initial setup, if no other source and env is placeholder)
    // 2. Database (if setup complete)
    // 3. Environment variable
    // 4. Default placeholder
    SESSION_SECRET: generatedSessionSecret || 
                           (setupComplete && dbSettings.SESSION_SECRET) || 
                           process.env.SESSION_SECRET || 
                           DEFAULT_PLACEHOLDER,
    
    DATABASE_URL: process.env.DATABASE_PATH || path.join(__dirname, 'instance', 'opnsense_controller.sqlite'), // DATABASE_URL is usually only from env/default

    OPNSENSE_API_KEY: (setupComplete && dbSettings.OPNSENSE_API_KEY) || 
                      process.env.OPNSENSE_API_KEY || 
                      DEFAULT_PLACEHOLDER,
    
    // For secrets like API secret, we check if it's in DB, then ENV.
    // The placeholder indicates it's not set by either.
    // The actual value for OPNSENSE_API_SECRET and GOOGLE_CLIENT_SECRET if sourced from DB will be the direct value.
    // If from ENV, it will be the ENV value.
    // These are not typically "!!MUST_BE_SET_IN_ENVIRONMENT!!" if they are missing but rather just undefined or empty.
    // The DEFAULT_PLACEHOLDER is more for things that MUST have a value.
    // However, to match the existing logic pattern of checking against DEFAULT_PLACEHOLDER in helpers, we'll keep it.
    OPNSENSE_API_SECRET: (setupComplete && dbSettings.OPNSENSE_API_SECRET) || 
                         process.env.OPNSENSE_API_SECRET || 
                         DEFAULT_PLACEHOLDER,
    
    OPNSENSE_BASE_URL: (setupComplete && dbSettings.OPNSENSE_BASE_URL) || 
                       process.env.OPNSENSE_BASE_URL || 
                       DEFAULT_PLACEHOLDER,
    
    GOOGLE_CLIENT_ID: (setupComplete && dbSettings.GOOGLE_CLIENT_ID) || 
                      process.env.GOOGLE_CLIENT_ID || 
                      DEFAULT_PLACEHOLDER,
    
    GOOGLE_CLIENT_SECRET: (setupComplete && dbSettings.GOOGLE_CLIENT_SECRET) || 
                          process.env.GOOGLE_CLIENT_SECRET || 
                          DEFAULT_PLACEHOLDER,
    
    APP_BASE_URL: (setupComplete && dbSettings.APP_BASE_URL) || 
                  process.env.APP_BASE_URL || 
                  `http://localhost:${process.env.PORT || 3000}`, // Default APP_BASE_URL includes PORT
    
    ADMIN_USER_GOOGLE_ID: (setupComplete && dbSettings.ADMIN_USER_GOOGLE_ID) || 
                          process.env.ADMIN_USER_GOOGLE_ID || 
                          null, // Optional, defaults to null

    PORT: process.env.PORT || 3000 // PORT is usually only from env/default
};

// Apply critical configurations directly
app.set('trust proxy', 1) // Trust first proxy, important for secure cookies if behind a reverse proxy like Nginx/Heroku
app.secret = app.config.SESSION_SECRET; // For express-session secret (used app.config for consistency)

// --- Startup Configuration Checks & Logging ---
console.log("--- Application Configuration Status ---");
if (app.config.SESSION_SECRET === DEFAULT_PLACEHOLDER && !generatedSessionSecret) { // Check if still placeholder AND no secret was generated
    console.error("CRITICAL: SESSION_SECRET is not set and could not be auto-generated. Application will not run securely. Please set this environment variable.");
    // process.exit(1); // Potentially exit if not allowing setup without it
} else if (app.config.SESSION_SECRET === DEFAULT_PLACEHOLDER && generatedSessionSecret) {
    console.warn("WARNING: SESSION_SECRET is using a temporarily generated value. Please complete the initial setup to persist it.");
} else if (generatedSessionSecret && app.config.SESSION_SECRET !== generatedSessionSecret) {
    // This case means an environment variable SESSION_SECRET was provided, and it's different from a generated one.
    // The generated one would only exist if the env var was missing or placeholder initially.
    // If app.config.SESSION_SECRET is now the env var, this comparison needs care.
    // The logic in app.config already prioritizes: generated || db || env.
    // So if generatedSessionSecret exists, it means it was used or db/env were missing.
    // If app.config.SESSION_SECRET is NOT generatedSessionSecret, it means it came from DB or ENV.
    console.info("INFO: SESSION_SECRET is loaded from Database or Environment. Auto-generated secret (if any) was not used or was overridden.");
} else if (!generatedSessionSecret && app.config.SESSION_SECRET !== DEFAULT_PLACEHOLDER) {
    // No secret was generated (meaning ENV or DB was available or ENV was not placeholder initially), and the loaded one is not the placeholder.
    console.info("INFO: SESSION_SECRET is loaded from Database or Environment variables.");
} else if (app.config.SESSION_SECRET !== DEFAULT_PLACEHOLDER) {
    // This covers the case where generatedSessionSecret was used and is not the placeholder
    console.info("INFO: SESSION_SECRET is using an auto-generated value.");
}

if (app.config.OPNSENSE_BASE_URL === DEFAULT_PLACEHOLDER) {
    console.warn("WARNING: OPNSENSE_BASE_URL is not set. OPNsense integration will be disabled.");
}
if (app.config.OPNSENSE_API_KEY === DEFAULT_PLACEHOLDER || app.config.OPNSENSE_API_SECRET === DEFAULT_PLACEHOLDER) {
    console.warn("WARNING: OPNsense API Key or Secret is not set. OPNsense API calls will fail.");
}
if (app.config.GOOGLE_CLIENT_ID === DEFAULT_PLACEHOLDER || app.config.GOOGLE_CLIENT_SECRET === DEFAULT_PLACEHOLDER) {
    console.warn("WARNING: Google OAuth Client ID or Secret is not set. Google OAuth login will be disabled.");
}
if (app.config.DATABASE_URL.includes('app.db') && !process.env.DATABASE_PATH) { // Check if using default SQLite path
    console.info(`INFO: Using default DATABASE_PATH: ${app.config.DATABASE_URL}. For production, consider a persistent database setup and ensure the 'instance' directory is writable or use an external DB.`);
}
console.log(`INFO: Application base URL configured to: ${app.config.APP_BASE_URL}`);
console.log("------------------------------------");


// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session Configuration
app.use(session({
    secret: app.config.SESSION_SECRET, // Use the same secret key
    resave: false,
    saveUninitialized: true, // True to store invitation code in session for anonymous users
    cookie: {
        secure: process.env.NODE_ENV === 'production' || app.config.APP_BASE_URL.startsWith('https://'), // Use secure cookies in production or if APP_BASE_URL is HTTPS
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Initialize Passport
initializePassport(app); // Pass app if passport config needs it (e.g. for app.config)
app.use(passport.initialize());
app.use(passport.session());

// --- Setup Redirect Middleware ---
function redirectToSetup(req, res, next) {
    const allowedSetupPaths = [
        '/setup',               // Allows GET and POST to /setup itself
        '/auth/google',         // Google OAuth start
        '/auth/google/callback',// Google OAuth callback
        '/auth/logout',         // Allow logging out
        // Static assets like CSS/JS for the setup page are typically served by express.static
        // *before* this middleware. If express.static finds and serves the file,
        // this middleware won't be reached for that request.
        // If specific /public paths were needed *and* express.static was after this,
        // they'd need to be listed, e.g., '/public/css/setup.css'.
    ];

    // Check if current path starts with any of the allowed paths
    const isAllowedPath = allowedSetupPaths.some(p => req.path.startsWith(p));

    if (!isInitialSetupComplete() && !isAllowedPath) {
        console.log(`INFO: Initial setup not complete. Redirecting to /setup from ${req.path}`);
        return res.redirect('/setup');
    }
    next();
}

// Apply setup redirect globally BEFORE other routes but after static and essential middleware
// Note: This might need careful placement if static assets for setup page are served by express.static
app.use(redirectToSetup);


// --- View Engine Setup (EJS) ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


// --- Configuration Status Helper Functions (made available via context processor/middleware) ---
function isSessionSecretProperlySet() { // Renamed function for clarity
    return app.config.SESSION_SECRET !== DEFAULT_PLACEHOLDER;
}
function isOpnsenseFullyConfigured() {
    return app.config.OPNSENSE_API_KEY !== DEFAULT_PLACEHOLDER &&
           app.config.OPNSENSE_API_SECRET !== DEFAULT_PLACEHOLDER &&
           app.config.OPNSENSE_BASE_URL !== DEFAULT_PLACEHOLDER;
}
function isGoogleOauthConfigured() {
    return app.config.GOOGLE_CLIENT_ID !== DEFAULT_PLACEHOLDER &&
           app.config.GOOGLE_CLIENT_SECRET !== DEFAULT_PLACEHOLDER;
}

// --- Context Processor Middleware (provides global variables to EJS templates) ---
app.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.currentPath = req.path;
    
    // Config status for templates
    res.locals.is_app_secret_key_configured = isSessionSecretProperlySet(); // Updated to use renamed function
    res.locals.is_opnsense_fully_configured = isOpnsenseFullyConfigured();
    res.locals.is_google_oauth_configured = isGoogleOauthConfigured();

    // Fallback for query param messages (if connect-flash not used)
    res.locals.queryMessages = {};
    if (req.query.error) res.locals.queryMessages.error = req.query.error;
    if (req.query.message) res.locals.queryMessages.message = req.query.message;
    
    // Session messages (alternative to connect-flash for simple messages)
    if (req.session.flashMessages) {
        res.locals.sessionFlashMessages = req.session.flashMessages;
        delete req.session.flashMessages; // Clear after use
    } else {
        res.locals.sessionFlashMessages = {};
    }

    next();
});


// --- Mount Routes ---
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const uiRoutes = require('./routes/uiRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const setupRoutes = require('./routes/setupRoutes'); // Import new setup routes


app.use('/setup', setupRoutes); // Use new setup routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/schedules', scheduleRoutes);
app.use('/', uiRoutes); // Should be last for general paths like '/'


// --- Server Startup ---
async function startServer() {
    try {
        // Allow startup if a secret was generated (pending setup completion) 
        // or if it's set directly in env/db and not the placeholder.
        const isSecretOkayForStartup = (app.config.SESSION_SECRET !== DEFAULT_PLACEHOLDER);

        if (!isSecretOkayForStartup && process.env.NODE_ENV !== 'test') {
            // This condition implies the final app.config.SESSION_SECRET is still the placeholder.
            // This should only happen if generation failed AND env/DB were also placeholders or missing.
            console.error("FATAL: SESSION_SECRET is not set (still default placeholder after all checks/generation attempts). The application cannot start securely.");
            console.error("Please set SESSION_SECRET in your environment variables or ensure it's configured in the database and setup is marked complete, or check generation logic.");
            process.exit(1);
        }
        // Specific warning if using a generated secret AND setup is not yet complete.
        if (generatedSessionSecret && app.config.SESSION_SECRET === generatedSessionSecret && !setupComplete && process.env.NODE_ENV !== 'test') {
            console.warn("WARNING: Application starting with a TEMPORARY, auto-generated SESSION_SECRET. Please complete the setup process to persist it.");
        }


        // initializeDatabase() was called earlier for config loading.
        // We can log success or perform other DB checks if needed.
        console.log("Database connection was previously initialized for config loading.");

        if (process.env.NODE_ENV !== 'test') {
            await schedulerService.loadAndScheduleAllActiveJobs();
        }

        app.listen(app.config.PORT, () => {
            console.log(`Server is running on http://localhost:${app.config.PORT} (App Base URL: ${app.config.APP_BASE_URL})`);
        });
    } catch (error) {
        console.error("Failed to start the server:", error);
        process.exit(1);
    }
}

// Handle unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Application specific logging, throwing an error, or other logic here
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Application specific logging, throwing an error, or other logic here
    // It's generally recommended to gracefully shut down the process after an uncaught exception
    process.exit(1); 
});


if (require.main === module) { // Ensure this block runs only when app.js is executed directly
    startServer();
}

module.exports = app; // For potential testing
// Export for testing purposes
module.exports.isInitialSetupCompleteForTest = isInitialSetupComplete;
