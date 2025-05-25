import pytest
from unittest.mock import MagicMock, patch
from opnsense_client import OPNsenseClient # Assuming your client is in opnsense_client.py

# Define common parameters for OPNsenseClient initialization
API_KEY = "test_key"
API_SECRET = "test_secret"
BASE_URL = "https://mock-opnsense.example.com/api"

@pytest.fixture
def mock_opnsense_api_core(mocker):
    """
    Mocks the core `API` object from the `opnsense_api.api` library
    that is instantiated by OPNsenseClient.
    """
    # The path to patch is where 'API' is looked up. 
    # If OPNsenseClient.py has `from opnsense_api.api import API`, then 'opnsense_client.API' is correct.
    mock = mocker.patch('opnsense_client.API') 
    return mock


def test_opnsense_client_initialization(mock_opnsense_api_core):
    """Test that OPNsenseClient initializes the opnsense_api.api.API correctly."""
    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    mock_opnsense_api_core.assert_called_once_with(API_KEY, API_SECRET, BASE_URL, ssl_verify=False)
    assert client.client is not None # Ensure the internal client is set

def test_get_aliases_success(mock_opnsense_api_core):
    """Test get_aliases successfully retrieves and parses aliases."""
    mock_api_instance = mock_opnsense_api_core.return_value # This is the instance of the mocked API class
    
    # Example response from opnsense_api.firewall.alias.search_alias()
    mock_api_instance.firewall.alias.search_alias.return_value = {
        "rows": [
            {"name": "alias1", "uuid": "uuid1", "enabled": "1", "description": "Desc 1"},
            {"name": "alias2", "uuid": "uuid2", "enabled": "0", "description": "Desc 2"},
            {"name": "alias3_no_desc", "uuid": "uuid3", "enabled": "1"}, # Test missing optional fields
        ],
        "rowCount": 3 
    }

    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    aliases = client.get_aliases()

    assert aliases is not None
    assert len(aliases) == 3
    assert {"name": "alias1", "uuid": "uuid1", "enabled": True} in aliases
    assert {"name": "alias2", "uuid": "uuid2", "enabled": False} in aliases
    assert {"name": "alias3_no_desc", "uuid": "uuid3", "enabled": True} in aliases
    mock_api_instance.firewall.alias.search_alias.assert_called_once()


def test_get_aliases_empty_response(mock_opnsense_api_core):
    """Test get_aliases with an empty response from the API."""
    mock_api_instance = mock_opnsense_api_core.return_value
    mock_api_instance.firewall.alias.search_alias.return_value = {"rows": [], "rowCount": 0}
    
    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    aliases = client.get_aliases()
    assert aliases == []

def test_get_aliases_api_error(mock_opnsense_api_core):
    """Test get_aliases when the API call raises an exception."""
    mock_api_instance = mock_opnsense_api_core.return_value
    mock_api_instance.firewall.alias.search_alias.side_effect = Exception("API communication error")
    
    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    aliases = client.get_aliases()
    assert aliases is None # Should return None on error as per current implementation

@patch('opnsense_client.OPNsenseClient.get_aliases') # Mock internal get_aliases
def test_get_alias_uuid_found(mock_get_aliases):
    """Test _get_alias_uuid when alias is found."""
    mock_get_aliases.return_value = [
        {"name": "existing_alias", "uuid": "found-uuid", "enabled": True}
    ]
    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    uuid = client._get_alias_uuid("existing_alias")
    assert uuid == "found-uuid"

@patch('opnsense_client.OPNsenseClient.get_aliases')
def test_get_alias_uuid_not_found(mock_get_aliases):
    """Test _get_alias_uuid when alias is not found."""
    mock_get_aliases.return_value = [
        {"name": "other_alias", "uuid": "other-uuid", "enabled": True}
    ]
    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    uuid = client._get_alias_uuid("non_existent_alias")
    assert uuid is None

# --- Tests for enable_alias, disable_alias, and apply_firewall_rules ---
# These require mocking _get_alias_uuid and the specific OPNsense API calls

@patch('opnsense_client.OPNsenseClient._get_alias_uuid')
@patch('opnsense_client.OPNsenseClient.apply_firewall_rules') # Also mock apply_firewall_rules
def test_enable_alias_success(mock_apply_rules, mock_get_uuid, mock_opnsense_api_core):
    mock_get_uuid.return_value = "target-uuid"
    mock_apply_rules.return_value = True # Assume apply succeeds
    
    mock_api_instance = mock_opnsense_api_core.return_value
    # Simulate the alias is currently disabled, so toggle will enable it
    mock_api_instance.firewall.alias.get_alias.return_value = {"alias": {"enabled": "0"}}
    mock_api_instance.firewall.alias.toggle_alias.return_value = {"status": "success"} # Or whatever success looks like

    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    result = client.enable_alias("my_alias_to_enable")

    assert result is True
    mock_get_uuid.assert_called_once_with("my_alias_to_enable")
    mock_api_instance.firewall.alias.get_alias.assert_called_once_with("target-uuid")
    mock_api_instance.firewall.alias.toggle_alias.assert_called_once_with("target-uuid")
    mock_apply_rules.assert_called_once()


