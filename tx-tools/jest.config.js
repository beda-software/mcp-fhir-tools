export default {
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  // Source files use explicit ".js" extensions in relative imports (required for NodeNext ESM
  // at runtime); strip them so ts-jest resolves back to the ".ts" sources.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testEnvironment: "node",
};
