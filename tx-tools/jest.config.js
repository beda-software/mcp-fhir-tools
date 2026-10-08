export default {
  transform: {
    // In CommonJS mode ts-jest hits TS2589 on the SDK's tool-registration types; tsc does not.
    "^.+\\.tsx?$": ["ts-jest", { diagnostics: { ignoreCodes: [2589] } }],
  },
  // Source files use explicit ".js" extensions in relative imports (required for NodeNext ESM
  // at runtime); strip them so ts-jest resolves back to the ".ts" sources.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testEnvironment: "node",
};
