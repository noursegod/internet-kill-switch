const express = require('express');
const dotenv = require('dotenv');
const path = require('path'); // Required for path.join
const session = require('express-session');
const passport = require('passport');
// const flash = require('connect-flash'); // Optional: for flash messages

// Load environment variables from .env file
dotenv.config();

// Initialize Database (must be done before services that might use it at module level)
const { initializeDatabase } = require('./db/database'); 

// Services (some might be initialized after DB if they depend on it)
const { initializePassport } = require('./services/authService');
const schedulerService = require('./services/schedulerService');

// --- Application Setup ---
const app = express();

// --- Configuration Loading & Management ---
const DEFAULT_PLACEHOLDER = "!!MUST_BE_SET_IN_ENVIRONMENT!!";
const DEFAULT_SQLITE_URL = "sqlite:///app.db"; // Will be relative to project root if instance folder is not used

app.config = { // Using app.config like Flask for consistency in accessing config, though Express usually uses app.set/app.get
    FLASK_APP_SECRET_KEY: process.env.SESSION_SECRET || DEFAULT_PLACEHOLDER, // Renamed from FLASK_APP_SECRET_KEY to SESSION_SECRET to match .env.example
    DATABASE_URL: process.env.DATABASE_PATH || path.join(__dirname, 'instance', 'opnsense_controller.sqlite'), // Using DATABASE_PATH from .env.example
    OPNSENSE_API_KEY: process.env.OPNSENSE_API_KEY || DEFAULT_PLACEHOLDER,
    OPNSENSE_API_SECRET: process.env.OPNSENSE_API_SECRET || DEFAULT_PLACEHOLDER,
    OPNSENSE_BASE_URL: process.env.OPNSENSE_BASE_URL || DEFAULT_PLACEHOLDER,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || DEFAULT_PLACEHOLDER,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || DEFAULT_PLACEHOLDER,
    APP_BASE_URL: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
    ADMIN_USER_GOOGLE_ID: process.env.ADMIN_USER_GOOGLE_ID || null, // Optional
    PORT: process.env.PORT || 3000
};

// Apply critical configurations directly
app.set('trust proxy', 1) // Trust first proxy, important for secure cookies if behind a reverse proxy like Nginx/Heroku
app.secret = app.config.FLASK_APP_SECRET_KEY; // For express-session secret (used app.config for consistency)

// --- Startup Configuration Checks & Logging ---
console.log("--- Application Configuration Status ---");
if (app.config.FLASK_APP_SECRET_KEY === DEFAULT_PLACEHOLDER) {
    console.error("CRITICAL: SESSION_SECRET (FLASK_APP_SECRET_KEY) is not set or using default placeholder. Application will not run securely. Please set this environment variable.");
    // For a real deployment, you might exit here if not in a forgiving dev mode:
    // process.exit(1); 
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
    secret: app.config.FLASK_APP_SECRET_KEY, // Use the same secret key
    resave: false,
    saveUninitialized: true, // True to store invitation code in session for anonymous users
    cookie: {
        secure: process.env.NODE_ENV === 'production' || app.config.APP_BASE_URL.startsWith('https://'), // Use secure cookies in production or if APP_BASE_URL is HTTPS
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Optional: connect-flash for flash messages
// app.use(flash()); // Initialize flash after session

// Initialize Passport
initializePassport(app); // Pass app if passport config needs it (e.g. for app.config)
app.use(passport.initialize());
app.use(passport.session());

// --- View Engine Setup (EJS) ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


// --- Configuration Status Helper Functions (made available via context processor/middleware) ---
function isAppSecretKeyProperlySet() {
    return app.config.FLASK_APP_SECRET_KEY !== DEFAULT_PLACEHOLDER;
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
    res.locals.is_app_secret_key_configured = isAppSecretKeyProperlySet();
    res.locals.is_opnsense_fully_configured = isOpnsenseFullyConfigured();
    res.locals.is_google_oauth_configured = isGoogleOauthConfigured();

    // Flash messages (if using connect-flash)
    // res.locals.flashMessages = req.flash(); 
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

app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/schedules', scheduleRoutes);
app.use('/', uiRoutes); // Should be last for general paths like '/'


// --- Server Startup ---
async function startServer() {
    try {
        if (app.config.FLASK_APP_SECRET_KEY === DEFAULT_PLACEHOLDER && process.env.NODE_ENV !== 'test') {
            console.error("FATAL: SESSION_SECRET (FLASK_APP_SECRET_KEY) is not set or is using the default placeholder. The application cannot start securely.");
            console.error("Please set a strong, random string for SESSION_SECRET in your environment variables.");
            process.exit(1); // Exit if critical secret is not set in non-test environments
        }

        await initializeDatabase();
        console.log("Database initialized successfully.");

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
