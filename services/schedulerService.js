const nodeCron = require('node-cron');
const OpnsenseService = require('./opnsenseService'); // Assuming path is correct
const db = require('../db/database'); // Assuming all DB functions are exported here

const activeJobs = {}; // In-memory store for active cron jobs (key: schedule.id, value: cronJob instance)

// Helper to instantiate OPNsense service if configured
function getOpnsenseService() {
    if (process.env.OPNSENSE_BASE_URL && process.env.OPNSENSE_BASE_URL !== '!!MUST_BE_SET_IN_ENVIRONMENT!!' &&
        process.env.OPNSENSE_API_KEY && process.env.OPNSENSE_API_KEY !== '!!MUST_BE_SET_IN_ENVIRONMENT!!' &&
        process.env.OPNSENSE_API_SECRET && process.env.OPNSENSE_API_SECRET !== '!!MUST_BE_SET_IN_ENVIRONMENT!!') {
        return new OpnsenseService(
            process.env.OPNSENSE_BASE_URL,
            process.env.OPNSENSE_API_KEY,
            process.env.OPNSENSE_API_SECRET
        );
    }
    console.warn("schedulerService: OPNsense environment variables not fully configured. Scheduled OPNsense actions will fail.");
    return null;
}

async function scheduleJob(schedule) {
    if (!schedule || !schedule.id) {
        console.error("schedulerService.scheduleJob: Invalid schedule object provided.", schedule);
        return;
    }
    if (!nodeCron.validate(schedule.cron_expression)) {
        console.error(`schedulerService.scheduleJob: Invalid cron expression for schedule ${schedule.id}: ${schedule.cron_expression}`);
        return;
    }

    // If a job for this schedule already exists, stop and remove it before creating a new one
    if (activeJobs[schedule.id]) {
        console.log(`schedulerService.scheduleJob: Unscheduling existing job for schedule ${schedule.id} before rescheduling.`);
        activeJobs[schedule.id].stop();
        delete activeJobs[schedule.id];
    }

    const job = nodeCron.schedule(schedule.cron_expression, async () => {
        console.log(`Executing schedule ${schedule.id}: ${schedule.action_to_perform} rule ID ${schedule.managed_rule_id} (OPNsense UUID: ${schedule.opnsense_rule_uuid}) for user ${schedule.user_id}`);
        
        const opnsense = getOpnsenseService();
        if (!opnsense) {
            console.error(`Scheduled task ${schedule.id} failed: OPNsense service not available (configuration missing).`);
            return;
        }

        try {
            // 1. Fetch the managed rule by its primary ID to ensure it still exists and is managed by this user.
            // The opnsense_rule_uuid is already available from getAllActiveSchedules join.
            // We need to ensure the rule itself still exists in ManagedRules if it was somehow deleted without CASCADE working or if schedule is orphaned.
            const managedRule = await db.getManagedRuleByUuid({ uuid: schedule.opnsense_rule_uuid, userId: schedule.user_id });
            if (!managedRule || managedRule.id !== schedule.managed_rule_id) { // Double check ID match if getByUuid was used
                console.error(`Scheduled task ${schedule.id} failed: Managed rule (DB ID ${schedule.managed_rule_id}, OPNsense UUID ${schedule.opnsense_rule_uuid}) not found or mismatch for user ${schedule.user_id}.`);
                // Consider unscheduling this job or marking the schedule as disabled in DB
                unscheduleJob(schedule.id); // Stop this job from running again
                await db.updateSchedule({scheduleId: schedule.id, userId: schedule.user_id, isEnabled: false });
                console.log(`Disabled schedule ${schedule.id} due to missing/mismatched rule.`);
                return;
            }

            // 2. Clear any active timer for this rule
            // Note: db.updateManagedRuleTimer expects uuid and userId.
            const timerClearedChanges = await db.updateManagedRuleTimer({ 
                uuid: managedRule.opnsense_rule_uuid, 
                userId: schedule.user_id, 
                timerActiveUntil: null, 
                timerActionOnExpiry: null 
            });
            if (timerClearedChanges > 0) {
                console.log(`Cleared active timer for rule ${managedRule.opnsense_rule_uuid} due to scheduled action.`);
            }


            // 3. Perform action on OPNsense
            let opnsenseSuccess = false;
            if (schedule.action_to_perform === 'enable') {
                opnsenseSuccess = await opnsense.enableRule(managedRule.opnsense_rule_uuid);
            } else { // 'disable'
                opnsenseSuccess = await opnsense.disableRule(managedRule.opnsense_rule_uuid);
            }

            if (!opnsenseSuccess) {
                // Log failure but don't necessarily stop the job from trying next time,
                // unless OPNsense service itself reported a critical/permanent error.
                console.error(`OPNsense action failed for schedule ${schedule.id} on rule ${managedRule.opnsense_rule_uuid}.`);
                // Depending on error, might want to retry or disable schedule. For now, just log.
                return; // Don't update DB state if OPNsense failed
            }

            // 4. Update app's desired_state for the rule
            const desiredStateAfterAction = (schedule.action_to_perform === 'enable');
            await db.updateManagedRuleDesiredState({
                uuid: managedRule.opnsense_rule_uuid,
                userId: schedule.user_id,
                desiredState: desiredStateAfterAction
            });

            // 5. Optional: Update last_triggered_at for the schedule
            await db.updateScheduleLastTriggered(schedule.id);

            console.log(`Schedule ${schedule.id} executed successfully for rule ${managedRule.opnsense_rule_uuid}.`);
        } catch (error) {
            console.error(`Error executing schedule ${schedule.id} for rule ${schedule.opnsense_rule_uuid}:`, error);
        }
    }, {
        scheduled: true, // Default is true, job starts immediately based on cron.
        // timezone: process.env.SCHEDULE_DEFAULT_TIMEZONE || "Etc/UTC", // Example: "Europe/Berlin"
        // For simplicity, ensure cron expressions are in server's local time or UTC if server is UTC.
        // Using UTC for cron expressions is a good practice.
    });

    // job.start(); // Not needed if scheduled: true (default)
    activeJobs[schedule.id] = job;
    console.log(`schedulerService.scheduleJob: Scheduled job ${schedule.id} for rule ${schedule.opnsense_rule_uuid} (${schedule.action_to_perform} at ${schedule.cron_expression})`);
}

