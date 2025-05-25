import pytest
from app import User, ManagedRule, db_add_managed_rule, db_get_managed_rules_for_user, \
                db_get_managed_rule_for_user, db_update_managed_rule_internal_state, \
                start_rule_timer, clear_rule_timer, \
                is_opnsense_fully_configured, is_google_oauth_configured, DEFAULT_PLACEHOLDER
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

# === User Model Tests ===
def test_create_user(db):
    user = User(username="newuser@example.com")
    db.session.add(user)
    db.session.commit()
    retrieved_user = User.query.filter_by(username="newuser@example.com").first()
    assert retrieved_user is not None
    assert retrieved_user.username == "newuser@example.com"

# === ManagedRule Model & Logic Tests ===
def test_add_managed_rule(db, active_user):
    rule = db_add_managed_rule("test_alias_1", "Test Description 1", active_user.id)
    assert rule is not None
    assert rule.alias_name == "test_alias_1"
    assert rule.user_id == active_user.id
    retrieved_rule = ManagedRule.query.filter_by(alias_name="test_alias_1", user_id=active_user.id).first()
    assert retrieved_rule is not None
    assert retrieved_rule.description == "Test Description 1"

def test_add_duplicate_managed_rule_for_same_user(db, active_user):
    db_add_managed_rule("test_alias_dup", "Desc1", active_user.id)
    rule2 = db_add_managed_rule("test_alias_dup", "Desc2", active_user.id)
    assert rule2 is None # Should not allow adding duplicate alias for the same user

def test_add_same_alias_for_different_users(db, active_user):
    user2 = User(username="anotheruser@example.com")
    db.session.add(user2)
    db.session.commit()

    rule1 = db_add_managed_rule("shared_alias", "Desc1", active_user.id)
    rule2 = db_add_managed_rule("shared_alias", "Desc2", user2.id)
    assert rule1 is not None
    assert rule2 is not None
    assert rule1.user_id != rule2.user_id
    assert ManagedRule.query.filter_by(alias_name="shared_alias").count() == 2


def test_get_managed_rules_for_user(db, active_user):
    db_add_managed_rule("aliasA", "Desc A", active_user.id)
    db_add_managed_rule("aliasB", "Desc B", active_user.id)
    
    other_user = User(username="other@example.com")
    db.session.add(other_user)
    db.session.commit()
    db_add_managed_rule("aliasC", "Desc C", other_user.id)

    user_rules = db_get_managed_rules_for_user(active_user.id)
    assert len(user_rules) == 2
    assert "aliasA" in [r.alias_name for r in user_rules]
    assert "aliasB" in [r.alias_name for r in user_rules]

def test_get_managed_rule_for_user(db, active_user):
    db_add_managed_rule("specific_alias", "Specific rule", active_user.id)
    rule = db_get_managed_rule_for_user("specific_alias", active_user.id)
    assert rule is not None
    assert rule.description == "Specific rule"

    rule_non_existent = db_get_managed_rule_for_user("non_existent_alias", active_user.id)
    assert rule_non_existent is None

def test_update_managed_rule_internal_state(db, active_user):
    rule = db_add_managed_rule("state_test_alias", "State test", active_user.id)
    assert rule.is_internally_enabled is False # Default

    updated = db_update_managed_rule_internal_state("state_test_alias", True, active_user.id)
    assert updated is True
    retrieved_rule = db_get_managed_rule_for_user("state_test_alias", active_user.id)
    assert retrieved_rule.is_internally_enabled is True

    # Test clear_timer functionality (default is True)
    retrieved_rule.timer_active_until = datetime.now(timezone.utc) + timedelta(hours=1)
    retrieved_rule.timer_action_on_expiry = "disable"
    db.session.commit()

    db_update_managed_rule_internal_state("state_test_alias", False, active_user.id)
    retrieved_rule_after_update = db_get_managed_rule_for_user("state_test_alias", active_user.id)
    assert retrieved_rule_after_update.is_internally_enabled is False
    assert retrieved_rule_after_update.timer_active_until is None
    assert retrieved_rule_after_update.timer_action_on_expiry is None

