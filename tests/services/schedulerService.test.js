const schedulerService = require('../../services/schedulerService');
const db = require('../../db/database'); // Mock this
const OpnsenseService = require('../../services/opnsenseService'); // Mock this
const nodeCron = require('node-cron'); // Mock this

jest.mock('../../db/database', () => ({
    getAllActiveSchedules: jest.fn(),
    getManagedRuleByUuid: jest.fn(),
    updateManagedRuleTimer: jest.fn(),
    updateManagedRuleDesiredState: jest.fn(),
    updateScheduleLastTriggered: jest.fn(),
    getExpiredTimerRules: jest.fn(),
    updateSchedule: jest.fn(), // Added missing mock for updateSchedule
}));

jest.mock('../../services/opnsenseService');

// Store captured cron functions for testing
const capturedCronCallbacks = new Map();

jest.mock('node-cron', () => {
    const originalNodeCron = jest.requireActual('node-cron');
    return {
        ...originalNodeCron,
        validate: jest.fn(expr => typeof expr === 'string' && expr.length > 0), // Basic validation
        schedule: jest.fn((cronExpression, func, options) => {
            // Store the callback function using its cron expression as a key.
            // If multiple jobs have the same expression, the last one scheduled will be stored.
            // For tests, ensure unique expressions if testing multiple distinct jobs simultaneously,
            // or retrieve based on call order if necessary.
            capturedCronCallbacks.set(cronExpression, func);
            
            // Return a mock job object
            return {
                start: jest.fn(),
                stop: jest.fn(),
            };
        }),
    };
});