function unscheduleJob(scheduleId) {
    if (activeJobs[scheduleId]) {
        activeJobs[scheduleId].stop();
        delete activeJobs[scheduleId];
        console.log(`schedulerService.unscheduleJob: Unscheduled job for schedule ID ${scheduleId}.`);
    } else {
        console.log(`schedulerService.unscheduleJob: No active job found for schedule ID ${scheduleId} to unschedule.`);
    }
}

// Original loadAndScheduleAllActiveJobs was here, now removed to fix duplicate declaration.
// The version at the end of the file is more complete.

module.exports = {
    scheduleJob,
    unscheduleJob,
    loadAndScheduleAllActiveJobs,
    activeJobs, // Exporting for potential inspection/testing, not typically for direct manipulation
    startTimerProcessingJob // Export for explicit call if needed, though loadAndScheduleAllActiveJobs will call it
};

// --- Timer Processing Job ---
async function processExpiredRuleTimer(rule, opnsenseService) {
    console.log(`schedulerService: Processing expired timer for rule UUID ${rule.opnsense_rule_uuid}, user ${rule.user_id}, action on expiry: ${rule.timer_action_on_expiry}`);

    let opnsenseActionSuccess = false;
    let newDesiredState = rule.desired_state; // Default to current desired state

    try {
        if (rule.timer_action_on_expiry === 'enable') {
            opnsenseActionSuccess = await opnsenseService.enableRule(rule.opnsense_rule_uuid);
            if (opnsenseActionSuccess) newDesiredState = true;
        } else if (rule.timer_action_on_expiry === 'disable') {
            opnsenseActionSuccess = await opnsenseService.disableRule(rule.opnsense_rule_uuid);
            if (opnsenseActionSuccess) newDesiredState = false;
        } else {
            console.warn(`schedulerService: Invalid timer_action_on_expiry ('${rule.timer_action_on_expiry}') for rule ${rule.opnsense_rule_uuid}. Clearing timer without OPNsense action.`);
            opnsenseActionSuccess = true; // Allow timer fields to be cleared
        }

        if (opnsenseActionSuccess) {
            // Update app's desired_state for the rule
            await db.updateManagedRuleDesiredState({
                uuid: rule.opnsense_rule_uuid,
                userId: rule.user_id,
                desiredState: newDesiredState
            });

            // Clear timer fields in DB for this rule
            await db.updateManagedRuleTimer({
                uuid: rule.opnsense_rule_uuid,
                userId: rule.user_id,
                timerActiveUntil: null,
                timerActionOnExpiry: null
            });
            console.log(`schedulerService: Timer for rule ${rule.opnsense_rule_uuid} processed and cleared.`);
        } else {
            console.error(`schedulerService: OPNsense action failed for expired timer on rule ${rule.opnsense_rule_uuid}. Timer not cleared, will retry on next cycle.`);
            // Not clearing timer fields means it will be picked up again.
            // Consider a retry limit or specific error handling if OPNsense is persistently down.
        }
    } catch (error) {
        console.error(`schedulerService: Error processing expired timer for rule ${rule.opnsense_rule_uuid}:`, error);
        // Error during processing, timer remains.
    }
}


