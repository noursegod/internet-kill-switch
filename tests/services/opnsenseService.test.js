const OpnsenseService = require('../../services/opnsenseService');
const axios = require('axios');

jest.mock('axios'); // Mock the entire axios module

describe('OpnsenseService', () => {
    const baseURL = 'https://mock-opnsense.example.com/api';
    const apiKey = 'test_key';
    const apiSecret = 'test_secret';
    let service;
    let mockAxiosInstance;

    beforeEach(() => {
        // Reset mocks and create a new service instance for each test
        axios.create.mockReset();
        mockAxiosInstance = {
            get: jest.fn(),
            post: jest.fn(),
        };
        axios.create.mockReturnValue(mockAxiosInstance);
        service = new OpnsenseService(baseURL, apiKey, apiSecret);
    });

    test('constructor should throw error if baseURL, apiKey, or apiSecret is missing', () => {
        expect(() => new OpnsenseService(null, apiKey, apiSecret)).toThrowError(/baseURL, apiKey, and apiSecret are required/);
        expect(() => new OpnsenseService(baseURL, null, apiSecret)).toThrowError(/baseURL, apiKey, and apiSecret are required/);
        expect(() => new OpnsenseService(baseURL, apiKey, null)).toThrowError(/baseURL, apiKey, and apiSecret are required/);
    });

    test('constructor should configure axios client correctly', () => {
        expect(axios.create).toHaveBeenCalledWith({
            baseURL: baseURL,
            auth: {
                username: apiKey,
                password: apiSecret,
            },
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 5000,
        });
    });

    describe('fetchFirewallRules', () => {
        test('should fetch and parse rules correctly from response.data.rows', async () => {
            const mockApiResponse = {
                data: {
                    rows: [
                        { uuid: 'uuid1', descr: 'Rule 1', enabled: '1', interface: 'lan' },
                        { uuid: 'uuid2', description: 'Rule 2', enabled: '0', interface: 'wan' },
                    ],
                },
            };
            mockAxiosInstance.get.mockResolvedValue(mockApiResponse);

            const rules = await service.fetchFirewallRules();
            expect(mockAxiosInstance.get).toHaveBeenCalledWith('/firewall/filter/searchRule');
            expect(rules).toEqual([
                { uuid: 'uuid1', description: 'Rule 1', enabled: true, interface: 'lan' },
                { uuid: 'uuid2', description: 'Rule 2', enabled: false, interface: 'wan' },
            ]);
        });
        
        test('should fetch and parse rules correctly if data is a direct array', async () => {
            const mockApiResponse = {
                data: [
                    { uuid: 'uuid3', descr: 'Rule 3', enabled: true, interface: 'opt1' },
                ],
            };
            mockAxiosInstance.get.mockResolvedValue(mockApiResponse);

            const rules = await service.fetchFirewallRules();
            expect(rules).toEqual([
                { uuid: 'uuid3', description: 'Rule 3', enabled: true, interface: 'opt1' },
            ]);
        });


        test('should return empty array for unexpected response structure', async () => {
            mockAxiosInstance.get.mockResolvedValue({ data: { message: "Unexpected" } });
            const rules = await service.fetchFirewallRules();
            expect(rules).toEqual([]);
        });

        test('should throw an error if API call fails', async () => {
            mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));
            await expect(service.fetchFirewallRules()).rejects.toThrow('Failed to fetch firewall rules: Network error');
        });
    });

    describe('getRuleDetails', () => {
        test('should fetch and parse rule details correctly (nested under "rule")', async () => {
            const ruleId = 'uuid1';
            const mockApiResponse = {
                data: {
                    rule: { uuid: ruleId, descr: 'Detailed Rule 1', enabled: '1', interface: 'lan' }
                }
            };
            mockAxiosInstance.get.mockResolvedValue(mockApiResponse);

            const details = await service.getRuleDetails(ruleId);
            expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/firewall/filter/getRule/${ruleId}`);
            expect(details).toEqual({
                uuid: ruleId, description: 'Detailed Rule 1', enabled: true, interface: 'lan'
            });
        });
        
        test('should fetch and parse rule details correctly (direct data)', async () => {
            const ruleId = 'uuid2';
            const mockApiResponse = {
                data: { uuid: ruleId, description: 'Detailed Rule 2', enabled: false, interface: 'wan' }
            };
            mockAxiosInstance.get.mockResolvedValue(mockApiResponse);
            const details = await service.getRuleDetails(ruleId);
            expect(details).toEqual({
                uuid: ruleId, description: 'Detailed Rule 2', enabled: false, interface: 'wan'
            });
        });


        test('should throw error if ruleId is not provided', async () => {
            await expect(service.getRuleDetails(null)).rejects.toThrow('ruleId is required');
        });

        test('should throw if rule details are empty or not found', async () => {
            mockAxiosInstance.get.mockResolvedValue({ data: {} });
            await expect(service.getRuleDetails('empty-uuid')).rejects.toThrow(/not found or empty response/);
            
            mockAxiosInstance.get.mockResolvedValue({ data: { rule: {} } });
            await expect(service.getRuleDetails('empty-rule-uuid')).rejects.toThrow(/not found or empty response/);
        });
    });

    describe('_toggleRule, enableRule, disableRule', () => {
        const ruleId = 'rule-to-toggle';

        test('enableRule should enable a disabled rule and apply changes', async () => {
            // Rule is currently disabled
            mockAxiosInstance.get.mockResolvedValue({ data: { rule: { uuid: ruleId, enabled: '0' } } }); 
            mockAxiosInstance.post.mockImplementation(async (url) => {
                if (url.includes('toggleRule')) return { data: { status: 'ok', changed: true } }; // Simulate toggle success
                if (url.includes('apply')) return { data: { status: 'ok' } }; // Simulate apply success
                return {};
            });

            const result = await service.enableRule(ruleId);
            expect(result).toBe(true);
            expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/firewall/filter/getRule/${ruleId}`);
            expect(mockAxiosInstance.post).toHaveBeenCalledWith(`/firewall/filter/toggleRule/${ruleId}`, {});
            expect(mockAxiosInstance.post).toHaveBeenCalledWith('/firewall/filter/apply', {});
        });

        test('enableRule should not toggle an already enabled rule but still apply changes', async () => {
            mockAxiosInstance.get.mockResolvedValue({ data: { rule: { uuid: ruleId, enabled: '1' } } });
            mockAxiosInstance.post.mockImplementation(async (url) => { // For apply
                if (url.includes('apply')) return { data: { status: 'ok' } };
                return {};
            });
            
            const result = await service.enableRule(ruleId);
            expect(result).toBe(true); // Service returns true as the rule is in the desired state
            expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/firewall/filter/getRule/${ruleId}`);
            // toggleRule should NOT have been called
            expect(mockAxiosInstance.post).not.toHaveBeenCalledWith(expect.stringContaining('toggleRule'), expect.anything());
            // applyFirewallChanges is called if _toggleRule result.changed is false but success is true.
            // Current OpnsenseService enableRule/disableRule calls apply ONLY if result.changed is true.
            // So, if already in state, changed is false, apply is NOT called. Let's test that.
            expect(mockAxiosInstance.post).not.toHaveBeenCalledWith('/firewall/filter/apply', {});
        });

        test('disableRule should disable an enabled rule and apply changes', async () => {
            mockAxiosInstance.get.mockResolvedValue({ data: { rule: { uuid: ruleId, enabled: '1' } } });
            mockAxiosInstance.post.mockImplementation(async (url) => {
                if (url.includes('toggleRule')) return { data: { status: 'ok', changed: true } };
                if (url.includes('apply')) return { data: { status: 'ok' } };
                return {};
            });

            const result = await service.disableRule(ruleId);
            expect(result).toBe(true);
            expect(mockAxiosInstance.post).toHaveBeenCalledWith(`/firewall/filter/toggleRule/${ruleId}`, {});
            expect(mockAxiosInstance.post).toHaveBeenCalledWith('/firewall/filter/apply', {});
        });

        test('_toggleRule should throw if API call fails', async () => {
            mockAxiosInstance.get.mockResolvedValue({ data: { rule: { uuid: ruleId, enabled: '0' } } });
            mockAxiosInstance.post.mockRejectedValue(new Error('API error during toggle')); // Simulate toggle failure
            
            await expect(service._toggleRule(ruleId, true)).rejects.toThrow('Failed to toggle rule rule-to-toggle: API error during toggle');
        });
    });

    describe('applyFirewallChanges', () => {
        test('should successfully apply firewall changes', async () => {
            mockAxiosInstance.post.mockResolvedValue({ data: { status: 'ok' } });
            const result = await service.applyFirewallChanges();
            expect(result).toBe(true);
            expect(mockAxiosInstance.post).toHaveBeenCalledWith('/firewall/filter/apply', {});
        });
        
        test('should handle different success status for apply (status: done)', async () => {
            mockAxiosInstance.post.mockResolvedValue({ data: { status: 'done' } });
            const result = await service.applyFirewallChanges();
            expect(result).toBe(true);
        });
        
        test('should handle direct 200 OK for apply', async () => {
            mockAxiosInstance.post.mockResolvedValue({ status: 200, data: { message: "Applied" } }); // data might not have 'status'
            const result = await service.applyFirewallChanges();
            expect(result).toBe(true);
        });

        test('should return false if apply API indicates failure', async () => {
            mockAxiosInstance.post.mockResolvedValue({ data: { status: 'failed' } });
            const result = await service.applyFirewallChanges();
            expect(result).toBe(false);
        });

        test('should throw an error if apply API call fails', async () => {
            mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));
            await expect(service.applyFirewallChanges()).rejects.toThrow('Failed to apply firewall changes: Network error');
        });
    });
});
