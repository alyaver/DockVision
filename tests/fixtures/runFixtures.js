const crypto = require('node:crypto');

const RUN_ID = 'run-poc-001';
const USER_ID = 'user-poc-001';

function makeRun(overrides = {}) {
  return {
    id: RUN_ID,
    runId: RUN_ID,
    userId: USER_ID,

    status: 'queued',

    createdAt: '2026-11-04T18:00:00.000Z',
    updatedAt: '2026-11-04T18:00:00.000Z',

    progress: {
      currentIteration: 1,
      totalIterations: 1,
      completedSteps: 0,
      totalSteps: 3,
      percent: 0,
    },

    iterations: [],

    ...overrides,
  };
}

const artifactBytes = Buffer.from(
  'DockVision fixture artifact\n',
  'utf8'
);

const artifactSha256 = crypto
  .createHash('sha256')
  .update(artifactBytes)
  .digest('hex');

module.exports = {
  RUN_ID,
  USER_ID,
  makeRun,
  artifactBytes,
  artifactSha256,
};