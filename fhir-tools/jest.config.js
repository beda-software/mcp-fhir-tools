export default {
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  // Source files use explicit ".js" extensions in relative imports (required for NodeNext ESM
  // at runtime); strip them so ts-jest resolves back to the ".ts" sources.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testEnvironment: "node",
};
