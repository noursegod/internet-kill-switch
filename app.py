from flask import Flask, redirect, url_for, session, jsonify, request, render_template, flash
from flask_sqlalchemy import SQLAlchemy
from flask_dance.contrib.google import make_google_blueprint, google
from datetime import datetime, timezone, timedelta
from opnsense_client import OPNsenseClient
import os
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.jobstores.base import JobLookupError
from croniter import croniter

app = Flask(__name__)

# --- Configuration Loading & Management ---
DEFAULT_PLACEHOLDER = "!!MUST_BE_SET_IN_ENVIRONMENT!!" # For critical secrets
DEFAULT_SQLITE_URL = "sqlite:///app.db"

app.config["FLASK_APP_SECRET_KEY"] = os.environ.get("FLASK_APP_SECRET_KEY", DEFAULT_PLACEHOLDER)
app.config["DATABASE_URL"] = os.environ.get("DATABASE_URL", DEFAULT_SQLITE_URL)
app.config["OPNSENSE_API_KEY"] = os.environ.get("OPNSENSE_API_KEY", DEFAULT_PLACEHOLDER)
app.config["OPNSENSE_API_SECRET"] = os.environ.get("OPNSENSE_API_SECRET", DEFAULT_PLACEHOLDER)
app.config["OPNSENSE_BASE_URL"] = os.environ.get("OPNSENSE_BASE_URL", DEFAULT_PLACEHOLDER)
app.config["GOOGLE_OAUTH_CLIENT_ID"] = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", DEFAULT_PLACEHOLDER)
app.config["GOOGLE_OAUTH_CLIENT_SECRET"] = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", DEFAULT_PLACEHOLDER)

# Apply critical configurations directly to Flask app object
app.secret_key = app.config["FLASK_APP_SECRET_KEY"]
app.config["SQLALCHEMY_DATABASE_URI"] = app.config["DATABASE_URL"]
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False


# --- Startup Configuration Checks & Logging ---
print("--- Application Configuration Status ---")
if app.config["FLASK_APP_SECRET_KEY"] == DEFAULT_PLACEHOLDER:
    print("CRITICAL: FLASK_APP_SECRET_KEY is not set. Sessions will be insecure. SET THIS IN PRODUCTION!")
if app.config["OPNSENSE_BASE_URL"] == DEFAULT_PLACEHOLDER: # Base URL is essential for any OPNsense interaction
    print("WARNING: OPNSENSE_BASE_URL is not set. OPNsense features will be disabled.")
if app.config["OPNSENSE_API_KEY"] == DEFAULT_PLACEHOLDER or app.config["OPNSENSE_API_SECRET"] == DEFAULT_PLACEHOLDER:
    print("WARNING: OPNSENSE_API_KEY or OPNSENSE_API_SECRET is not set. OPNsense API calls will fail.")
if app.config["GOOGLE_OAUTH_CLIENT_ID"] == DEFAULT_PLACEHOLDER or app.config["GOOGLE_OAUTH_CLIENT_SECRET"] == DEFAULT_PLACEHOLDER:
    print("WARNING: GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET is not set. Google OAuth login will be disabled.")
if app.config["DATABASE_URL"] == DEFAULT_SQLITE_URL:
    print(f"INFO: Using default DATABASE_URL: {DEFAULT_SQLITE_URL}. For production, consider a persistent database.")
print("------------------------------------")

scheduler = BackgroundScheduler(timezone="UTC")
db = SQLAlchemy(app)

# --- Configuration Status Helper Functions ---
def is_app_secret_key_properly_set():
    return app.config["FLASK_APP_SECRET_KEY"] != DEFAULT_PLACEHOLDER

def is_opnsense_fully_configured():
    return app.config["OPNSENSE_API_KEY"] != DEFAULT_PLACEHOLDER and \
           app.config["OPNSENSE_API_SECRET"] != DEFAULT_PLACEHOLDER and \
           app.config["OPNSENSE_BASE_URL"] != DEFAULT_PLACEHOLDER

def is_google_oauth_configured():
    return app.config["GOOGLE_OAUTH_CLIENT_ID"] != DEFAULT_PLACEHOLDER and \
           app.config["GOOGLE_OAUTH_CLIENT_SECRET"] != DEFAULT_PLACEHOLDER

def get_opnsense_client_instance():
    if is_opnsense_fully_configured():
        return OPNsenseClient(
            app.config["OPNSENSE_API_KEY"],
            app.config["OPNSENSE_API_SECRET"],
            app.config["OPNSENSE_BASE_URL"]
        )
    return None

