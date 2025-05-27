CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE,      -- Google's unique user identifier
    email TEXT UNIQUE NOT NULL, -- User's email, must be unique
    password TEXT,              -- Hashed password for local auth
    display_name TEXT,          -- User's display name
    is_admin BOOLEAN DEFAULT FALSE, -- Flag to indicate if the user is an administrator
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Added
    last_login_at DATETIME
);

CREATE TABLE IF NOT EXISTS AppSettings (
    key TEXT PRIMARY KEY,
    value TEXT,
    type TEXT, -- 'string', 'boolean', 'number'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ManagedRules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opnsense_rule_uuid TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    description TEXT,
    desired_state BOOLEAN NOT NULL DEFAULT 0, -- 0 for false, 1 for true
    timer_active_until DATETIME DEFAULT NULL,
    timer_action_on_expiry TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    UNIQUE (user_id, opnsense_rule_uuid)
);

CREATE INDEX IF NOT EXISTS idx_managedrules_user_id ON ManagedRules(user_id);
CREATE INDEX IF NOT EXISTS idx_managedrules_opnsense_rule_uuid ON ManagedRules(opnsense_rule_uuid);
CREATE INDEX IF NOT EXISTS idx_managedrules_timer_active_until ON ManagedRules(timer_active_until);

CREATE TABLE IF NOT EXISTS Schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, -- This column was in the user's schema, but not in db/database.js addSchedule. Let's keep it for now.
    managed_rule_id INTEGER NOT NULL, -- Added
    user_id INTEGER NOT NULL,         -- Added
    description TEXT,
    cron_expression TEXT NOT NULL,
    action_type TEXT NOT NULL, 
    action_params TEXT, 
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_triggered_at DATETIME DEFAULT NULL, -- Added based on updateScheduleLastTriggered
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (managed_rule_id) REFERENCES ManagedRules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON Schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_managed_rule_id ON Schedules(managed_rule_id);

CREATE TABLE IF NOT EXISTS Invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    created_by_user_id INTEGER NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT 0,
    used_by_user_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by_user_id) REFERENCES Users(id) ON DELETE CASCADE,
    FOREIGN KEY (used_by_user_id) REFERENCES Users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invitations_code ON Invitations(code);
CREATE INDEX IF NOT EXISTS idx_invitations_created_by_user_id ON Invitations(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_used_by_user_id ON Invitations(used_by_user_id);

-- Seed initial settings if they don't exist
INSERT OR IGNORE INTO AppSettings (key, value, type) VALUES ('initial_setup_complete', 'false', 'boolean');
-- Add other essential default settings here
INSERT OR IGNORE INTO AppSettings (key, value, type) VALUES ('SESSION_SECRET', '', 'string');
INSERT OR IGNORE INTO AppSettings (key, value, type) VALUES ('OPNSENSE_BASE_URL', '', 'string');
INSERT OR IGNORE INTO AppSettings (key, value, type) VALUES ('OPNSENSE_API_KEY', '', 'string');
INSERT OR IGNORE INTO AppSettings (key, value, type) VALUES ('OPNSENSE_API_SECRET', '', 'string');
INSERT OR IGNORE INTO AppSettings (key, value, type) VALUES ('GOOGLE_CLIENT_ID', '', 'string');
INSERT OR IGNORE INTO AppSettings (key, value, type) VALUES ('GOOGLE_CLIENT_SECRET', '', 'string');
INSERT OR IGNORE INTO AppSettings (key, value, type) VALUES ('APP_BASE_URL', 'http://localhost:3000', 'string');
INSERT OR IGNORE INTO AppSettings (key, value, type) VALUES ('ADMIN_USER_GOOGLE_ID', '', 'string');


-- Example of a more complex AppSetting, perhaps for storing a JSON object
-- INSERT OR IGNORE INTO AppSettings (key, value, type) VALUES ('firewall_alias_groups', '{}', 'json');

CREATE TABLE IF NOT EXISTS JobRuns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER,
    job_name TEXT NOT NULL, -- Could be the schedule name or a more specific job identifier
    run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL, -- e.g., 'SUCCESS', 'FAILURE', 'STARTED'
    details TEXT, -- Could be error message, stack trace, or success summary
    FOREIGN KEY (schedule_id) REFERENCES Schedules(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON Users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON Users(google_id);
CREATE INDEX IF NOT EXISTS idx_schedules_is_active ON Schedules(is_active);
CREATE INDEX IF NOT EXISTS idx_jobruns_schedule_id ON JobRuns(schedule_id);
CREATE INDEX IF NOT EXISTS idx_jobruns_status ON JobRuns(status);
CREATE INDEX IF NOT EXISTS idx_jobruns_run_at ON JobRuns(run_at);