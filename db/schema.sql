-- Users Table: Stores user information, primarily for linking rules and tracking.
CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE,      -- Google's unique user identifier
    email TEXT UNIQUE NOT NULL, -- User's email, must be unique
    display_name TEXT,          -- User's display name
    is_admin BOOLEAN DEFAULT FALSE, -- Flag to indicate if the user is an administrator
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
);

-- ManagedRules Table: Defines the OPNsense firewall filter rules that are managed by this application.
CREATE TABLE IF NOT EXISTS ManagedRules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opnsense_rule_uuid TEXT UNIQUE NOT NULL, -- The UUID of the OPNsense firewall filter rule
    description TEXT,                        -- User-provided description for this managed rule
    desired_state BOOLEAN DEFAULT FALSE,     -- The state the user wants this rule to be in (True=enabled, False=disabled)
    user_id INTEGER NOT NULL,                -- Foreign key linking to the user who manages this rule
    timer_active_until DATETIME DEFAULT NULL, -- When an active timer for this rule expires (UTC)
    timer_action_on_expiry TEXT CHECK(timer_action_on_expiry IN ('enable', 'disable')) DEFAULT NULL, -- Action on timer expiry
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Consider adding a trigger to update this
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
    UNIQUE (user_id, opnsense_rule_uuid)     -- Ensure a user can only manage a specific rule UUID once
);

-- Schedules Table: Stores cron-based schedules for enabling/disabling managed rules.
CREATE TABLE IF NOT EXISTS Schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    managed_rule_id INTEGER NOT NULL, -- Foreign key to the ManagedRules table
    user_id INTEGER NOT NULL,         -- Foreign key to the Users table (owner of the schedule)
    cron_expression TEXT NOT NULL,    -- Standard CRON expression string
    action_to_perform TEXT NOT NULL CHECK(action_to_perform IN ('enable', 'disable')), -- Action: 'enable' or 'disable'
    is_enabled BOOLEAN DEFAULT TRUE,  -- Whether this schedule is currently active
    last_triggered_at DATETIME,       -- Timestamp of when this schedule was last successfully triggered
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Consider adding a trigger
    FOREIGN KEY (managed_rule_id) REFERENCES ManagedRules(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
);

-- Invitations Table: Stores invitation codes for new user registration.
CREATE TABLE IF NOT EXISTS Invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,       -- The unique invitation code (e.g., a UUID)
    is_used BOOLEAN DEFAULT FALSE,   -- Flag to indicate if the invitation has been used
    used_by_user_id INTEGER,         -- Which user claimed this invitation (optional)
    created_by_user_id INTEGER,    -- User who generated this invitation (admin)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- removed expires_at for simplicity in this iteration
    FOREIGN KEY (used_by_user_id) REFERENCES Users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES Users(id) ON DELETE SET NULL 
);

-- Indexes for common lookups (optional for initial setup, but good practice)
CREATE INDEX IF NOT EXISTS idx_users_google_id ON Users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON Users(email);

CREATE INDEX IF NOT EXISTS idx_managedrules_user_id ON ManagedRules(user_id);
CREATE INDEX IF NOT EXISTS idx_managedrules_opnsense_rule_uuid ON ManagedRules(opnsense_rule_uuid); -- Corrected index name

CREATE INDEX IF NOT EXISTS idx_schedules_managed_rule_id ON Schedules(managed_rule_id);
CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON Schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_is_enabled ON Schedules(is_enabled);

CREATE INDEX IF NOT EXISTS idx_invitations_code ON Invitations(code);

-- Future tables could include:
-- AuditLog: To track user actions, rule changes, scheduler actions.
-- AppSettings: For application-wide settings managed via UI (if any).
-- RuleTimers: If the timer logic becomes more complex than just fields on ManagedRules.
-- (The current Python version uses fields on ManagedRule for simplicity of timers)