function startTimerProcessingJob() {
    const jobName = '__timerProcessor';
    if (activeJobs[jobName]) { 
        console.log(`schedulerService: Timer processing job '${jobName}' already exists. Stopping and recreating.`);
        activeJobs[jobName].stop();
        delete activeJobs[jobName];
    }

    // Check if OPNsense is configured before starting a job that might need it.
    // The job itself will also check, but this prevents scheduling if fundamentally not configured.
    const opnsenseServiceInstance = getOpnsenseService();
    if (!opnsenseServiceInstance) {
        console.warn("schedulerService: OPNsense not configured. Timer processing job that interacts with OPNsense will not be effective.");
        // Decide if job should run at all. If it only does DB cleanup, it might.
        // If it *must* interact with OPNsense, maybe don't schedule it.
        // For now, let it schedule, individual processing will fail if OPNsense is needed and unavailable.
    }

    const timerJob = nodeCron.schedule('* * * * *', async () => { // Every minute
        console.log('schedulerService: Checking for expired rule timers...');
        try {
            const expiredTimerRules = await db.getExpiredTimerRules(); // Ensure this fetches necessary fields like user_id, opnsense_rule_uuid

            if (expiredTimerRules.length > 0) {
                console.log(`schedulerService: Found ${expiredTimerRules.length} rule(s) with expired timer(s).`);
                const opnsenseForJob = getOpnsenseService(); // Get a fresh instance or use shared if thread-safe
                if (!opnsenseForJob) {
                    console.error("schedulerService: OPNsense service unavailable for processing expired timers. Will retry next minute.");
                    return; // Exit this run, will try again next minute
                }

                for (const rule of expiredTimerRules) {
                    await processExpiredRuleTimer(rule, opnsenseForJob);
                }
            } else {
                // console.log('schedulerService: No expired timers found on this check.'); // Can be noisy
            }
        } catch (error) {
            console.error('schedulerService: Error during expired timer check:', error);
        }
    });
    activeJobs[jobName] = timerJob;
    // timerJob.start(); // node-cron jobs start automatically by default
    console.log('schedulerService: Timer processing job started (runs every minute).');
}


async function loadAndScheduleAllActiveJobs() {
    console.log("schedulerService: Loading and scheduling all active jobs from database...");
    const opnsenseServiceCheck = getOpnsenseService(); // Check config once

    try {
        const activeSchedulesFromDB = await db.getAllActiveSchedules(); // This should join with ManagedRules
        console.log(`Found ${activeSchedulesFromDB.length} active OPNsense rule schedules in DB.`);
        
        // Clear any existing OPNsense rule jobs first (e.g., if app is restarting)
        // Exclude the __timerProcessor job from this clearing if it's managed separately
        for (const jobId in activeJobs) {
            if (jobId !== '__timerProcessor') {
                unscheduleJob(jobId);
            }
        }

        activeSchedulesFromDB.forEach(schedule => {
            if (!schedule.opnsense_rule_uuid) {
                console.error(`Schedule ID ${schedule.id} is missing opnsense_rule_uuid. Cannot schedule. Check DB integrity.`);
                return;
            }
            if (!opnsenseServiceCheck && schedule.action_to_perform !== 'none') { // 'none' action might be for internal app logic
                console.warn(`Skipping schedule ${schedule.id} for rule ${schedule.opnsense_rule_uuid} as OPNsense is not configured.`);
                return;
            }
            scheduleJob(schedule);
        });
        console.log(`schedulerService: Finished loading ${Object.keys(activeJobs).filter(j => j !== '__timerProcessor').length} OPNsense rule jobs.`);
    } catch (error) {
        console.error("schedulerService: Error loading active OPNsense rule jobs from database:", error);
    }

    // Ensure the timer processing job is also started/restarted
    startTimerProcessingJob(); 
}