@patch('opnsense_client.OPNsenseClient._get_alias_uuid')
@patch('opnsense_client.OPNsenseClient.apply_firewall_rules')
def test_enable_alias_already_enabled(mock_apply_rules, mock_get_uuid, mock_opnsense_api_core):
    mock_get_uuid.return_value = "target-uuid"
    mock_apply_rules.return_value = True
    
    mock_api_instance = mock_opnsense_api_core.return_value
    # Simulate the alias is already enabled
    mock_api_instance.firewall.alias.get_alias.return_value = {"alias": {"enabled": "1"}}

    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    result = client.enable_alias("my_alias_already_enabled")

    assert result is True
    mock_api_instance.firewall.alias.toggle_alias.assert_not_called() # Should not toggle if already enabled
    mock_apply_rules.assert_called_once() # Should still apply rules as per current logic


@patch('opnsense_client.OPNsenseClient._get_alias_uuid')
@patch('opnsense_client.OPNsenseClient.apply_firewall_rules')
def test_disable_alias_success(mock_apply_rules, mock_get_uuid, mock_opnsense_api_core):
    mock_get_uuid.return_value = "target-uuid"
    mock_apply_rules.return_value = True
    
    mock_api_instance = mock_opnsense_api_core.return_value
    # Simulate the alias is currently enabled, so toggle will disable it
    mock_api_instance.firewall.alias.get_alias.return_value = {"alias": {"enabled": "1"}}
    mock_api_instance.firewall.alias.toggle_alias.return_value = {"status": "success"}

    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    result = client.disable_alias("my_alias_to_disable")

    assert result is True
    mock_api_instance.firewall.alias.toggle_alias.assert_called_once_with("target-uuid")
    mock_apply_rules.assert_called_once()


@patch('opnsense_client.OPNsenseClient._get_alias_uuid')
def test_enable_alias_not_found(mock_get_uuid):
    mock_get_uuid.return_value = None # Alias not found
    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    result = client.enable_alias("non_existent_alias")
    assert result is False

@patch('opnsense_client.OPNsenseClient._get_alias_uuid')
@patch('opnsense_client.OPNsenseClient.apply_firewall_rules')
def test_enable_alias_toggle_fails(mock_apply_rules, mock_get_uuid, mock_opnsense_api_core):
    mock_get_uuid.return_value = "target-uuid"
    # apply_firewall_rules is not relevant if toggle fails
    
    mock_api_instance = mock_opnsense_api_core.return_value
    mock_api_instance.firewall.alias.get_alias.return_value = {"alias": {"enabled": "0"}} # Needs toggle
    mock_api_instance.firewall.alias.toggle_alias.side_effect = Exception("Toggle API error")

    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    result = client.enable_alias("my_alias_toggle_fail")
    assert result is False
    mock_apply_rules.assert_not_called() # Should not apply if toggle failed

@patch('opnsense_client.OPNsenseClient._get_alias_uuid')
@patch('opnsense_client.OPNsenseClient.apply_firewall_rules')
def test_enable_alias_apply_fails(mock_apply_rules, mock_get_uuid, mock_opnsense_api_core):
    mock_get_uuid.return_value = "target-uuid"
    mock_apply_rules.return_value = False # Simulate apply_firewall_rules failing
    
    mock_api_instance = mock_opnsense_api_core.return_value
    mock_api_instance.firewall.alias.get_alias.return_value = {"alias": {"enabled": "0"}}
    mock_api_instance.firewall.alias.toggle_alias.return_value = {"status": "success"}

    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    # Current OPNsenseClient implementation for enable/disable doesn't directly return the status of apply_firewall_rules
    # It prints a message if apply_firewall_rules fails but returns True if toggle was successful.
    # This test reflects that. If the behavior should be False if apply fails, the client code needs change.
    result = client.enable_alias("my_alias_apply_fail")
    assert result is True # Because toggle succeeded, apply_firewall_rules failure is logged not returned as error by enable_alias
    mock_apply_rules.assert_called_once()


def test_apply_firewall_rules_success(mock_opnsense_api_core):
    mock_api_instance = mock_opnsense_api_core.return_value
    mock_api_instance.firewall.filter.reconfigure.return_value = {"status": "ok"} # Or similar success indicator

    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    result = client.apply_firewall_rules()
    assert result is True
    mock_api_instance.firewall.filter.reconfigure.assert_called_once()

def test_apply_firewall_rules_failure_status(mock_opnsense_api_core):
    mock_api_instance = mock_opnsense_api_core.return_value
    mock_api_instance.firewall.filter.reconfigure.return_value = {"status": "failed", "message": "Something went wrong"}

    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    result = client.apply_firewall_rules()
    assert result is False

def test_apply_firewall_rules_api_exception(mock_opnsense_api_core):
    mock_api_instance = mock_opnsense_api_core.return_value
    mock_api_instance.firewall.filter.reconfigure.side_effect = Exception("Filter reconfigure API error")

    client = OPNsenseClient(API_KEY, API_SECRET, BASE_URL)
    result = client.apply_firewall_rules()
    assert result is False
