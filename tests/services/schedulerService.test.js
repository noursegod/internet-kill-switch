const schedulerService = require('../../services/schedulerService');
const db = require('../../db/database'); // Mock this
const OpnsenseService = require('../../services/opnsenseService'); // Mock this
const nodeCron = require('node-cron'); // Mock this

jest.mock('../../db/database', () => ({
    getAllActiveSchedules: jest.fn(),
    getManagedRuleByUuid: jest.fn(), // For fetching rule details if needed by job logic
    updateManagedRuleTimer: jest.fn(),
    updateManagedRuleDesiredState: jest.fn(),
    updateScheduleLastTriggered: jest.fn(),
    getExpiredTimerRules: jest.fn(), // For timer processing part
}));

jest.mock('../../services/opnsenseService'); // Mock the entire class

jest.mock('node-cron', () => ({
    schedule: jest.fn((cronTime, func, options) => ({ // Mock schedule to return a job object
        start: jest.fn(), // Mock job.start() if you call it (default is auto-start)
        stop: jest.fn(),  // Mock job.stop()
    })),
    validate: jest.fn().mockReturnValue(true), // Assume cron expressions are valid by default
}));

describe('Scheduler Service', () => {
    let mockOpnsenseInstance;

    beforeEach(() => {
        // Reset all mocks
        Object.values(db).forEach(mockFn => mockFn.mockReset());
        nodeCron.schedule.mockClear();
        nodeCron.validate.mockClear().mockReturnValue(true); // Reset and keep default as valid
        
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
        let timerProcessingFunction;
        
        beforeEach(() => {
            nodeCron.schedule.mockImplementation((cron, func, options) => {
                if (options && options.id === '__timerProcessor') { // Check if it's the timer job
                     timerProcessingFunction = func;
                }
                return { stop: jest.fn(), start: jest.fn() };
            });
            // Call loadAndScheduleAllActiveJobs to ensure startTimerProcessingJob is called
            db.getAllActiveSchedules.mockResolvedValue([]); // No rule schedules for this part
            schedulerService.loadAndScheduleAllActiveJobs(); 
            
            // Ensure timerProcessingFunction is captured
            if (!timerProcessingFunction) {
                // Fallback if previous call didn't capture it (e.g. if no OPNsense schedules)
                // This explicitly calls startTimerProcessingJob to ensure the cron job is set up
                // and its function can be captured.
                schedulerService.startTimerProcessingJob();
                if (nodeCron.schedule.mock.calls.length > 0) {
                    const lastCall = nodeCron.schedule.mock.calls[nodeCron.schedule.mock.calls.length - 1];
                    if (lastCall[2] && lastCall[2].id === '__timerProcessor') {
                         timerProcessingFunction = lastCall[1];
                    }
                }
                if (!timerProcessingFunction) {
                    throw new Error("Timer processing function not captured from nodeCron.schedule mock.");
                }
            }
        });

        test('timer processing job should process expired timers', async () => {
            const expiredRule = { 
                id: 20, 
                opnsense_rule_uuid: 'expired-uuid', 
                user_id: 1, 
                desired_state: true, // Was enabled by timer
                timer_action_on_expiry: 'disable' 
            };
            db.getExpiredTimerRules.mockResolvedValue([expiredRule]);
            
            await timerProcessingFunction(); // Manually invoke the job's function

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
            await timerProcessingFunction();
            expect(mockOpnsenseInstance.disableRule).not.toHaveBeenCalled();
            expect(mockOpnsenseInstance.enableRule).not.toHaveBeenCalled();
        });

        test('timer processing job should handle OPNsense API failure gracefully', async () => {
            const expiredRule = { id: 21, opnsense_rule_uuid: 'expired-fail-uuid', user_id: 1, timer_action_on_expiry: 'enable', desired_state: false };
            db.getExpiredTimerRules.mockResolvedValue([expiredRule]);
            mockOpnsenseInstance.enableRule.mockResolvedValue(false); // Simulate OPNsense failure

            await timerProcessingFunction();
            
            expect(mockOpnsenseInstance.enableRule).toHaveBeenCalledWith(expiredRule.opnsense_rule_uuid);
            // DB should NOT be updated if OPNsense action failed
            expect(db.updateManagedRuleDesiredState).not.toHaveBeenCalled();
            expect(db.updateManagedRuleTimer).not.toHaveBeenCalled();
        });
    });
});
