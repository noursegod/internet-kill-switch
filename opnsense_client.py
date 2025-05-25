from opnsense_api.api import API

class OPNsenseClient:
    def __init__(self, api_key, api_secret, base_url):
        self.client = API(api_key, api_secret, base_url, ssl_verify=False) # Assuming self-signed certs for now

    def get_aliases(self):
        try:
            response = self.client.firewall.alias.search_alias()
            if response and "rows" in response and response["rows"]:
                return [{"name": alias["name"], "uuid": alias["uuid"], "enabled": alias["enabled"] == "1"} for alias in response["rows"]]
            return []
        except Exception as e:
            print(f"Error fetching aliases: {e}")
            return None

    def _get_alias_uuid(self, alias_name):
        aliases = self.get_aliases()
        if aliases:
            for alias in aliases:
                if alias["name"] == alias_name:
                    return alias["uuid"]
        return None

    def enable_alias(self, alias_name):
        alias_uuid = self._get_alias_uuid(alias_name)
        if not alias_uuid:
            print(f"Alias '{alias_name}' not found.")
            return False
        try:
            # Fetch current settings first, as toggle doesn't take 'enabled' directly
            # This is a common pattern if a direct set_enabled(bool) is not available
            # The opnsense-api library might have a simpler way, this is a generic approach
            alias_details = self.client.firewall.alias.get_alias(alias_uuid)
            if alias_details:
                # Update the alias configuration to set enabled to "1"
                # The exact parameters will depend on the opnsense-api library structure for alias update
                # This is a placeholder for the actual update call
                # Example: self.client.firewall.alias.set_alias(alias_uuid, name=alias_name, enabled="1", ...)
                # For now, we'll use toggle_alias if available, or simulate if not
                
                # The toggle command usually flips the current state.
                # We want to ensure it's enabled.
                current_status = self.client.firewall.alias.get_alias(alias_uuid)
                if current_status and current_status.get('alias', {}).get('enabled', '0') == '0':
                     self.client.firewall.alias.toggle_alias(alias_uuid) # Enable if currently disabled
                self.apply_firewall_rules()
                return True
            return False
        except Exception as e:
            print(f"Error enabling alias {alias_name}: {e}")
            return False

    def disable_alias(self, alias_name):
        alias_uuid = self._get_alias_uuid(alias_name)
        if not alias_uuid:
            print(f"Alias '{alias_name}' not found.")
            return False
        try:
            # Similar to enable, ensure it's disabled
            current_status = self.client.firewall.alias.get_alias(alias_uuid)
            if current_status and current_status.get('alias', {}).get('enabled', '1') == '1':
                self.client.firewall.alias.toggle_alias(alias_uuid) # Disable if currently enabled
            self.apply_firewall_rules()
            return True
        except Exception as e:
            print(f"Error disabling alias {alias_name}: {e}")
            return False

    def apply_firewall_rules(self):
        try:
            # This endpoint reloads all firewall rules, applying any pending changes.
            response = self.client.firewall.filter.reconfigure()
            if response and response.get("status") == "ok":
                print("Firewall rules applied successfully.")
                return True
            else:
                print(f"Failed to apply firewall rules: {response}")
                return False
        except Exception as e:
            print(f"Error applying firewall rules: {e}")
            return False
