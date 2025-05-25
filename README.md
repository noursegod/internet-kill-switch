# OPNsense Firewall Rule Controller

## Overview/Description

The OPNsense Firewall Rule Controller is a web application designed to provide a user-friendly interface for managing (enabling/disabling) specific firewall rules (aliases) on an OPNsense router. It acts as a convenient on/off switch, allowing users to control network access governed by these rules without needing direct access to the OPNsense interface.

Key features include:
*   **User Authentication:** Secure login via Google OAuth. (The initial design includes an invitation-only model, though the full invitation enforcement mechanism is pending further development).
*   **Manual Rule Toggling:** Directly enable or disable managed OPNsense aliases.
*   **Scheduled Rule Changes:** Define schedules (using cron expressions) to automatically enable or disable rules at specific times.
*   **Timer-based Rule Changes:** Temporarily enable or disable a rule for a set duration, after which it reverts to a specified state.
*   **Dockerized Deployment:** Easy to deploy using Docker.

## Features

*   **User Management:**
    *   Authentication via Google OAuth.
    *   (Future: Invitation system for new user registration).
*   **Firewall Alias Management:**
    *   Add existing OPNsense aliases to be managed by the application.
    *   Manually enable or disable these managed aliases on OPNsense.
*   **Scheduled Rule Control:**
    *   Create, manage, and delete schedules for automated rule changes.
    *   Schedules use standard cron syntax for flexibility.
    *   Enable or disable individual schedules.
*   **Temporary Rule Timers:**
    *   Set a timer to temporarily enable or disable a rule for a specified duration (e.g., "allow access for 30 minutes").
    *   The rule automatically reverts to a defined state (enabled/disabled) upon timer expiry.
    *   Active timers can be cancelled.
*   **Configuration Status Display:**
    *   The application UI provides feedback on the status of critical configurations (e.g., if Google OAuth or OPNsense API details are correctly set up).
*   **API Access (Basic):**
    *   Includes basic API endpoints for listing aliases and toggling their state (can be used for external integrations or diagnostics).

## Technology Stack

*   **Backend:** Python, Flask
*   **Frontend:** HTML, CSS (no complex JavaScript frameworks)
*   **Database:** SQLite (default), PostgreSQL (supported via `DATABASE_URL` environment variable)
*   **Authentication:** Flask-Dance (for Google OAuth)
*   **Scheduling:** APScheduler
*   **OPNsense Interaction:** `opnsense-api` Python library

## Prerequisites

*   **Docker:** Docker must be installed to build and run the application container.
*   **OPNsense Router:** An OPNsense router accessible on the network that you wish to control.
*   **OPNsense API Credentials:**
    *   An API Key and Secret generated within your OPNsense router's System -> Access -> API section. The API key should have permissions to manage firewall aliases (e.g., `Firewall: Alias: Read`, `Firewall: Alias: Update`, `Firewall: Filter: Read`, `Firewall: Filter: Reload`).
*   **Google OAuth Credentials (Optional but Recommended):**
    *   A Google OAuth Client ID and Secret if you intend to use Google for user authentication. These can be obtained from the Google Cloud Console. If not provided, user login will be disabled.

## Configuration

The application uses a combination of environment variables for initial setup and runtime configuration, and an in-application settings management system for ongoing adjustments after the first run.

### Initial Setup & Environment Variables

For the initial launch and certain runtime behaviors, the following environment variables are important. A sample file `.env.example` is provided; copy this to `.env` and customize it for your environment:

```bash
cp .env.example .env
```

**Key Environment Variables (Consult `.env.example` for a full list):**

*   **Runtime & Deployment:**
    *   `PORT`: The port the application will listen on (e.g., `3000`).
    *   `NODE_ENV`: Set to `production` for production deployments, or `development` for development features.
    *   `DATABASE_PATH`: Absolute path to the SQLite database file (e.g., `/app/instance/opnsense_controller.sqlite`). If not set, defaults to `instance/opnsense_controller.sqlite` relative to the project root. *For Docker, ensure this path is mapped to a persistent volume.*
*   **Initial Admin User Designation:**
    *   `ADMIN_USER_GOOGLE_ID`: The Google User ID (the numeric `sub` claim from Google) of the user who will become the first administrator upon their first login.
