module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/packages/core/tests/**/*.test.ts'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  transformIgnorePatterns: [],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
