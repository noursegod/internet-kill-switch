const axios = require('axios');
const https = require('https'); // Added https module

class OpnsenseService {
    constructor(baseURL, apiKey, apiSecret) {
        if (!baseURL || !apiKey || !apiSecret) {
            throw new Error("OpnsenseService: baseURL, apiKey, and apiSecret are required.");
        }
        this.client = axios.create({
            baseURL: baseURL,
            auth: {
                username: apiKey,
                password: apiSecret,
            },
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 5000, // 5 seconds
        });

        // Check if SSL certificate validation should be ignored
        if (process.env.OPNSENSE_IGNORE_CERT_ERRORS === 'true' || process.env.OPNSENSE_IGNORE_CERT_ERRORS === '1') {
            const httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });
            this.client.defaults.httpsAgent = httpsAgent;
            console.log('OpnsenseService: SSL certificate validation is DISABLED due to OPNSENSE_IGNORE_CERT_ERRORS environment variable.');
        }
    }

    /**
     * Fetches firewall filter rules.
     * OPNsense API for filter rules is typically under /firewall/filter.
     * Endpoint for searching/listing: /firewall/filter/searchRule
     * Endpoint for getting a specific rule: /firewall/filter/getRule/{uuid}
     * Endpoint for toggling: /firewall/filter/toggleRule/{uuid}
     * Endpoint for applying: /firewall/filter/apply
     * Note: VLAN filtering is not explicitly supported by a direct API parameter in searchRule.
     * It would typically be part of the rule's 'interface' field.
     * This method will fetch all rules, and filtering would need to be done by the caller.
     */
    async fetchFirewallRules(vlanFilter = null) {
        try {
            const response = await this.client.get('/firewall/filter/searchRule');
            // OPNsense API responses often have data nested.
            // common structure is response.data (if search returns all) or response.data.rows for search results
            let rules = [];
            if (response.data && response.data.rows) { // Common for search results
                rules = response.data.rows;
            } else if (Array.isArray(response.data)) { // If the endpoint directly returns an array
                rules = response.data;
            } else {
                console.warn("fetchFirewallRules: Unexpected response structure:", response.data);
                return []; // Return empty if structure is not recognized
            }
            
            return rules.map(rule => ({
                uuid: rule.uuid,
                description: rule.descr || rule.description || '', // 'descr' is common in OPNsense
                enabled: rule.enabled === '1' || rule.enabled === true,
                interface: rule.interface || null, // Attempt to get interface for potential VLAN info
                // Add other relevant fields as identified from actual API response
            }));
        } catch (error) {
            console.error("OpnsenseService::fetchFirewallRules - Error fetching rules:", error.message);
            if (error.response) {
                console.error("Error Response Data:", error.response.data);
                console.error("Error Response Status:", error.response.status);
            }
            throw new Error(`Failed to fetch firewall rules: ${error.message}`);
        }
    }

    async getRuleDetails(ruleId) {
        if (!ruleId) throw new Error("ruleId is required.");
        try {
            const response = await this.client.get(`/firewall/filter/getRule/${ruleId}`);
            // The response for getRule might be nested under a key, e.g., response.data.rule
            const ruleData = response.data && response.data.rule ? response.data.rule : response.data;

            if (!ruleData || Object.keys(ruleData).length === 0) { // Check if ruleData is empty or null
                 throw new Error(`Rule with ID ${ruleId} not found or empty response.`);
            }

            return {
                uuid: ruleData.uuid || ruleId, // Fallback to ruleId if uuid is not in response (should be)
                description: ruleData.descr || ruleData.description || '',
                enabled: ruleData.enabled === '1' || ruleData.enabled === true,
                interface: ruleData.interface || null,
                // Potentially more details here
            };
        } catch (error) {
            console.error(`OpnsenseService::getRuleDetails - Error fetching rule ${ruleId}:`, error.message);
            if (error.response) {
                console.error("Error Response Data:", error.response.data);
            }
            throw new Error(`Failed to fetch rule details for ${ruleId}: ${error.message}`);
        }
    }

    async _toggleRule(ruleId, targetStateBoolean) {
        if (!ruleId) throw new Error("ruleId is required for toggling.");
        try {
            // First, get the current state of the rule
            // OPNsense toggleRule endpoint usually just flips the state.
            // We need to ensure it reaches the targetStateBoolean.
            // The API /firewall/filter/getRule/{uuid} should give us the current state.
            // Let's assume getRuleDetails is too much, and searchRule gives us enabled status.
            // However, for a direct toggle, some APIs don't need current state if it's a true toggle.
            // The python client used toggle_alias which implies a simple toggle.
            // If `/firewall/filter/toggleRule/${ruleId}` is a true toggle:
            
            // Fetch current state to see if a toggle is needed
            const currentRuleStateResponse = await this.client.get(`/firewall/filter/getRule/${ruleId}`);
            let currentEnabled = false;
            if (currentRuleStateResponse.data && currentRuleStateResponse.data.rule) {
                 currentEnabled = currentRuleStateResponse.data.rule.enabled === '1' || currentRuleStateResponse.data.rule.enabled === true;
            } else if (currentRuleStateResponse.data) { // If not nested under 'rule'
                 currentEnabled = currentRuleStateResponse.data.enabled === '1' || currentRuleStateResponse.data.enabled === true;
            } else {
                throw new Error(`Could not determine current state for rule ${ruleId} before toggling.`);
            }

            if (currentEnabled === targetStateBoolean) {
                console.log(`OpnsenseService: Rule ${ruleId} is already in the desired state (${targetStateBoolean ? 'enabled' : 'disabled'}). No toggle needed.`);
                return { success: true, changed: false, message: "Rule already in desired state." };
            }

            const response = await this.client.post(`/firewall/filter/toggleRule/${ruleId}`, {}); // POST request, often empty body for toggle
            // OPNsense toggle often returns a status like {"status":"ok"} or similar
            if (response.data && (response.data.status === 'ok' || response.data.changed === true || response.status === 200)) {
                 // Verify the new state if possible, or assume toggle worked
                return { success: true, changed: true, message: `Rule ${ruleId} toggled successfully.` };
            }
            // Fallback for APIs that return new status directly, e.g. {"enabled": "0"}
            if (response.data && typeof response.data.enabled !== 'undefined') {
                const newEnabledState = response.data.enabled === '1' || response.data.enabled === true;
                if (newEnabledState === targetStateBoolean) {
                    return { success: true, changed: true, message: `Rule ${ruleId} state set to ${targetStateBoolean}.` };
                } else {
                    // This case means toggle happened but didn't result in target state, which is unusual for a toggle.
                    // More likely if it was a set state (true/false) call.
                    console.warn(`OpnsenseService: Rule ${ruleId} toggle action performed, but final state ${newEnabledState} does not match target ${targetStateBoolean}.`);
                    return { success: false, changed: true, message: `Rule ${ruleId} toggled, but final state is unexpected.`};
                }
            }
            console.warn("OpnsenseService: Toggle response was not conclusively successful:", response.data);
            return { success: false, changed: false, message: "Toggle action performed, but success status unclear from OPNsense response."};

        } catch (error) {
            console.error(`OpnsenseService::_toggleRule - Error toggling rule ${ruleId} to ${targetStateBoolean}:`, error.message);
            if (error.response) console.error("Error Response Data:", error.response.data);
            throw new Error(`Failed to toggle rule ${ruleId}: ${error.message}`);
        }
    }

    async enableRule(ruleId) {
        const result = await this._toggleRule(ruleId, true);
        if (result.success && result.changed) {
            // Only apply if a change was made by the toggle
            await this.applyFirewallChanges(); 
        }
        return result.success;
    }

    async disableRule(ruleId) {
        const result = await this._toggleRule(ruleId, false);
         if (result.success && result.changed) {
            // Only apply if a change was made by the toggle
            await this.applyFirewallChanges();
        }
        return result.success;
    }

    async applyFirewallChanges() {
        try {
            // Common endpoint for applying firewall changes is /firewall/filter/apply
            // It's typically a POST request.
            const response = await this.client.post('/firewall/filter/apply', {}); // Empty body usually sufficient
            // Successful apply often returns a status or specific message
            if (response.data && (response.data.status === 'ok' || response.data.status === 'done' || response.status === 200 )) {
                console.log("OpnsenseService: Firewall changes applied successfully.");
                return true;
            }
            // Sometimes it might be under a different service like /firewall/service/reload or reconfigure
            // const serviceReloadResponse = await this.client.post('/firewall/service/reload', {});
            // if (serviceReloadResponse.status === 200) return true;

            console.warn("OpnsenseService::applyFirewallChanges - Apply response not conclusively successful:", response.data);
            return false;
        } catch (error) {
            console.error("OpnsenseService::applyFirewallChanges - Error applying changes:", error.message);
            if (error.response) console.error("Error Response Data:", error.response.data);
            throw new Error(`Failed to apply firewall changes: ${error.message}`);
        }
    }
}

module.exports = OpnsenseService;
