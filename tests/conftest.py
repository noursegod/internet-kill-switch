import pytest
import os
from app import app as flask_app, db as sqlalchemy_db

@pytest.fixture(scope='session')
def app():
    """Session-wide test Flask application."""
    # Set test configurations
    flask_app.config.update({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",  # Use in-memory SQLite for tests
        "FLASK_APP_SECRET_KEY": "test_secret_key", # Fixed secret for tests
        "WTF_CSRF_ENABLED": False, # Disable CSRF for simpler form testing in functional tests
        # Mock OPNsense and Google OAuth configurations to be "configured"
        # to avoid warnings and allow testing of dependent logic.
        # Specific tests can override these via monkeypatch if needed.
        "OPNSENSE_API_KEY": "test_opnsense_api_key",
        "OPNSENSE_API_SECRET": "test_opnsense_api_secret",
        "OPNSENSE_BASE_URL": "https://mock-opnsense.example.com/api",
        "GOOGLE_OAUTH_CLIENT_ID": "test_google_client_id",
        "GOOGLE_OAUTH_CLIENT_SECRET": "test_google_client_secret",
    })
    
    # Disable APScheduler during tests unless specifically testing it
    # by not calling scheduler.start() or by patching it.
    # For now, we rely on the app's logic that scheduler might not be running.

    return flask_app

@pytest.fixture(scope='function')
def client(app):
    """A test client for the app."""
    return app.test_client()

@pytest.fixture(scope='function')
def db(app):
    """Session-wide test database."""
    with app.app_context():
        sqlalchemy_db.create_all()
        yield sqlalchemy_db
        sqlalchemy_db.session.remove() # Ensure session is closed
        sqlalchemy_db.drop_all()

@pytest.fixture(scope='function')
def app_context(app):
    """Provides an application context for tests that need it without a client."""
    with app.app_context():
        yield

@pytest.fixture
def runner(app):
    """A test runner for the app's Click commands."""
    return app.test_cli_runner()

@pytest.fixture
def mock_opnsense_api_client(mocker):
    """Mocks the OPNsense API client used by OPNsenseClient."""
    # This mock should be specific to how OPNsenseClient instantiates the real API
    # If OPNsenseClient does `from opnsense_api.api import API`, then patch 'opnsense_client.API'
    mock = mocker.patch('opnsense_client.API') 
    return mock

@pytest.fixture
def active_user(db):
    """Creates and returns an active user in the database."""
    from app import User # Import here to avoid issues if models are not yet loaded
    user = User(username="testuser@example.com", is_active=True)
    db.session.add(user)
    db.session.commit()
    return user

@pytest.fixture
def logged_in_client(client, active_user):
    """A test client that is logged in as active_user."""
    with client.session_transaction() as sess:
        sess['user_id'] = active_user.id
        sess['user_info'] = {'email': active_user.username, 'name': 'Test User'}
    return client
