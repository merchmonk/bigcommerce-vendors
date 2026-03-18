module.exports = {
  roots: ['<rootDir>/test'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '@components/(.*)': '<rootDir>/components/$1',
    '@lib/(.*)': '<rootDir>/lib/$1',
    '@mocks/(.*)': '<rootDir>/test/mocks/$1',
    '@pages/(.*)': '<rootDir>/pages/$1',
    '@test/utils': '<rootDir>/test/utils',
    '@types': '<rootDir>/types',
  },
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', { presets: ['next/babel'] }],
  },
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  watchPathIgnorePatterns: ['<rootDir>/.next/'],
  watchman: false,
  cacheDirectory: '<rootDir>/.cache/jest',
  clearMocks: true,
  coverageDirectory: '<rootDir>/coverage',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
};