# === Timer Logic Tests ===
@patch('app.get_opnsense_client_instance') # Mock OPNsense client for timer tests
def test_start_rule_timer(mock_opnsense_client_getter, db, active_user):
    # Setup mock OPNsense client
    mock_client_instance = MagicMock()
    mock_client_instance.enable_alias.return_value = True
    mock_client_instance.disable_alias.return_value = True
    mock_opnsense_client_getter.return_value = mock_client_instance

    rule_db = db_add_managed_rule("timer_rule", "Timer Test", active_user.id)
    assert rule_db is not None
    
    duration_minutes = 30
    
    # Test starting timer to ENABLE the rule
    success, msg = start_rule_timer(rule_db.id, active_user.id, duration_minutes, "enable")
    assert success is True
    assert "Timer started" in msg
    updated_rule = ManagedRule.query.get(rule_db.id)
    assert updated_rule.is_internally_enabled is True
    assert updated_rule.timer_active_until is not None
    assert updated_rule.timer_action_on_expiry == "disable"
    expected_expiry = datetime.now(timezone.utc) + timedelta(minutes=duration_minutes)
    assert (updated_rule.timer_active_until - expected_expiry).total_seconds() < 5 # Allow small delta

    # Test starting timer to DISABLE the rule
    success, msg = start_rule_timer(rule_db.id, active_user.id, duration_minutes, "disable")
    assert success is True
    updated_rule_2 = ManagedRule.query.get(rule_db.id)
    assert updated_rule_2.is_internally_enabled is False
    assert updated_rule_2.timer_action_on_expiry == "enable"

    # Test OPNsense client failure during start_rule_timer
    mock_client_instance.enable_alias.return_value = False # Simulate failure
    success, msg = start_rule_timer(rule_db.id, active_user.id, duration_minutes, "enable")
    assert success is False
    assert "Failed to enable rule on OPNsense" in msg
    # Rule state should not have changed in DB if OPNsense failed
    updated_rule_3 = ManagedRule.query.get(rule_db.id)
    assert updated_rule_3.is_internally_enabled is False # Should remain as per previous successful disable
    assert updated_rule_3.timer_active_until is not None # Timer fields might still be set from previous success, or cleared depending on implementation detail on failure.
                                                       # Current implementation does not clear them on opnsense failure after setting.

def test_clear_rule_timer(db, active_user):
    rule_db = db_add_managed_rule("timer_clear_rule", "Timer Clear Test", active_user.id)
    # Set some timer values manually
    rule_db.timer_active_until = datetime.now(timezone.utc) + timedelta(hours=1)
    rule_db.timer_action_on_expiry = "disable"
    db.session.add(rule_db)
    db.session.commit()

    assert rule_db.timer_active_until is not None
    success, msg = clear_rule_timer(rule_db.id, active_user.id)
    assert success is True
    assert "Timer cleared" in msg
    updated_rule = ManagedRule.query.get(rule_db.id)
    assert updated_rule.timer_active_until is None
    assert updated_rule.timer_action_on_expiry is None

    # Test clearing a rule with no active timer
    success_no_timer, msg_no_timer = clear_rule_timer(rule_db.id, active_user.id)
    assert success_no_timer is True
    assert "No active timer to clear" in msg_no_timer


# === Configuration Helper Tests ===
def test_is_opnsense_fully_configured(app_context, monkeypatch):
    # Test when all are set
    monkeypatch.setitem(flask_app.config, "OPNSENSE_API_KEY", "key_set")
    monkeypatch.setitem(flask_app.config, "OPNSENSE_API_SECRET", "secret_set")
    monkeypatch.setitem(flask_app.config, "OPNSENSE_BASE_URL", "url_set")
    assert is_opnsense_fully_configured() is True

    # Test when one is default placeholder
    monkeypatch.setitem(flask_app.config, "OPNSENSE_API_KEY", DEFAULT_PLACEHOLDER)
    assert is_opnsense_fully_configured() is False
    monkeypatch.setitem(flask_app.config, "OPNSENSE_API_KEY", "key_set") # Reset

    monkeypatch.setitem(flask_app.config, "OPNSENSE_API_SECRET", DEFAULT_PLACEHOLDER)
    assert is_opnsense_fully_configured() is False
    monkeypatch.setitem(flask_app.config, "OPNSENSE_API_SECRET", "secret_set") # Reset

    monkeypatch.setitem(flask_app.config, "OPNSENSE_BASE_URL", DEFAULT_PLACEHOLDER)
    assert is_opnsense_fully_configured() is False
    monkeypatch.setitem(flask_app.config, "OPNSENSE_BASE_URL", "url_set") # Reset

