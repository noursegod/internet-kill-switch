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

describe('EJS Layout Rendering Test', () => {
    it('should render layout.ejs with mock data without errors', () => {
        const layoutPath = path.join(__dirname, '..', 'views/layout.ejs');
        const layoutContent = fs.readFileSync(layoutPath, 'utf-8');
        
        const mockLayoutData = {
            body: '<div>Mocked page body content for layout test</div>',
            pageTitle: 'Mock Page Title for Layout',
            user: { displayName: 'Test User', email: 'test@example.com', is_admin: false }, // Added is_admin for _navbar
            currentPath: '/mock-path',
            is_app_secret_key_configured: true,
            is_opnsense_fully_configured: true,
            is_google_oauth_configured: true,
            queryMessages: { message: 'Test query message' }, // This is now a global, but layout/partials might still check for it if not properly removed from their logic
            sessionFlashMessages: { type: 'success', message: 'Test session flash' },
            // For _config_status.ejs, these are expected to be boolean
            // and they are already provided above.
            
            // For _flash_messages.ejs, it checks for sessionFlashMessages.type and sessionFlashMessages.message
            // and also queryMessages.error, queryMessages.success, queryMessages.info
            // The current mockLayoutData covers sessionFlashMessages.
            // queryMessages.message is covered. Let's ensure error/success/info are also handled or not expected.
            // The provided mock queryMessages has a 'message' field.
            // If _flash_messages directly accesses queryMessages.error etc., they might need to be in mockLayoutData.
            // Given the current structure, res.locals.queryMessages is expected.
            // The test will tell if specific sub-fields of queryMessages are needed by _flash_messages if not handled by the global.
        };

        let renderedHtml = '';
        expect(() => {
            // Pass res.locals structure expected by partials if they are not getting it from a global context in test
            // For this test, mockLayoutData itself serves as the data object for ejs.render.
            // If partials directly access res.locals.someValue, then mockLayoutData needs to have 'someValue'.
            renderedHtml = ejs.render(layoutContent, mockLayoutData, { filename: layoutPath });
        }).not.toThrow();

        // Optional: Check if body and title are in the rendered output
        expect(renderedHtml).toContain('<div>Mocked page body content for layout test</div>');
        expect(renderedHtml).toContain('<title>Mock Page Title for Layout</title>');
        // Optional: Check for content from a partial, if easy
        expect(renderedHtml).toContain('Test User'); // Assuming navbar shows user.displayName
        expect(renderedHtml).toContain('Test session flash'); // From _flash_messages
        // Using regex for _config_status.ejs to be more robust against whitespace variations:
        expect(renderedHtml).toMatch(/OPNsense API:\s*<span style="color: green;">Configured<\/span>/);
    });
});
