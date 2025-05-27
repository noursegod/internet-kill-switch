const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

// List of EJS files to test for compilability
const filesToTest = [
    'views/login.ejs',
    'views/admin_invitations.ejs',
    'views/admin_settings.ejs',
    'views/index.ejs',
    'views/layout.ejs',
    'views/register.ejs',
    'views/rules.ejs',
    'views/schedules.ejs',
    'views/setup.ejs',
    'views/partials/_navbar.ejs',
    'views/partials/_flash_messages.ejs',
    'views/partials/_config_status.ejs',
    'views/partials/_footer.ejs'
];

describe('EJS Template Compilation Tests', () => {
    filesToTest.forEach(filePath => {
        it(`should compile ${filePath} without syntax errors`, () => {
            const templatePath = path.join(__dirname, '..', filePath); // Adjust path to be relative to project root
            const templateContent = fs.readFileSync(templatePath, 'utf-8');
            
            // Attempt to compile the template
            // If there's a syntax error, ejs.compile will throw an exception
            expect(() => {
                ejs.compile(templateContent, { client: true, filename: templatePath });
            }).not.toThrow();
        });
    });
});