def test_is_google_oauth_configured(app_context, monkeypatch):
    # Test when all are set
    monkeypatch.setitem(flask_app.config, "GOOGLE_OAUTH_CLIENT_ID", "id_set")
    monkeypatch.setitem(flask_app.config, "GOOGLE_OAUTH_CLIENT_SECRET", "secret_set")
    assert is_google_oauth_configured() is True

    # Test when one is default placeholder
    monkeypatch.setitem(flask_app.config, "GOOGLE_OAUTH_CLIENT_ID", DEFAULT_PLACEHOLDER)
    assert is_google_oauth_configured() is False
    monkeypatch.setitem(flask_app.config, "GOOGLE_OAUTH_CLIENT_ID", "id_set") # Reset

    monkeypatch.setitem(flask_app.config, "GOOGLE_OAUTH_CLIENT_SECRET", DEFAULT_PLACEHOLDER)
    assert is_google_oauth_configured() is False
    monkeypatch.setitem(flask_app.config, "GOOGLE_OAUTH_CLIENT_SECRET", "secret_set") # Reset


# === RuleSchedule Model & Logic Tests ===
from app import RuleSchedule, db_add_rule_schedule, db_get_rule_schedules_for_user, \
                db_get_rule_schedule_by_id, db_update_rule_schedule, db_remove_rule_schedule, \
                execute_scheduled_rule_change, check_and_process_expired_timers, scheduler

VALID_CRON = "0 9 * * MON-FRI"
INVALID_CRON = "not a cron string"

@pytest.fixture
def managed_rule_for_schedule(db, active_user):
    return db_add_managed_rule("schedule_rule_alias", "For Schedule Tests", active_user.id)

def test_add_rule_schedule(db, active_user, managed_rule_for_schedule, mocker):
    mocker.patch.object(scheduler, 'add_job') # Mock APScheduler
    mocker.patch.object(scheduler, 'running', True) 

    schedule = db_add_rule_schedule(
        managed_rule_id=managed_rule_for_schedule.id,
        user_id=active_user.id,
        cron_expression=VALID_CRON,
        action_to_perform="enable",
        is_enabled=True
    )
    assert schedule is not None
    assert schedule.cron_expression == VALID_CRON
    assert schedule.action_to_perform == "enable"
    assert schedule.managed_rule_id == managed_rule_for_schedule.id
    assert schedule.user_id == active_user.id

    # Test adding with invalid cron (should be caught by db_update_rule_schedule if called from UI,
    # but db_add_rule_schedule itself doesn't validate currently in app.py - let's assume it should, or test the caller)
    # For now, testing direct add. If validation is added to db_add_rule_schedule, this test would change.

def test_get_rule_schedules_for_user(db, active_user, managed_rule_for_schedule, mocker):
    mocker.patch.object(scheduler, 'add_job')
    mocker.patch.object(scheduler, 'running', True) 
    db_add_rule_schedule(managed_rule_for_schedule.id, active_user.id, VALID_CRON, "enable")
    db_add_rule_schedule(managed_rule_for_schedule.id, active_user.id, "0 10 * * *", "disable")
    
    schedules = db_get_rule_schedules_for_user(active_user.id)
    assert len(schedules) == 2

