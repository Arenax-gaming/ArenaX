import { faker } from '@faker-js/faker';

/**
 * Automated Test Data Generation Utility
 */
export const DataFactory = {
  createUser: () => ({
    id: faker.string.uuid(),
    username: faker.internet.userName(),
    email: faker.internet.email(),
    stellarPublicKey: 'GC' + faker.string.alphanumeric(54).toUpperCase(),
  }),

  createTournament: (status: 'upcoming' | 'ongoing' | 'completed' = 'upcoming') => ({
    id: faker.string.uuid(),
    title: faker.company.catchPhrase() + ' Tournament',
    entryFee: faker.number.int({ min: 10, max: 100 }),
    status,
  }),
};

/**
 * Mock External Service Dependencies (Stellar SDK)
 */
export const StellarMock = {
  server: {
    loadAccount: jest.fn().mockResolvedValue({
      sequenceNumber: () => '12345',
      balances: [{ asset_type: 'native', balance: '100.00' }],
    }),
    submitTransaction: jest.fn().mockResolvedValue({
      hash: 'mock-tx-hash-' + faker.string.alphanumeric(10),
      successful: true,
    }),
  },
  Keypair: {
    random: () => ({
      publicKey: () => 'G' + faker.string.alphanumeric(55),
      secret: () => 'S' + faker.string.alphanumeric(55),
    }),
  },
};