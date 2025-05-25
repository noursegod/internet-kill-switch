module.exports = {
    testEnvironment: 'node', // Specifies the environment Jest will run tests in
    verbose: true, // Indicates whether each individual test should be reported during the run
    
    // Automatically clear mock calls, instances, contexts and results before every test
    clearMocks: true,

    // The directory where Jest should output its coverage files
    coverageDirectory: "coverage",

    // An array of glob patterns indicating a set of files for which coverage information should be collected
    collectCoverageFrom: [
        '**/*.js', // Collect from all JS files
        '!**/node_modules/**',
        '!**/tests/**',      // Exclude test files themselves
        '!**/coverage/**',
        '!jest.config.js', // Exclude jest config
        '!app.js',         // Often app.js is mostly setup, can be excluded if not much logic
        // Add other files/patterns to ignore here, e.g., specific config files
        // '!db/database.js', // If DB setup is complex and tested via its functions
    ],

    // A list of paths to directories that Jest should use to search for files in
    // roots: [
    //   "<rootDir>" // Default: project root
    // ],

    // The testMatch patterns Jest uses to detect test files
    testMatch: [
      "**/tests/**/*.test.js", // Standard pattern: .test.js suffix in any tests subfolder
      "**/__tests__/**/*.js"   // Another common pattern
    ],

    // An array of regexp pattern strings that are matched against all test paths, matched tests are skipped
    // testPathIgnorePatterns: [
    //   "/node_modules/"
    // ],

    // A map from regular expressions to paths to transformers
    // transform: {},

    // Indicates whether the coverage information should be collected while executing the test
    collectCoverage: true, // Set to true to collect coverage

    // An array of regexp pattern strings that are matched against all source file paths, matched files will skip transformation
    // transformIgnorePatterns: [
    //   "/node_modules/",
    //   "\\.pnp\\.[^\\/]+$"
    // ],

    // A list of reporter names that Jest uses when writing coverage reports
    coverageReporters: [
      "json",
      "text", // For console output
      "lcov", // For lcov.info file, often used by CI/coveralls
      "clover"
    ],
    
    // Global setup file path (optional)
    // setupFilesAfterEnv: ['./tests/setup.js'], // If you need global setup like jest-extended

    // ModuleNameMapper can be useful for mocking assets or aliasing paths
    // moduleNameMapper: {
    //   "\\.(css|less|scss|sass)$": "identity-obj-proxy" // Example: mock CSS imports
    // },
};