describe('Scheduler Service', () => {
    let mockOpnsenseInstance;

    beforeEach(() => {
        // Reset all mocks
        Object.values(db).forEach(mockFn => mockFn.mockReset());
        
        // Clear captured cron jobs and mock call counts
        capturedCronCallbacks.clear();
        if (nodeCron.schedule.mockClear) nodeCron.schedule.mockClear(); // handle if not jest.fn() directly
        if (nodeCron.validate.mockClear) nodeCron.validate.mockClear().mockReturnValue(true);
        
        // Clear the activeJobs object in the actual module (if possible and safe)
        // This is a bit of a hack, better if schedulerService had a reset method
        for (const jobId in schedulerService.activeJobs) {
            if (schedulerService.activeJobs[jobId].stop) { // Check if it has stop method
                 schedulerService.activeJobs[jobId].stop();
            }
            delete schedulerService.activeJobs[jobId];
        }


        // Setup mock for OpnsenseService constructor and its methods
        mockOpnsenseInstance = {
            enableRule: jest.fn().mockResolvedValue(true),
            disableRule: jest.fn().mockResolvedValue(true),
            // Add other methods if used by scheduler jobs
        };
        OpnsenseService.mockImplementation(() => mockOpnsenseInstance);

        // Mock environment variables for OPNsense configuration
        process.env.OPNSENSE_BASE_URL = 'https://test-opnsense';
        process.env.OPNSENSE_API_KEY = 'test-key';
        process.env.OPNSENSE_API_SECRET = 'test-secret';
    });

    afterEach(() => {
        // Clean up environment variables
        delete process.env.OPNSENSE_BASE_URL;
        delete process.env.OPNSENSE_API_KEY;
        delete process.env.OPNSENSE_API_SECRET;
    });


    describe('scheduleJob and unscheduleJob', () => {
        const mockSchedule = {
            id: 1,
            cron_expression: '* * * * *',
            action_to_perform: 'enable',
            managed_rule_id: 10,
            opnsense_rule_uuid: 'rule-uuid-1', // Added from DB join
            user_id: 1,
            is_enabled: true,
        };

        test('scheduleJob should schedule a job with node-cron', () => {
            schedulerService.scheduleJob(mockSchedule);
            expect(nodeCron.schedule).toHaveBeenCalledWith(mockSchedule.cron_expression, expect.any(Function), expect.any(Object));
            expect(schedulerService.activeJobs[mockSchedule.id]).toBeDefined();
        });

        test('scheduleJob should replace an existing job for the same schedule ID', () => {
            schedulerService.scheduleJob(mockSchedule); // First time
            const firstJobInstance = schedulerService.activeJobs[mockSchedule.id];
            expect(firstJobInstance).toBeDefined();

            schedulerService.scheduleJob(mockSchedule); // Second time for same ID
            expect(nodeCron.schedule).toHaveBeenCalledTimes(2); // schedule called again
            expect(firstJobInstance.stop).toHaveBeenCalled(); // Old job stopped
            expect(schedulerService.activeJobs[mockSchedule.id]).toBeDefined();
            expect(schedulerService.activeJobs[mockSchedule.id]).not.toBe(firstJobInstance); // New job instance
        });
        
        test('scheduleJob should not schedule if cron is invalid', () => {
            nodeCron.validate.mockReturnValueOnce(false);
            const invalidSchedule = { ...mockSchedule, id: 2, cron_expression: 'invalid' };
            schedulerService.scheduleJob(invalidSchedule);
            expect(nodeCron.schedule).not.toHaveBeenCalledWith('invalid', expect.any(Function), expect.any(Object));
            expect(schedulerService.activeJobs[2]).toBeUndefined();
        });


        test('unscheduleJob should stop and remove a job', () => {
            schedulerService.scheduleJob(mockSchedule);
            const jobInstance = schedulerService.activeJobs[mockSchedule.id];
            
            schedulerService.unscheduleJob(mockSchedule.id);
            expect(jobInstance.stop).toHaveBeenCalled();
            expect(schedulerService.activeJobs[mockSchedule.id]).toBeUndefined();
        });
    });

    describe('loadAndScheduleAllActiveJobs', () => {
        test('should fetch active schedules and schedule them', async () => {
            const mockSchedules = [
                { id: 1, cron_expression: '* * * * *', action_to_perform: 'enable', managed_rule_id: 1, opnsense_rule_uuid: 'uuid1', user_id:1, is_enabled: true },
                { id: 2, cron_expression: '0 * * * *', action_to_perform: 'disable', managed_rule_id: 2, opnsense_rule_uuid: 'uuid2', user_id:1, is_enabled: true },
            ];
            db.getAllActiveSchedules.mockResolvedValue(mockSchedules);

            await schedulerService.loadAndScheduleAllActiveJobs();

            expect(db.getAllActiveSchedules).toHaveBeenCalled();
            expect(nodeCron.schedule).toHaveBeenCalledTimes(mockSchedules.length + 1); // +1 for timerProcessor
            expect(schedulerService.activeJobs[1]).toBeDefined();
            expect(schedulerService.activeJobs[2]).toBeDefined();
            expect(schedulerService.activeJobs['__timerProcessor']).toBeDefined(); // Timer job should also be scheduled
        });
        
        test('should clear existing rule jobs before loading new ones', async () => {
            // Pre-populate an "old" job
            const oldScheduleId = 99;
            const mockOldJob = { stop: jest.fn() };
            schedulerService.activeJobs[oldScheduleId] = mockOldJob;
            
            db.getAllActiveSchedules.mockResolvedValue([]); // No new schedules to load
            await schedulerService.loadAndScheduleAllActiveJobs();
            
            expect(mockOldJob.stop).toHaveBeenCalled();
            expect(schedulerService.activeJobs[oldScheduleId]).toBeUndefined();
        });

    });
    
    describe('Scheduled Job Execution Logic (via calling the scheduled function directly)', () => {
        let scheduledFunction;
        const mockRule = { id: 1, opnsense_rule_uuid: 'rule-uuid-for-job', user_id: 1, description: 'Test Rule Job' };
        const mockSchedule = {
            id: 1,
            cron_expression: '* * * * *',
            action_to_perform: 'enable',
            managed_rule_id: mockRule.id,
            opnsense_rule_uuid: mockRule.opnsense_rule_uuid, // Ensure this is passed from the joined query
            user_id: mockRule.user_id,
            is_enabled: true,
        };

        beforeEach(() => {
            // Capture the function passed to nodeCron.schedule
            nodeCron.schedule.mockImplementation((cron, func) => {
                scheduledFunction = func; // Capture the function
                return { stop: jest.fn() }; // Return a mock job object
            });
            schedulerService.scheduleJob(mockSchedule); // This will set scheduledFunction
        });

        test('job should enable rule on OPNsense and update DB', async () => {
            db.getManagedRuleByUuid.mockResolvedValue(mockRule); // Simulate rule exists
            
            await scheduledFunction(); // Execute the captured job function

            expect(OpnsenseService).toHaveBeenCalled(); // Ensure service was instantiated
            expect(mockOpnsenseInstance.enableRule).toHaveBeenCalledWith(mockRule.opnsense_rule_uuid);
            expect(db.updateManagedRuleDesiredState).toHaveBeenCalledWith({
                uuid: mockRule.opnsense_rule_uuid,
                userId: mockRule.user_id,
                desiredState: true,
            });
            expect(db.updateScheduleLastTriggered).toHaveBeenCalledWith(mockSchedule.id);
            // Timer clearing should also be called
            expect(db.updateManagedRuleTimer).toHaveBeenCalledWith({
                uuid: mockRule.opnsense_rule_uuid,
                userId: mockRule.user_id,
                timerActiveUntil: null,
                timerActionOnExpiry: null,
            });
        });
        
        test('job should disable rule on OPNsense and update DB', async () => {
            const disableSchedule = { ...mockSchedule, action_to_perform: 'disable' };
            nodeCron.schedule.mockImplementation((cron, func) => { scheduledFunction = func; return { stop: jest.fn() }; });
            schedulerService.scheduleJob(disableSchedule); // Reschedule with disable action

            db.getManagedRuleByUuid.mockResolvedValue(mockRule);
            await scheduledFunction();

            expect(mockOpnsenseInstance.disableRule).toHaveBeenCalledWith(mockRule.opnsense_rule_uuid);
            expect(db.updateManagedRuleDesiredState).toHaveBeenCalledWith({
                uuid: mockRule.opnsense_rule_uuid,
                userId: mockRule.user_id,
                desiredState: false,
            });
            expect(db.updateScheduleLastTriggered).toHaveBeenCalledWith(disableSchedule.id);
        });

        test('job should not run if OPNsense not configured and action requires it', async () => {
            // Simulate OPNsense not configured
            delete process.env.OPNSENSE_API_KEY; // Or set to placeholder
            // Re-initialize schedulerService to pick up new env state for getOpnsenseService()
            // This is tricky because module is already loaded. Better to mock getOpnsenseService directly for this test.
            const originalGetOpnsenseService = jest.requireActual('../../services/schedulerService').getOpnsenseService;
            const mockGetOpnsenseService = jest.fn().mockReturnValue(null);
            
            // Temporarily mock getOpnsenseService within schedulerService if it's not easily re-injectable
            // This is more of an integration test of the job's internal call.
            // For this test, let's assume the getOpnsenseService check inside the job works.
            // The job's internal getOpnsenseService() will use the modified process.env.

            await scheduledFunction(); // Execute the job

            expect(mockOpnsenseInstance.enableRule).not.toHaveBeenCalled();
            expect(db.updateManagedRuleDesiredState).not.toHaveBeenCalled();
            // Restore for other tests
            process.env.OPNSENSE_API_KEY = 'test-key';
        });
        
        test('job should disable schedule if managed rule is not found', async () => {
            db.getManagedRuleByUuid.mockResolvedValue(null); // Simulate rule deleted
            db.updateSchedule.mockResolvedValue(1); // Simulate DB update success

            await scheduledFunction();

            expect(mockOpnsenseInstance.enableRule).not.toHaveBeenCalled();
            expect(db.updateSchedule).toHaveBeenCalledWith({
                scheduleId: mockSchedule.id,
                userId: mockSchedule.user_id,
                isEnabled: false,
            });
            // Also check if the job was unscheduled (requires spying on activeJobs or unscheduleJob)
        });

    });

    describe('Timer Processing Job (startTimerProcessingJob and processExpiredRuleTimer)', () => {
        // No specific timerProcessingFunction variable needed here anymore, retrieve from capturedCronCallbacks
        
        beforeEach(() => {
            // Reset relevant mocks for timer tests
            db.getExpiredTimerRules.mockReset();
            db.updateManagedRuleDesiredState.mockReset();
            db.updateManagedRuleTimer.mockReset();
            
            OpnsenseService.mockClear(); 
            if (mockOpnsenseInstance) { // Ensure mockOpnsenseInstance is defined from outer scope
                if(mockOpnsenseInstance.enableRule) mockOpnsenseInstance.enableRule.mockReset();
                if(mockOpnsenseInstance.disableRule) mockOpnsenseInstance.disableRule.mockReset();
            }
            // The main beforeEach for 'Scheduler Service' already clears capturedCronCallbacks
            // and nodeCron.schedule.mockClear().
        });

        test('timer processing job should process expired timers', async () => {
            const expiredRule = { 
                id: 20, 
                opnsense_rule_uuid: 'expired-uuid', 
                user_id: 1, 
                desired_state: true, 
                timer_action_on_expiry: 'disable' 
            };
            db.getExpiredTimerRules.mockResolvedValue([expiredRule]);
            
            // Ensure OpnsenseService is mocked to return a working instance for this test
            OpnsenseService.mockImplementation(() => mockOpnsenseInstance);

            schedulerService.startTimerProcessingJob(); // This will schedule the job using the mocked nodeCron.schedule
            
            const timerFunc = capturedCronCallbacks.get('* * * * *'); // Retrieve by cron expression
            if (!timerFunc) {
                throw new Error("Timer processing function ('* * * * *') not captured.");
            }
            await timerFunc(); // Manually invoke the job's function

            expect(db.getExpiredTimerRules).toHaveBeenCalled();
            expect(mockOpnsenseInstance.disableRule).toHaveBeenCalledWith(expiredRule.opnsense_rule_uuid);
            expect(db.updateManagedRuleDesiredState).toHaveBeenCalledWith({
                uuid: expiredRule.opnsense_rule_uuid,
                userId: expiredRule.user_id,
                desiredState: false,
            });
            expect(db.updateManagedRuleTimer).toHaveBeenCalledWith({
                uuid: expiredRule.opnsense_rule_uuid,
                userId: expiredRule.user_id,
                timerActiveUntil: null,
                timerActionOnExpiry: null,
            });
        });
        
        test('timer processing job should do nothing if no expired timers', async () => {
            db.getExpiredTimerRules.mockResolvedValue([]);
            OpnsenseService.mockImplementation(() => mockOpnsenseInstance);

            schedulerService.startTimerProcessingJob();
            const timerFunc = capturedCronCallbacks.get('* * * * *');
            if (!timerFunc) throw new Error("Timer processing function not captured.");
            
            await timerFunc();

            expect(db.getExpiredTimerRules).toHaveBeenCalledTimes(1); // Still checks
            expect(mockOpnsenseInstance.disableRule).not.toHaveBeenCalled();
            expect(mockOpnsenseInstance.enableRule).not.toHaveBeenCalled();
        });

        test('timer processing job should handle OPNsense API failure gracefully', async () => {
            const expiredRule = { id: 21, opnsense_rule_uuid: 'expired-fail-uuid', user_id: 1, timer_action_on_expiry: 'enable', desired_state: false };
            db.getExpiredTimerRules.mockResolvedValue([expiredRule]);
            
            // Ensure OpnsenseService mock is correctly set up to simulate failure for this test
            mockOpnsenseInstance.enableRule.mockResolvedValue(false); 
            OpnsenseService.mockImplementation(() => mockOpnsenseInstance);
            
            schedulerService.startTimerProcessingJob();
            const timerFunc = capturedCronCallbacks.get('* * * * *');
            if (!timerFunc) throw new Error("Timer processing function not captured.");

            await timerFunc();
            
            expect(mockOpnsenseInstance.enableRule).toHaveBeenCalledWith(expiredRule.opnsense_rule_uuid);
            expect(db.updateManagedRuleDesiredState).not.toHaveBeenCalled();
            expect(db.updateManagedRuleTimer).not.toHaveBeenCalled();
        });
    });
});