# --- Models ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    rules = db.relationship('ManagedRule', backref='user', lazy=True)
    schedules = db.relationship('RuleSchedule', backref='user', lazy=True)

class ManagedRule(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    alias_name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(255), nullable=True)
    is_internally_enabled = db.Column(db.Boolean, default=False, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    timer_active_until = db.Column(db.DateTime(timezone=True), nullable=True)
    timer_action_on_expiry = db.Column(db.String(10), nullable=True)
    # Unique constraint for alias_name per user
    __table_args__ = (db.UniqueConstraint('alias_name', 'user_id', name='_user_alias_uc'),)


class RuleSchedule(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    managed_rule_id = db.Column(db.Integer, db.ForeignKey('managed_rule.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    cron_expression = db.Column(db.String(50), nullable=False)
    action_to_perform = db.Column(db.String(10), nullable=False)
    is_enabled = db.Column(db.Boolean, default=True, nullable=False)
    last_triggered_at = db.Column(db.DateTime(timezone=True), nullable=True) # Ensure timezone aware
    managed_rule_obj = db.relationship('ManagedRule', backref=db.backref('schedule_entries', lazy='dynamic', cascade="all, delete-orphan"))


# --- OAuth Setup ---
google_bp = make_google_blueprint(
    client_id=app.config["GOOGLE_OAUTH_CLIENT_ID"],
    client_secret=app.config["GOOGLE_OAUTH_CLIENT_SECRET"],
    scope=["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"],
    redirect_to="route_profile" # Redirect to profile after login
)
app.register_blueprint(google_bp, url_prefix="/auth")


# --- Context Processors (to make config status available to all templates) ---
@app.context_processor
def inject_config_status():
    return {
        'is_app_secret_key_configured': is_app_secret_key_properly_set(),
        'is_opnsense_fully_configured': is_opnsense_fully_configured(),
        'is_google_oauth_configured': is_google_oauth_configured()
    }

# --- Routes ---
@app.route('/')
def route_index():
    if 'user_id' in session:
        return redirect(url_for('route_get_managed_rules_ui'))
    return redirect(url_for('route_login'))

@app.route('/login')
def route_login():
    if not is_google_oauth_configured():
        flash("Login with Google is currently disabled due to missing server configuration. Please contact the administrator.", "error")
    # Template will use context_processor for other config warnings
    return render_template('login.html')


@app.route("/auth/google") # Explicitly define the login route if needed, though usually Flask-Dance handles it
def login_google_explicit():
    if not is_google_oauth_configured():
        flash("Google OAuth is not configured. Cannot initiate login.", "error")
        return redirect(url_for("route_login"))
    return redirect(url_for("google.login"))


@app.route("/auth/callback/google") # Flask-Dance default callback
def auth_google_callback():
    if not is_google_oauth_configured():
        flash("Google OAuth is not configured. Callback processing aborted.", "error")
        return redirect(url_for("route_login"))
    if not google.authorized:
        flash("Login failed or was denied by Google.", "error")
        return redirect(url_for("route_login"))
    resp = google.get("/oauth2/v2/userinfo")
    if not resp.ok:
        flash(f"Could not fetch user info from Google: {resp.text}", "error")
        return redirect(url_for("route_login"))
    user_info = resp.json()
    email = user_info.get("email")
    name = user_info.get("name", email) # Default name to email if not provided
    if not email:
        flash("Email not provided by Google. Cannot log in.", "error")
        return redirect(url_for("route_login"))
    user = User.query.filter_by(username=email).first()
    if not user:
        user = User(username=email)
        db.session.add(user)
        db.session.commit()
        flash(f"Welcome, {name}! Your account has been created.", "success")
    else:
        flash(f"Welcome back, {name}!", "success")
    session["user_id"] = user.id
    session["user_info"] = {"email": email, "name": name}
    return redirect(url_for("route_profile"))

@app.route("/logout")
def route_logout():
    session.pop("user_id", None)
    session.pop("user_info", None)
    flash("You have been logged out.", "success")
    return redirect(url_for("route_login"))

@app.route("/profile")
def route_profile():
    if "user_id" not in session:
        return redirect(url_for("route_login"))
    return render_template("profile.html") # Config status available via context_processor

# --- ManagedRule Database Functions ---
def db_add_managed_rule(alias_name, description, user_id):
    existing_rule = ManagedRule.query.filter_by(alias_name=alias_name, user_id=user_id).first()
    if existing_rule: return None
    new_rule = ManagedRule(alias_name=alias_name, description=description, user_id=user_id, is_internally_enabled=False)
    db.session.add(new_rule)
    db.session.commit()
    return new_rule

def db_remove_managed_rule(alias_name, user_id):
    rule = ManagedRule.query.filter_by(alias_name=alias_name, user_id=user_id).first()
    if rule:
        db.session.delete(rule)
        db.session.commit()
        return True
    return False

def db_get_managed_rules_for_user(user_id):
    return ManagedRule.query.filter_by(user_id=user_id).all()

def db_get_managed_rule(rule_id, user_id): # Fetch by ID and ensure user ownership
    return ManagedRule.query.filter_by(id=rule_id, user_id=user_id).first()


def db_get_managed_rule_for_user(alias_name, user_id): # Fetch by alias name
    return ManagedRule.query.filter_by(alias_name=alias_name, user_id=user_id).first()

def db_update_managed_rule_internal_state(alias_name, is_enabled, user_id, clear_timer_fields=True):
    rule = db_get_managed_rule_for_user(alias_name, user_id)
    if rule:
        rule.is_internally_enabled = is_enabled
        if clear_timer_fields:
            rule.timer_active_until = None
            rule.timer_action_on_expiry = None
        db.session.commit()
        return True
    return False

# --- Timer Logic Functions ---
def start_rule_timer(managed_rule_id, user_id, duration_minutes, action_during_timer):
    rule = db_get_managed_rule(managed_rule_id, user_id) # Use ID-based getter
    if not rule: return False, "Rule not found."
    if action_during_timer not in ["enable", "disable"]: return False, "Invalid action for timer."
    
    client = get_opnsense_client_instance()
    if not client: return False, "OPNsense client not configured."

    opnsense_action_successful = False
    new_internal_state = (action_during_timer == "enable")
    action_on_expiry = "disable" if new_internal_state else "enable"

    try:
        if new_internal_state: opnsense_action_successful = client.enable_alias(rule.alias_name)
        else: opnsense_action_successful = client.disable_alias(rule.alias_name)
    except Exception as e: return False, f"OPNsense API error: {e}"

    if opnsense_action_successful:
        rule.is_internally_enabled = new_internal_state
        rule.timer_active_until = datetime.now(timezone.utc) + timedelta(minutes=duration_minutes)
        rule.timer_action_on_expiry = action_on_expiry
        db.session.commit()
        return True, f"Timer started. Rule '{rule.alias_name}' will {action_during_timer} for {duration_minutes} mins."
    return False, f"Failed to {action_during_timer} rule on OPNsense."

def clear_rule_timer(managed_rule_id, user_id):
    rule = db_get_managed_rule(managed_rule_id, user_id) # Use ID-based getter
    if not rule: return False, "Rule not found."
    if rule.timer_active_until is None: return True, "No active timer to clear."
    rule.timer_active_until = None
    rule.timer_action_on_expiry = None
    db.session.commit()
    return True, "Timer cleared."

def check_and_process_expired_timers():
    with app.app_context():
        now = datetime.now(timezone.utc)
        expired_rules = ManagedRule.query.filter(ManagedRule.timer_active_until <= now, ManagedRule.timer_active_until.isnot(None)).all()
        if not expired_rules: return
        print(f"Timer Check: Found {len(expired_rules)} expired timers.")
        client = get_opnsense_client_instance()
        if not client and expired_rules:
            print("Timer Check: OPNsense client not configured. Cannot process timers.")
            return
        for rule in expired_rules:
            print(f"Processing expired timer for rule: {rule.alias_name} (User: {rule.user_id})")
            action_to_take = rule.timer_action_on_expiry
            opnsense_ok = False
            new_state = rule.is_internally_enabled
            try:
                if action_to_take == "enable": opnsense_ok = client.enable_alias(rule.alias_name); new_state = True
                elif action_to_take == "disable": opnsense_ok = client.disable_alias(rule.alias_name); new_state = False
                else: opnsense_ok = True # Invalid action, just clear timer
                
                if opnsense_ok:
                    rule.is_internally_enabled = new_state
                    rule.timer_active_until = None
                    rule.timer_action_on_expiry = None
                    db.session.commit()
                    print(f"Timer Expiry: Rule '{rule.alias_name}' action '{action_to_take}' performed. Timer cleared.")
                else: print(f"Timer Expiry: OPNsense action failed for rule '{rule.alias_name}'. Timer not cleared.")
            except Exception as e:
                db.session.rollback()
                print(f"Timer Expiry Error for rule '{rule.alias_name}': {e}")

# --- UI Routes for Managed Rules ---
@app.route('/rules', methods=['GET'])
def route_get_managed_rules_ui():
    if "user_id" not in session: return redirect(url_for('route_login'))
    current_user_id = session["user_id"]
    managed_rules_db = db_get_managed_rules_for_user(current_user_id)
    rules_data = []
    live_aliases_dict = {}
    now_utc = datetime.now(timezone.utc)

    if is_opnsense_fully_configured():
        client = get_opnsense_client_instance()
        if client:
            try:
                live_aliases_list = client.get_aliases()
                if live_aliases_list is not None: live_aliases_dict = {a['name']: a for a in live_aliases_list}
                else: flash("Could not fetch OPNsense alias statuses.", "warning")
            except Exception as e: flash(f"Error fetching OPNsense statuses: {e}", "error"); live_aliases_dict = None
        else: flash("OPNsense client init error despite configuration.", "error"); live_aliases_dict = None
    # Warnings for partial/no config handled by context_processor in base template

    for db_rule in managed_rules_db:
        opnsense_status = "unknown"
        if live_aliases_dict is None: opnsense_status = "client_error"
        elif db_rule.alias_name in live_aliases_dict: opnsense_status = "enabled" if live_aliases_dict[db_rule.alias_name]["enabled"] else "disabled"
        else: opnsense_status = "not_found"
        timer_info = None
        if db_rule.timer_active_until and db_rule.timer_active_until > now_utc:
            timer_info = {"expires_in_seconds": (db_rule.timer_active_until - now_utc).total_seconds(), "action_on_expiry": db_rule.timer_action_on_expiry}
        rules_data.append({"managed_rule": db_rule, "opnsense_status": opnsense_status, "timer_info": timer_info})
    return render_template('managed_rules.html', rules_data=rules_data)


@app.route('/rules/add', methods=['POST'])
def route_add_managed_rule_ui():
    if "user_id" not in session: return redirect(url_for('route_login'))
    alias_name = request.form.get('alias_name')
    description = request.form.get('description')
    current_user_id = session["user_id"]
    if not alias_name: flash("Alias name is required.", "error"); return redirect(url_for('route_get_managed_rules_ui'))
    
    if is_opnsense_fully_configured():
        client = get_opnsense_client_instance()
        if client:
            try:
                if not client._get_alias_uuid(alias_name):
                    flash(f"Alias '{alias_name}' does not exist on OPNsense. Cannot manage.", "warning")
                    return redirect(url_for('route_get_managed_rules_ui'))
            except Exception as e: flash(f"Error verifying OPNsense alias: {e}", "error"); return redirect(url_for('route_get_managed_rules_ui'))
        else: flash("OPNsense client init error. Cannot verify alias.", "error"); return redirect(url_for('route_get_managed_rules_ui'))
    # If not fully configured, allow adding but with a warning (handled by general config status)
    
    if db_add_managed_rule(alias_name, description, current_user_id):
        flash(f"Rule for alias '{alias_name}' added.", "success")
    else: flash(f"Failed to add rule '{alias_name}'. Already managed by you?", "error")
    return redirect(url_for('route_get_managed_rules_ui'))

@app.route('/rules/<string:alias_name>/toggle', methods=['POST'])
def route_toggle_managed_rule(alias_name):
    if "user_id" not in session: return redirect(url_for('route_login'))
    current_user_id = session["user_id"]
    rule = db_get_managed_rule_for_user(alias_name, current_user_id)
    if not rule: flash(f"Rule '{alias_name}' not found.", "error"); return redirect(url_for('route_get_managed_rules_ui'))
    
    if rule.timer_active_until: # Clear timer on manual toggle
        cleared, msg = clear_rule_timer(rule.id, current_user_id)
        if cleared: flash(f"Active timer for '{alias_name}' cleared. {msg}", "info")
        else: flash(f"Could not clear timer for '{alias_name}': {msg}", "warning")

    new_db_state = not rule.is_internally_enabled
    if not is_opnsense_fully_configured(): flash("OPNsense not configured. Cannot change firewall state.", "error"); return redirect(url_for('route_get_managed_rules_ui'))
    client = get_opnsense_client_instance()
    if not client: flash("OPNsense client error.", "error"); return redirect(url_for('route_get_managed_rules_ui'))
    
    try:
        opnsense_ok = client.enable_alias(alias_name) if new_db_state else client.disable_alias(alias_name)
        if opnsense_ok:
            db_update_managed_rule_internal_state(alias_name, new_db_state, current_user_id, clear_timer_fields=False) # Timer already handled
            flash(f"Alias '{alias_name}' {'enabled' if new_db_state else 'disabled'}.", "success")
        else: flash(f"Failed OPNsense action for '{alias_name}'.", "error")
    except Exception as e: flash(f"Error changing OPNsense state for '{alias_name}': {e}", "error")
    return redirect(url_for('route_get_managed_rules_ui'))

@app.route('/rules/<string:alias_name>/remove', methods=['POST'])
def route_remove_managed_rule_ui(alias_name):
    if "user_id" not in session: return redirect(url_for('route_login'))
    current_user_id = session["user_id"]
    rule = db_get_managed_rule_for_user(alias_name, current_user_id)
    if not rule: flash(f"Rule '{alias_name}' not found.", "error"); return redirect(url_for('route_get_managed_rules_ui'))

    if is_opnsense_fully_configured():
        client = get_opnsense_client_instance()
        if client:
            try:
                if not client.enable_alias(alias_name): flash(f"Warning: Could not re-enable '{alias_name}' on OPNsense.", "warning")
                else: flash(f"Alias '{alias_name}' ensured enabled on OPNsense before unmanaging.", "info")
            except Exception as e: flash(f"Error re-enabling '{alias_name}': {e}.", "warning")
        else: flash("OPNsense client error. Cannot ensure state.", "warning")
    
    if db_remove_managed_rule(alias_name, current_user_id):
        flash(f"Rule '{alias_name}' unmanaged.", "success")
    else: flash(f"Failed to unmanage rule '{alias_name}'.", "error")
    return redirect(url_for('route_get_managed_rules_ui'))

# --- Timer UI Routes ---
@app.route('/rules/<string:alias_name>/timer/start', methods=['POST'])
def route_start_rule_timer(alias_name):
    if "user_id" not in session: return redirect(url_for('route_login'))
    current_user_id = session["user_id"]
    rule = db_get_managed_rule_for_user(alias_name, current_user_id)
    if not rule: flash(f"Rule '{alias_name}' not found.", "error"); return redirect(url_for('route_get_managed_rules_ui'))
    try:
        duration = int(request.form.get('duration_minutes'))
        action = request.form.get('action_during_timer')
        if duration <= 0: flash("Duration must be positive.", "error"); return redirect(url_for('route_get_managed_rules_ui'))
    except (TypeError, ValueError): flash("Invalid duration.", "error"); return redirect(url_for('route_get_managed_rules_ui'))
    
    success, msg = start_rule_timer(rule.id, current_user_id, duration, action)
    flash(msg, "success" if success else "error")
    return redirect(url_for('route_get_managed_rules_ui'))

@app.route('/rules/<string:alias_name>/timer/cancel', methods=['POST'])
def route_cancel_rule_timer(alias_name):
    if "user_id" not in session: return redirect(url_for('route_login'))
    current_user_id = session["user_id"]
    rule = db_get_managed_rule_for_user(alias_name, current_user_id)
    if not rule: flash(f"Rule '{alias_name}' not found.", "error"); return redirect(url_for('route_get_managed_rules_ui'))
    success, msg = clear_rule_timer(rule.id, current_user_id)
    flash(msg, "success" if success else "error")
    return redirect(url_for('route_get_managed_rules_ui'))

# --- RuleSchedule Database Functions & UI Routes ---
def db_add_rule_schedule(managed_rule_id, user_id, cron, action, is_enabled=True):
    rule = db_get_managed_rule(managed_rule_id, user_id)
    if not rule: return None
    new_schedule = RuleSchedule(managed_rule_id=managed_rule_id, user_id=user_id, cron_expression=cron, action_to_perform=action, is_enabled=is_enabled)
    db.session.add(new_schedule)
    db.session.commit()
    db.session.refresh(new_schedule) # Load managed_rule_obj
    return new_schedule

def db_get_rule_schedules_for_user(user_id):
    return RuleSchedule.query.filter_by(user_id=user_id).options(db.joinedload(RuleSchedule.managed_rule_obj)).order_by(RuleSchedule.managed_rule_id, RuleSchedule.id).all()

def db_get_rule_schedule_by_id(schedule_id, user_id): # Renamed for clarity
    return RuleSchedule.query.filter_by(id=schedule_id, user_id=user_id).options(db.joinedload(RuleSchedule.managed_rule_obj)).first()

def db_update_rule_schedule(schedule_id, user_id, cron=None, action=None, is_enabled=None):
    schedule = db_get_rule_schedule_by_id(schedule_id, user_id)
    if not schedule: return False, "not_found"
    updated = []
    if cron is not None and schedule.cron_expression != cron:
        if not croniter.is_valid(cron): return False, "invalid_cron"
        schedule.cron_expression = cron; updated.append("cron")
    if action is not None and schedule.action_to_perform != action:
        schedule.action_to_perform = action; updated.append("action")
    if is_enabled is not None and schedule.is_enabled != is_enabled:
        schedule.is_enabled = is_enabled; updated.append("status")
    if not updated: return True, "no_change"
    db.session.commit()
    job_id = f"schedule_{schedule.id}"
    job_name = f"Rule: {schedule.managed_rule_obj.alias_name} - Action: {schedule.action_to_perform}"
    if schedule.is_enabled:
        trigger = CronTrigger.from_crontab(schedule.cron_expression, timezone="UTC")
        args = [schedule.managed_rule_id, schedule.action_to_perform, schedule.user_id, schedule.id]
        if scheduler.get_job(job_id): scheduler.modify_job(job_id, trigger=trigger, args=args, name=job_name)
        else: scheduler.add_job(execute_scheduled_rule_change, trigger, id=job_id, name=job_name, args=args, replace_existing=True)
        if not scheduler.running: scheduler.start(paused=False)
    elif scheduler.get_job(job_id):
        try: scheduler.remove_job(job_id)
        except JobLookupError: pass
    return True, "updated"

def db_remove_rule_schedule(schedule_id, user_id):
    schedule = db_get_rule_schedule_by_id(schedule_id, user_id)
    if schedule:
        job_id = f"schedule_{schedule.id}"
        db.session.delete(schedule)
        db.session.commit()
        if scheduler.get_job(job_id):
            try: scheduler.remove_job(job_id)
            except JobLookupError: pass
        return True
    return False

@app.route('/schedules', methods=['GET'])
@app.route('/rules/<string:rule_alias_for_schedules>/schedules', methods=['GET'])
def route_get_schedules_ui(rule_alias_for_schedules=None):
    if "user_id" not in session: return redirect(url_for('route_login'))
    user_id = session["user_id"]
    schedules_q = db.session.query(RuleSchedule).filter_by(user_id=user_id).options(db.joinedload(RuleSchedule.managed_rule_obj)).order_by(RuleSchedule.managed_rule_id, RuleSchedule.id)
    rule_for_new = None
    if rule_alias_for_schedules:
        rule_for_new = ManagedRule.query.filter_by(alias_name=rule_alias_for_schedules, user_id=user_id).first()
        if rule_for_new: schedules_q = schedules_q.filter_by(managed_rule_id=rule_for_new.id)
        else: flash(f"Rule '{rule_alias_for_schedules}' not found.", "error"); return redirect(url_for('route_get_schedules_ui'))
    return render_template('rule_schedules.html', schedules_data=schedules_q.all(), rule_alias=rule_alias_for_schedules,
                           managed_rule_for_new_schedule=rule_for_new, current_user_managed_rules=db_get_managed_rules_for_user(user_id))

@app.route('/schedules/add', methods=['POST'])
def route_add_schedule_ui():
    if "user_id" not in session: return redirect(url_for('route_login'))
    user_id = session["user_id"]
    rule_id_str = request.form.get('managed_rule_id') or request.form.get('managed_rule_id_select')
    if not rule_id_str or not rule_id_str.isdigit(): flash("Valid rule selection required.", "error"); return redirect(request.referrer or url_for('route_get_schedules_ui'))
    cron = request.form.get('cron_expression')
    action = request.form.get('action_to_perform')
    is_enabled = request.form.get('is_enabled') == 'true'
    if not croniter.is_valid(cron): flash(f"Invalid cron: '{cron}'.", "error"); return redirect(request.referrer or url_for('route_get_schedules_ui'))
    if action not in ["enable", "disable"]: flash("Invalid action.", "error"); return redirect(request.referrer or url_for('route_get_schedules_ui'))
    
    schedule = db_add_rule_schedule(int(rule_id_str), user_id, cron, action, is_enabled)
    if schedule:
        flash("Schedule added.", "success")
        if schedule.is_enabled:
            job_id = f"schedule_{schedule.id}"
            job_name = f"Rule: {schedule.managed_rule_obj.alias_name} - Action: {schedule.action_to_perform}"
            try:
                scheduler.add_job(execute_scheduled_rule_change, CronTrigger.from_crontab(cron, timezone="UTC"),
                                  id=job_id, name=job_name, args=[schedule.managed_rule_id, action, user_id, schedule.id], replace_existing=True)
                if not scheduler.running: scheduler.start(paused=False)
                flash(f"Job {job_id} added to scheduler.", "info")
            except Exception as e: flash(f"Error adding job {job_id}: {e}", "error")
    else: flash("Failed to add schedule. Rule not found or permission issue.", "error")
    rule_obj_for_redirect = ManagedRule.query.get(int(rule_id_str))
    if rule_obj_for_redirect and request.form.get('managed_rule_id'):
         return redirect(url_for('route_get_schedules_ui', rule_alias_for_schedules=rule_obj_for_redirect.alias_name))
    return redirect(url_for('route_get_schedules_ui'))

@app.route('/schedules/<int:schedule_id>/toggle_enabled', methods=['POST'])
def route_toggle_schedule_enabled(schedule_id):
    if "user_id" not in session: return redirect(url_for('route_login'))
    schedule = db_get_rule_schedule_by_id(schedule_id, session["user_id"])
    if not schedule: flash("Schedule not found.", "error"); return redirect(url_for('route_get_schedules_ui'))
    updated, msg = db_update_rule_schedule(schedule_id, session["user_id"], is_enabled=not schedule.is_enabled)
    if updated and msg == "updated": flash(f"Schedule '{schedule.managed_rule_obj.alias_name} - {schedule.cron_expression}' now {'Active' if not schedule.is_enabled else 'Paused'}.", "success") # Logic reversed due to how schedule.is_enabled is read pre-update
    elif not updated: flash(f"Failed to update schedule: {msg}", "error")
    rule_alias = schedule.managed_rule_obj.alias_name
    if request.referrer and f"/rules/{rule_alias}/schedules" in request.referrer:
        return redirect(url_for('route_get_schedules_ui', rule_alias_for_schedules=rule_alias))
    return redirect(url_for('route_get_schedules_ui'))

@app.route('/schedules/<int:schedule_id>/delete', methods=['POST'])
def route_delete_schedule_ui(schedule_id):
    if "user_id" not in session: return redirect(url_for('route_login'))
    schedule = db_get_rule_schedule_by_id(schedule_id, session["user_id"])
    alias_for_redirect = schedule.managed_rule_obj.alias_name if schedule else None
    if db_remove_rule_schedule(schedule_id, session["user_id"]): flash("Schedule deleted.", "success")
    else: flash("Failed to delete schedule.", "error")
    if alias_for_redirect and request.referrer and f"/rules/{alias_for_redirect}/schedules" in request.referrer:
        return redirect(url_for('route_get_schedules_ui', rule_alias_for_schedules=alias_for_redirect))
    return redirect(url_for('route_get_schedules_ui'))

# --- APScheduler Job Functions & Loading ---
def execute_scheduled_rule_change(managed_rule_id, action_to_perform, user_id, schedule_id):
    with app.app_context():
        schedule = RuleSchedule.query.filter_by(id=schedule_id, user_id=user_id, is_enabled=True).first()
        if not schedule:
            if scheduler.get_job(f"schedule_{schedule_id}"): try: scheduler.remove_job(f"schedule_{schedule_id}"); except JobLookupError: pass
            return
        rule = schedule.managed_rule_obj
        if not rule: return

        if rule.timer_active_until and rule.timer_active_until > datetime.now(timezone.utc): # Check if timer is active
            print(f"SCHED JOB: Rule '{rule.alias_name}' has an active timer. Scheduled action '{action_to_perform}' will be skipped.")
            return # Skip scheduled action if a manual timer is active

        # Proceed with scheduled action
        desired_opnsense_state = (action_to_perform == "enable")
        client = get_opnsense_client_instance()
        if not client: return
        try:
            aliases = client.get_aliases()
            alias_info = next((a for a in aliases if a["name"] == rule.alias_name), None) if aliases else None
            if not alias_info: return
            if alias_info["enabled"] == desired_opnsense_state: # Already in desired state
                rule.is_internally_enabled = desired_opnsense_state # Ensure DB matches
                schedule.last_triggered_at = datetime.now(timezone.utc)
                db.session.commit()
                return

            opnsense_ok = client.enable_alias(rule.alias_name) if desired_opnsense_state else client.disable_alias(rule.alias_name)
            if opnsense_ok:
                rule.is_internally_enabled = desired_opnsense_state
                schedule.last_triggered_at = datetime.now(timezone.utc)
                db.session.commit()
        except Exception as e: db.session.rollback(); print(f"SCHED JOB Error: {e}")

def load_and_schedule_active_jobs():
    with app.app_context():
        if not is_opnsense_fully_configured() and app.config["OPNSENSE_BASE_URL"] != DEFAULT_PLACEHOLDER :
             print("APScheduler: OPNsense client partially configured. Rule schedule jobs might fail if API key/secret are missing.")
        # Load OPNsense rule schedules
        active_rule_schedules = RuleSchedule.query.filter_by(is_enabled=True).all()
        jobs_loaded_count = 0
        for schedule in active_rule_schedules:
            job_id = f"schedule_{schedule.id}"
            job_name = f"Rule: {schedule.managed_rule_obj.alias_name} - Action: {schedule.action_to_perform}"
            try:
                trigger = CronTrigger.from_crontab(schedule.cron_expression, timezone="UTC")
                args = [schedule.managed_rule_id, schedule.action_to_perform, schedule.user_id, schedule.id]
                if scheduler.get_job(job_id): scheduler.modify_job(job_id, trigger=trigger, args=args, name=job_name)
                else: scheduler.add_job(execute_scheduled_rule_change, trigger, id=job_id, name=job_name, args=args)
                jobs_loaded_count += 1
            except Exception as e: print(f"APScheduler: Error loading job {job_id}: {e}")
        if jobs_loaded_count > 0: print(f"APScheduler: Loaded {jobs_loaded_count} OPNsense rule jobs.")

        # Add/ensure job for checking expired timers
        timer_job_id = "check_expired_timers"
        if not scheduler.get_job(timer_job_id):
            scheduler.add_job(check_and_process_expired_timers, 'interval', minutes=1, id=timer_job_id, name="Check Expired Rule Timers")
            print("APScheduler: Added job for checking expired rule timers.")
        
        if not scheduler.running and (jobs_loaded_count > 0 or scheduler.get_job(timer_job_id)):
            try: scheduler.start(paused=False)
            except Exception as e: print(f"APScheduler: Failed to start: {e}")
        elif scheduler.running: print("APScheduler: Already running.")
        else: print("APScheduler: No jobs to load, scheduler not started.")

# --- Main Execution ---
if __name__ == '__main__':
    if app.config["FLASK_APP_SECRET_KEY"] == DEFAULT_PLACEHOLDER:
        print("FATAL: FLASK_APP_SECRET_KEY is not set. Set a strong secret key for production. Exiting.")
        exit(1)
    with app.app_context():
        db.create_all()
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        with app.app_context(): load_and_schedule_active_jobs()
    elif app.debug: print("APScheduler: Debug mode with reloader, scheduler starts in main process.")
    app.run(host='0.0.0.0', port=5000) # debug defaults to app.debug, use_reloader defaults to app.debug


# --- JSON API Routes (Kept for potential future use or admin tools) ---
@app.route('/api/opnsense/aliases') 
def api_opnsense_aliases(): # ... (implementation as before)
    if "user_id" not in session: return jsonify({"error": "Unauthorized"}), 401
    if not is_opnsense_fully_configured(): return jsonify({"error": "OPNsense client not configured"}), 500
    client = get_opnsense_client_instance()
    if not client: return jsonify({"error": "OPNsense client failed to initialize"}), 500
    aliases = client.get_aliases()
    if aliases is None: return jsonify({"error": "Failed to fetch aliases from OPNsense"}), 500
    user_managed_rules = {r.alias_name: r for r in db_get_managed_rules_for_user(session["user_id"])}
    enriched = [{**a, "is_managed_by_user": a["name"] in user_managed_rules, 
                 "user_managed_description": user_managed_rules[a["name"]].description if a["name"] in user_managed_rules else None,
                 "is_internally_enabled_by_user": user_managed_rules[a["name"]].is_internally_enabled if a["name"] in user_managed_rules else None
                 } for a in aliases]
    return jsonify(enriched)

@app.route('/api/opnsense/alias/<alias_name>/enable', methods=['POST', 'GET']) 
def api_opnsense_enable_alias(alias_name): # ... (implementation as before)
    if "user_id" not in session: return jsonify({"error": "Unauthorized"}), 401
    if not is_opnsense_fully_configured(): return jsonify({"error": "OPNsense client not configured"}), 500
    client = get_opnsense_client_instance()
    if not client: return jsonify({"error": "OPNsense client failed to initialize"}), 500
    if client.enable_alias(alias_name): return jsonify({"message": f"Alias '{alias_name}' enabled."})
    return jsonify({"error": f"Failed to enable '{alias_name}'."}), 500

@app.route('/api/opnsense/alias/<alias_name>/disable', methods=['POST', 'GET'])
def api_opnsense_disable_alias(alias_name): # ... (implementation as before)
    if "user_id" not in session: return jsonify({"error": "Unauthorized"}), 401
    if not is_opnsense_fully_configured(): return jsonify({"error": "OPNsense client not configured"}), 500
    client = get_opnsense_client_instance()
    if not client: return jsonify({"error": "OPNsense client failed to initialize"}), 500
    if client.disable_alias(alias_name): return jsonify({"message": f"Alias '{alias_name}' disabled."})
    return jsonify({"error": f"Failed to disable '{alias_name}'."}), 500