*   **Initial Values for In-App Setup (Optional Seeding):**
    *   The following variables can be set in `.env` to provide initial values for the Out-of-Box Experience (OOBE) setup wizard. If not set, they will need to be entered manually during the web-based setup:
        *   `APP_BASE_URL`: The full public URL where the application will be accessible (e.g., `http://localhost:3000` or `https://myapp.example.com`).
        *   `OPNSENSE_BASE_URL`: The base URL for your OPNsense API (e.g., `https://opnsense.example.com/api`).
        *   `OPNSENSE_API_KEY`: Your OPNsense API Key.
        *   `OPNSENSE_API_SECRET`: Your OPNsense API Secret.
        *   `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID.
        *   `GOOGLE_CLIENT_SECRET`: Your Google OAuth Client Secret.
        *   `SESSION_SECRET`: A strong, random string for session security.

### In-Application Configuration & Out-of-Box Experience (OOBE)

Upon the first run, if critical settings are missing or the application has not been marked as "setup complete," the first designated admin user (matching `ADMIN_USER_GOOGLE_ID`) will be guided through a web-based setup wizard (`/setup`).

*   **Settings Managed In-App:**
    *   `APP_BASE_URL`
    *   `OPNSENSE_BASE_URL`, `OPNSENSE_API_KEY`, `OPNSENSE_API_SECRET`
    *   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
    *   `SESSION_SECRET`
*   **`SESSION_SECRET` Handling:**
    *   If `SESSION_SECRET` is present in your `.env` file during the very first application startup, it will be used as the initial value for the setup page.
    *   If `SESSION_SECRET` is **not** set in `.env` (or is set to the default placeholder) during the first startup, a cryptographically strong secret will be **auto-generated**.
    *   This secret (either from `.env` or auto-generated) is then displayed on the setup page and subsequently stored securely in the application's database once the setup is completed.
    *   After the initial setup, the `SESSION_SECRET` stored in the database takes precedence. Changes to the `.env` file for `SESSION_SECRET` will not automatically apply unless the database setting is cleared or the application's configuration loading is manually reset (which is not a standard feature).
*   **Administrative Management:** After initial setup, an administrator can modify these settings under `/admin/settings` in the web UI. Some changes (like `APP_BASE_URL` or OAuth credentials) may require an application restart to take full effect.

## Getting Started / Installation & Running

1.  **Clone the repository:**
    ```bash
    git clone https://your-repository-url/opnsense-rule-controller.git
    cd opnsense-rule-controller
    ```

2.  **Configure Environment Variables:**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   Edit the `.env` file. Pay special attention to `PORT`, `NODE_ENV`, `DATABASE_PATH`, and `ADMIN_USER_GOOGLE_ID`.
    *   Other variables like OPNsense credentials, Google OAuth details, `APP_BASE_URL`, and `SESSION_SECRET` can be set in `.env` to pre-fill the setup wizard, or they can be entered directly via the web UI during the first setup.

3.  **Build and Run using Docker:**
    *   Build the Docker image:
        ```bash
        docker build -t opnsense-rule-controller .
        ```
    *   Run the Docker container, passing the `.env` file and ensuring persistent storage for the database:
        ```bash
        # Example: Ensure DATABASE_PATH in .env is /app/instance/opnsense_controller.sqlite
        # Create a directory for persistent data on your host
        mkdir -p ./opnsense_controller_data/instance 
        docker run -p 3000:3000 --env-file .env \
               -v $(pwd)/opnsense_controller_data/instance:/app/instance \
               opnsense-rule-controller
        ```
        *(Adjust `3000` if your `PORT` environment variable is different. Ensure the volume path `/app/instance` matches the directory used by `DATABASE_PATH` in your `.env` if it's a relative path within the container, or use an absolute path for `DATABASE_PATH` and map accordingly.)*


4.  **Access the application:**
    Open your web browser and navigate to `http://localhost:3000` (or the host and port specified by `APP_BASE_URL` once configured).

## Usage

### Initial Application Setup (First Run)

1.  **First Admin Login:**
    *   Navigate to the application URL. You will be redirected to the login page.
    *   The user whose Google ID matches the `ADMIN_USER_GOOGLE_ID` environment variable should log in.
2.  **Setup Wizard:**
    *   Upon successful login, if the application setup is not yet complete, this first admin user will be automatically redirected to the `/setup` page.
3.  **Configuration Form:**
    *   The setup form will display fields for:
        *   `APP_BASE_URL`
        *   `OPNSENSE_BASE_URL`, `OPNSENSE_API_KEY`, `OPNSENSE_API_SECRET`
        *   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
        *   `SESSION_SECRET` (this will be pre-filled with the value from `.env` or an auto-generated one, and is read-only on this form).
    *   Fill in or confirm these details. Values from your `.env` file (if provided) will be used as initial defaults.
4.  **Save Configuration:**
    *   Submit the form. These settings will be saved to the application's database. The `SESSION_SECRET` shown on the page will also be persisted.
