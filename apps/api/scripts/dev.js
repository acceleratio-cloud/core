// Nest CLI compiles to dist and then runs this script instead of `node dist/main`.
// tsc does not rewrite `@/*` path aliases, so rewrite them in the emitted files
// right before the app starts (works for both `nest start` and watch mode).
const { replaceTscAliasPaths } = require('tsc-alias');

replaceTscAliasPaths({ configFile: 'tsconfig.json' })
  .then(() => {
    require('../dist/main.js');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
