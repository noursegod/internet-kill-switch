// controllers/adminController.js
const db = require('../db/database'); // Assuming db functions are exported from here

async function listInvitations(req, res) {
    try {
        const invitations = await db.getAllInvitations();
        // For EJS rendering, pass data to the template
        // The actual rendering will happen in the route handler in adminRoutes.js
        // This controller function just prepares the data or handles logic.
        return invitations; 
    } catch (error) {
        console.error("Error in listInvitations controller:", error);
        // In a real app, you'd render an error page or pass an error message
        throw error; // Or handle error appropriately for the view
    }
}

async function generateInvitation(req, res) {
    try {
        const adminUserId = req.user.id; // Assumes isAuthenticated and isAdmin middleware have run
        const newCode = await db.createInvitationCode({ adminUserId });
        // For EJS, the route handler will typically redirect or re-render
        // This function's main job is the DB interaction.
        return { success: true, code: newCode, message: `Invitation code ${newCode} created successfully.` };
    } catch (error) {
        console.error("Error in generateInvitation controller:", error);
        return { success: false, message: "Failed to create invitation code." };
    }
}

module.exports = {
    listInvitations,
    generateInvitation
};