5.  **Restart Recommended:**
    *   After completing the setup, a message will recommend restarting the application. This ensures all services and components (like OAuth callbacks) correctly use the newly saved settings, especially `APP_BASE_URL` and the `SESSION_SECRET`.

### Managing Application Settings (Admin)

Once the initial setup is complete, an administrator can manage application settings:

1.  **Navigation:** Log in as an admin user and navigate to `/admin/settings`.
2.  **View and Modify Settings:**
    *   The page displays current settings for `APP_BASE_URL`, OPNsense configuration, and Google OAuth Client ID.
    *   The status of secrets (OPNsense API Secret, Google Client Secret) will be indicated (e.g., "Currently Set" or "Not Set").
    *   To update a secret, enter the new value in the provided "New..." password field. Leaving it blank will retain the existing stored secret.
    *   The `SESSION_SECRET` is not directly editable from this page due to its sensitivity and the implications of changing it (invalidates all sessions). It's managed as described in the "Configuration" section.
3.  **Save Changes:** Submit the form to save any modifications.
4.  **Restart May Be Required:** Some changes (e.g., `APP_BASE_URL`, Google OAuth credentials) may require an application restart to take full effect. The application will provide a notification if this is the case.

### Managing Rules
*   **Adding Aliases to Manage:**
    1.  Navigate to the "Managed Rules" page.
    2.  In the "Add New Rule to Manage" section, enter the exact **Alias Name** as it appears in your OPNsense firewall.
    3.  Optionally, add a description.
    4.  Click "Add Rule". The application will attempt to verify the alias exists on OPNsense.
*   **Manually Toggling Rules:**
    *   On the "Managed Rules" page, each rule will show its current state (Desired State in DB, Actual State on OPNsense).
    *   Click "Manually Enable" or "Manually Disable" to change the rule's state on OPNsense and in the application's database.

### Schedules
*   **Creating Schedules:**
    1.  Navigate to "Schedules" (either globally or via a link from a specific managed rule).
    2.  Select the rule you want to schedule from the dropdown (if not already pre-selected).
    3.  Enter a **Cron Expression (UTC)**. For help with cron syntax, visit [crontab.guru](https://crontab.guru/).
    4.  Choose the **Action** (Enable Rule / Disable Rule) to be performed when the schedule triggers.
    5.  Check "Schedule Enabled" if you want it to be active immediately.
    6.  Click "Add Schedule".
*   **Managing Schedules:**
    *   View existing schedules, their target rule, cron expression, action, and status (Active/Paused).
    *   Use the "Pause" / "Resume" button to toggle if a schedule is active.
    *   Use the "Delete" button to remove a schedule.

### Timers
*   **Setting Timers:**
    *   On the "Managed Rules" page, each rule has a "Timer Actions" section.
    *   Enter the **duration in minutes**.
    *   Select whether to **"Enable for"** or **"Disable for"** that duration.
    *   Click "Start Timer". The rule will change to the selected state on OPNsense, and a countdown will begin. Upon expiry, the rule will revert to the opposite state (e.g., if enabled for X minutes, it will be disabled upon expiry).
*   **Cancelling Timers:**
    *   If a timer is active for a rule, its status will be displayed.
    *   Click the "Cancel Timer" button to stop the timer. The rule will remain in its current state (the state it was in during the timer).

### Configuration Status
*   The application's footer displays a summary of key configuration statuses (App Secret Key, Google OAuth, OPNsense API). This helps diagnose setup issues. Warnings are also shown on the login page if critical services like Google OAuth are not configured.

## Running Tests

1.  **Install Development Dependencies:**
    Make sure you are in the project's root directory and have your Python environment activated.
    ```bash
    pip install -r requirements-dev.txt
    ```

2.  **Run Tests:**
    Execute Pytest from the project root directory:
    ```bash
    pytest
    ```
    Or:
    ```bash
    python -m pytest
    ```

## TODO / Future Enhancements

*   **Full Invitation System:** Implement a robust invitation code system for new user enrollment and admin approval.
*   **User Roles/Permissions:** Introduce roles (e.g., admin, user) with different levels of access and control.
*   **Schedule Editing:** Allow modification of existing schedules (cron expression, action) beyond just enabling/disabling.
*   **Enhanced OPNsense Alias Discovery:** Provide a way to list available aliases from OPNsense to choose from when adding a rule, instead of requiring manual name entry.
*   **More Granular Error Reporting:** Improve feedback from OPNsense API interactions.
*   **Support for Other OAuth Providers:** Add options for authentication beyond Google.
*   **Audit Logging:** Keep a more detailed log of actions performed by users and the scheduler.
*   **UI/UX Improvements:** General enhancements to the user interface and experience.

## License

To be determined. (Currently no `LICENSE` file is included in the repository).
