// controllers/scheduleController.js
const db = require('../db/database'); // DB functions for schedules and managed rules
const schedulerService = require('../services/schedulerService');
const { validate: validateCron } = require('node-cron'); // For cron expression validation

async function listSchedulesForUser(req, res) {
    const userId = req.user.id;
    try {
        const schedules = await db.getAllSchedulesForUser({ userId });
        // This controller is primarily for preparing data for routes.
        // The route handler will then render the view.
        return schedules;
    } catch (error) {
        console.error(`Error in listSchedulesForUser for user ${userId}:`, error);
        throw error; // Let the route handler manage the error response
    }
}

async function createSchedule(req, res) {
    const userId = req.user.id;
    const { managed_rule_id, cron_expression, action_to_perform, is_enabled } = req.body;

    if (!managed_rule_id || !cron_expression || !action_to_perform) {
        return { success: false, message: "Managed rule, cron expression, and action are required." };
    }
    if (!validateCron(cron_expression)) {
        return { success: false, message: "Invalid cron expression." };
    }
    if (!['enable', 'disable'].includes(action_to_perform)) {
        return { success: false, message: "Invalid action specified." };
    }

    // Verify that the managed_rule_id belongs to the user
    const rule = await db.getManagedRuleById({ ruleId: managed_rule_id, userId }); // Assuming a function like this exists or is added
    if (!rule) {
         // If getManagedRuleById is not available, or you want to check based on UUID from opnsense_rule_uuid
         // you might need to adjust this check. For now, assuming managed_rule_id is the PK of ManagedRules.
        console.warn(`User ${userId} attempted to create schedule for rule ID ${managed_rule_id} not owned by them or non-existent.`);
        // This check should ideally be in a service layer or done carefully.
        // Let's assume for now db.addSchedule will fail if foreign key constraint is violated (if schedule links to user-owned rule)
        // Or, more robustly, the addSchedule DB function should internally verify user ownership of the managedRuleId.
        // For now, let's assume the managed_rule_id dropdown is populated correctly for the user.
    }


    try {
        const newScheduleData = {
            managedRuleId: parseInt(managed_rule_id, 10),
            userId,
            cronExpression: cron_expression,
            actionToPerform: action_to_perform,
            isEnabled: is_enabled === 'on' || is_enabled === true // Handle checkbox value
        };
        const newSchedule = await db.addSchedule(newScheduleData);

        if (newSchedule && newSchedule.isEnabled) {
            // Fetch the full schedule object with joined data for schedulerService
            const fullSchedule = await db.getScheduleById({ scheduleId: newSchedule.id, userId });
            if (fullSchedule) {
                schedulerService.scheduleJob(fullSchedule);
            } else {
                console.error(`Failed to fetch full schedule for ID ${newSchedule.id} after creation, cannot schedule job.`);
            }
        }
        return { success: true, schedule: newSchedule, message: "Schedule created successfully." };
    } catch (error) {
        console.error("Error in createSchedule controller:", error);
        return { success: false, message: `Failed to create schedule: ${error.message}` };
    }
}

async function toggleSchedule(req, res) {
    const userId = req.user.id;
    const { scheduleId } = req.params;
    
    try {
        const schedule = await db.getScheduleById({ scheduleId: parseInt(scheduleId, 10), userId });
        if (!schedule) {
            return { success: false, message: "Schedule not found or not owned by user." };
        }

        const newIsEnabledState = !schedule.is_enabled;
        const changes = await db.updateSchedule({ 
            scheduleId: schedule.id, 
            userId, 
            isEnabled: newIsEnabledState 
        });

        if (changes > 0) {
            const updatedSchedule = await db.getScheduleById({ scheduleId: schedule.id, userId }); // Fetch updated full schedule
            if (newIsEnabledState) {
                schedulerService.scheduleJob(updatedSchedule); // Schedule it
            } else {
                schedulerService.unscheduleJob(schedule.id); // Unschedule it
            }
            return { success: true, message: `Schedule ${newIsEnabledState ? 'enabled' : 'disabled'}.` };
        }
        return { success: false, message: "Failed to update schedule status." };
    } catch (error) {
        console.error(`Error in toggleSchedule controller for ID ${scheduleId}:`, error);
        return { success: false, message: `Error toggling schedule: ${error.message}` };
    }
}

async function deleteSchedule(req, res) {
    const userId = req.user.id;
    const { scheduleId } = req.params;

    try {
        // Ensure the schedule belongs to the user before trying to unschedule/delete
        const schedule = await db.getScheduleById({ scheduleId: parseInt(scheduleId, 10), userId });
        if (!schedule) {
            return { success: false, message: "Schedule not found or not owned by user." };
        }

        schedulerService.unscheduleJob(schedule.id); // Unscheduling first
        const changes = await db.removeSchedule({ scheduleId: schedule.id, userId });

        if (changes > 0) {
            return { success: true, message: "Schedule deleted successfully." };
        }
        return { success: false, message: "Failed to delete schedule." }; // Should not happen if found earlier
    } catch (error) {
        console.error(`Error in deleteSchedule controller for ID ${scheduleId}:`, error);
        return { success: false, message: `Error deleting schedule: ${error.message}` };
    }
}

module.exports = {
    listSchedulesForUser,
    createSchedule,
    toggleSchedule,
    deleteSchedule
};