def test_update_rule_schedule(db, active_user, managed_rule_for_schedule, mocker):
    mock_add_job = mocker.patch.object(scheduler, 'add_job')
    mock_modify_job = mocker.patch.object(scheduler, 'modify_job')
    mock_remove_job = mocker.patch.object(scheduler, 'remove_job')
    mocker.patch.object(scheduler, 'get_job', return_value=True) # Assume job exists for modification/removal
    mocker.patch.object(scheduler, 'running', True) 

    schedule = db_add_rule_schedule(managed_rule_for_schedule.id, active_user.id, VALID_CRON, "enable", is_enabled=True)
    
    # Update cron
    updated, msg = db_update_rule_schedule(schedule.id, active_user.id, cron="0 12 * * *")
    assert updated is True
    assert msg == "updated"
    assert schedule.cron_expression == "0 12 * * *"
    mock_modify_job.assert_called_once() # Check if APScheduler job was modified

    # Disable schedule
    mock_modify_job.reset_mock()
    updated, msg = db_update_rule_schedule(schedule.id, active_user.id, is_enabled=False)
    assert updated is True
    assert msg == "updated"
    assert schedule.is_enabled is False
    mock_remove_job.assert_called_once() # Check if job was removed

    # Enable schedule again
    mock_remove_job.reset_mock()
    updated, msg = db_update_rule_schedule(schedule.id, active_user.id, is_enabled=True)
    assert updated is True
    assert msg == "updated"
    assert schedule.is_enabled is True
    mock_add_job.assert_called_once() # Check if job was added back

    # Test invalid cron update
    updated, msg = db_update_rule_schedule(schedule.id, active_user.id, cron=INVALID_CRON)
    assert updated is False
    assert msg == "invalid_cron"


def test_remove_rule_schedule(db, active_user, managed_rule_for_schedule, mocker):
    mocker.patch.object(scheduler, 'add_job')
    mocker.patch.object(scheduler, 'remove_job')
    mocker.patch.object(scheduler, 'get_job', return_value=True) # Assume job exists
    mocker.patch.object(scheduler, 'running', True) 

    schedule = db_add_rule_schedule(managed_rule_for_schedule.id, active_user.id, VALID_CRON, "enable")
    removed = db_remove_rule_schedule(schedule.id, active_user.id)
    assert removed is True
    assert db_get_rule_schedule_by_id(schedule.id, active_user.id) is None
    scheduler.remove_job.assert_called_once()


# === APScheduler Job Function Tests ===
@patch('app.get_opnsense_client_instance')
def test_execute_scheduled_rule_change(mock_opnsense_client_getter, app_context, db, active_user, managed_rule_for_schedule, mocker):
    # Setup mock OPNsense client
    mock_client_instance = MagicMock()
    mock_client_instance.enable_alias.return_value = True
    mock_client_instance.disable_alias.return_value = True
    # Simulate get_aliases returning current state
    mock_client_instance.get_aliases.return_value = [
        {"name": managed_rule_for_schedule.alias_name, "enabled": False} # Assume rule is currently disabled
    ]
    mock_opnsense_client_getter.return_value = mock_client_instance
    
    mocker.patch.object(scheduler, 'add_job') # Mock APScheduler for db_add_rule_schedule
    mocker.patch.object(scheduler, 'running', True)

    # Create a schedule to ENABLE the rule
    schedule_to_enable = db_add_rule_schedule(
        managed_rule_id=managed_rule_for_schedule.id,
        user_id=active_user.id,
        cron_expression=VALID_CRON,
        action_to_perform="enable",
        is_enabled=True
    )
    
    # Ensure rule is initially disabled in DB
    managed_rule_for_schedule.is_internally_enabled = False
    db.session.commit()

    # Execute the job function
    execute_scheduled_rule_change(
        managed_rule_id=managed_rule_for_schedule.id,
        action_to_perform="enable",
        user_id=active_user.id,
        schedule_id=schedule_to_enable.id
    )

    mock_client_instance.enable_alias.assert_called_once_with(managed_rule_for_schedule.alias_name)
    updated_rule = ManagedRule.query.get(managed_rule_for_schedule.id)
    assert updated_rule.is_internally_enabled is True
    assert schedule_to_enable.last_triggered_at is not None

    # Test when rule is already in desired state
    mock_client_instance.enable_alias.reset_mock()
    mock_client_instance.get_aliases.return_value = [
        {"name": managed_rule_for_schedule.alias_name, "enabled": True} # Now rule is enabled on OPNsense
    ]
    execute_scheduled_rule_change( # Try to enable again
        managed_rule_id=managed_rule_for_schedule.id,
        action_to_perform="enable",
        user_id=active_user.id,
        schedule_id=schedule_to_enable.id
    )
    mock_client_instance.enable_alias.assert_not_called() # Should not call if already in state

    # Test scheduled action clearing an active timer
    managed_rule_for_schedule.timer_active_until = datetime.now(timezone.utc) + timedelta(hours=1)
    managed_rule_for_schedule.timer_action_on_expiry = "disable"
    managed_rule_for_schedule.is_internally_enabled = True # Assume timer set it to True
    db.session.commit()

    mock_client_instance.disable_alias.reset_mock()
    mock_client_instance.get_aliases.return_value = [
        {"name": managed_rule_for_schedule.alias_name, "enabled": True} # Currently enabled
    ]
    
    schedule_to_disable = db_add_rule_schedule(
        managed_rule_id=managed_rule_for_schedule.id,
        user_id=active_user.id,
        cron_expression="0 0 * * *", # Different cron
        action_to_perform="disable",
        is_enabled=True
    )
    execute_scheduled_rule_change(
        managed_rule_id=managed_rule_for_schedule.id,
        action_to_perform="disable",
        user_id=active_user.id,
        schedule_id=schedule_to_disable.id
    )
    mock_client_instance.disable_alias.assert_called_once_with(managed_rule_for_schedule.alias_name)
    updated_rule_after_disable = ManagedRule.query.get(managed_rule_for_schedule.id)
    assert updated_rule_after_disable.is_internally_enabled is False
    assert updated_rule_after_disable.timer_active_until is None # Timer should be cleared
    assert updated_rule_after_disable.timer_action_on_expiry is None


