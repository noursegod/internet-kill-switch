// controllers/ruleController.js
const ruleRepository = require('../db/database.js'); // Using db/database.js for now

// --- ManagedRule Controllers ---

async function getManagedRules(req, res) {
    // Assuming userId will be available from session/authentication middleware later
    // For now, if testing directly, you might pass it via query or have a default
    const userId = req.user ? req.user.id : null; // Placeholder for actual user auth
    if (!userId) {
        // This response will likely be JSON in a real API context
        return res.status(401).json({ error: "User not authenticated." });
    }
    try {
        const rules = await ruleRepository.getAllManagedRulesForUser({ userId });
        // In a real scenario, this would render a view or return JSON
        // For now, let's assume it might be called internally or for API
        return rules; // Or res.json(rules);
    } catch (error) {
        console.error("Error in getManagedRules controller:", error);
        // return res.status(500).json({ error: "Failed to retrieve managed rules." });
        throw error; // Re-throw for now if called internally
    }
}

async function addRule(req, res) {
    const userId = req.user ? req.user.id : null;
    const { ruleUuid, description, desiredState } = req.body; // Assuming body parsing middleware

    if (!userId) return res.status(401).json({ error: "User not authenticated." });
    if (!ruleUuid) return res.status(400).json({ error: "Rule UUID is required." });

    try {
        const newRule = await ruleRepository.addManagedRule({ 
            uuid: ruleUuid, 
            description, 
            userId, 
            desiredState: desiredState || false 
        });
        return res.status(201).json(newRule);
    } catch (error) {
        console.error("Error in addRule controller:", error);
        if (error.message.includes("already managed")) {
            return res.status(409).json({ error: error.message });
        }
        return res.status(500).json({ error: "Failed to add managed rule." });
    }
}

async function removeRule(req, res) {
    const userId = req.user ? req.user.id : null;
    const { ruleUuid } = req.params; // Assuming ruleUuid is part of the route path, e.g., /rules/:ruleUuid

    if (!userId) return res.status(401).json({ error: "User not authenticated." });
    if (!ruleUuid) return res.status(400).json({ error: "Rule UUID is required." });

    try {
        const changes = await ruleRepository.removeManagedRule({ uuid: ruleUuid, userId });
        if (changes > 0) {
            return res.status(200).json({ message: "Rule removed successfully." });
        }
        return res.status(404).json({ error: "Rule not found or not managed by this user." });
    } catch (error) {
        console.error("Error in removeRule controller:", error);
        return res.status(500).json({ error: "Failed to remove managed rule." });
    }
}

// Placeholder for other controller functions that might be needed:
// async function updateRuleState(req, res) { ... }
// async function setRuleTimer(req, res) { ... }
// async function clearRuleTimer(req, res) { ... }


module.exports = { 
    getManagedRules, // Example for internal call or future API
    addRule,         // Example for API
    removeRule       // Example for API
    // ... other exported controller functions
};

// Note: These controller functions are designed more for an API context.
// For server-side rendered HTML pages, the logic would be similar but would
// end with `res.render('template_name', { data })` instead of `res.json()`.
// The current subtask focuses on the DB functions, so these are basic wrappers.
