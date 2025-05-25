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

Configuration is managed exclusively through environment variables. A sample file `.env.example` is provided in the repository. Create a `.env` file based on this example or set the variables directly in your deployment environment.

**Required Environment Variables:**

*   `FLASK_APP_SECRET_KEY`: **CRITICAL** A strong, random string used for session security. **Must be set for production.**
    *   Example: `FLASK_APP_SECRET_KEY="your_very_strong_random_secret_key_here"`
*   `OPNSENSE_BASE_URL`: The base URL for your OPNsense API.
    *   Example: `OPNSENSE_BASE_URL="https://192.168.1.1/api"`
*   `OPNSENSE_API_KEY`: Your OPNsense API Key.
*   `OPNSENSE_API_SECRET`: Your OPNsense API Secret.
*   `GOOGLE_OAUTH_CLIENT_ID`: Your Google OAuth Client ID. Required for login.
*   `GOOGLE_OAUTH_CLIENT_SECRET`: Your Google OAuth Client Secret. Required for login.

**Optional Environment Variables:**

*   `DATABASE_URL`: The connection string for your database.
    *   Default: `sqlite:///app.db` (creates a SQLite file named `app.db` in the `/app/instance` directory if using Docker volumes, or `/app` otherwise).
    *   PostgreSQL Example: `DATABASE_URL="postgresql://user:password@hostname:port/database_name"`
*   `FLASK_RUN_HOST`: The host the Flask development server binds to.
    *   Default for Docker: `0.0.0.0` (set by `ENV FLASK_RUN_HOST 0.0.0.0` in Dockerfile).
*   `FLASK_DEBUG`: Controls Flask's debug mode.
    *   Set to `1` for development (enables reloader, debugger).
    *   Set to `0` for production. (Default is typically off unless `FLASK_ENV=development`).

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
    *   Edit the `.env` file and fill in your specific values for all required variables.

3.  **Build and Run using Docker:**
    *   Build the Docker image:
        ```bash
        docker build -t opnsense-rule-controller .
        ```
    *   Run the Docker container, passing the `.env` file:
        ```bash
        docker run -p 5000:5000 --env-file .env opnsense-rule-controller
        ```
        *   For persistent SQLite storage with Docker, you might want to mount a volume:
            ```bash
            docker run -p 5000:5000 --env-file .env -v $(pwd)/instance:/app/instance opnsense-rule-controller
            ```
            (Ensure your `DATABASE_URL` in `.env` is `sqlite:///instance/app.db` if using this volume mount for SQLite).

4.  **Access the application:**
    Open your web browser and navigate to `http://localhost:5000` (or the appropriate host/port if deployed elsewhere).

## Usage

### Initial Login
*   Navigate to the application URL. You will be redirected to the login page.
*   Click "Login with Google" and follow the prompts to authenticate using your Google account.
*   (Note: The first user to log in might need to be manually activated or an invitation system would handle new user approval in a future iteration).

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