@patch('app.get_opnsense_client_instance')
def test_check_and_process_expired_timers(mock_opnsense_client_getter, app_context, db, active_user, mocker):
    # Setup mock OPNsense client
    mock_client = MagicMock()
    mock_client.enable_alias.return_value = True
    mock_client.disable_alias.return_value = True
    mock_opnsense_client_getter.return_value = mock_client
    
    # Rule 1: Timer expired, action should be 'disable'
    rule1 = db_add_managed_rule("timer_expire_rule1", "Test Expire 1", active_user.id)
    rule1.is_internally_enabled = True # Assume it was enabled by the timer
    rule1.timer_active_until = datetime.now(timezone.utc) - timedelta(minutes=10) # Expired
    rule1.timer_action_on_expiry = "disable"
    db.session.commit()

    # Rule 2: Timer not yet expired
    rule2 = db_add_managed_rule("timer_active_rule2", "Test Active 2", active_user.id)
    rule2.is_internally_enabled = False # Assume it was disabled by the timer
    rule2.timer_active_until = datetime.now(timezone.utc) + timedelta(hours=1) # Not expired
    rule2.timer_action_on_expiry = "enable"
    db.session.commit()

    # Rule 3: Timer expired, action should be 'enable'
    rule3 = db_add_managed_rule("timer_expire_rule3", "Test Expire 3", active_user.id)
    rule3.is_internally_enabled = False # Assume it was disabled by the timer
    rule3.timer_active_until = datetime.now(timezone.utc) - timedelta(seconds=1) # Just expired
    rule3.timer_action_on_expiry = "enable"
    db.session.commit()

    # Call the function that checks timers
    check_and_process_expired_timers()

    # Assertions for Rule 1 (should be disabled)
    mock_client.disable_alias.assert_any_call(rule1.alias_name)
    updated_rule1 = ManagedRule.query.get(rule1.id)
    assert updated_rule1.is_internally_enabled is False
    assert updated_rule1.timer_active_until is None
    assert updated_rule1.timer_action_on_expiry is None
    
    # Assertions for Rule 2 (should be untouched)
    updated_rule2 = ManagedRule.query.get(rule2.id)
    assert updated_rule2.is_internally_enabled is False # State unchanged
    assert updated_rule2.timer_active_until is not None # Timer still active

    # Assertions for Rule 3 (should be enabled)
    mock_client.enable_alias.assert_any_call(rule3.alias_name)
    updated_rule3 = ManagedRule.query.get(rule3.id)
    assert updated_rule3.is_internally_enabled is True
    assert updated_rule3.timer_active_until is None
    assert updated_rule3.timer_action_on_expiry is None
