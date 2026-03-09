if (!process.env.IGLOO_HOME_RUN_DESKTOP_TESTS) {
  console.log('igloo-home desktop tests skipped (set IGLOO_HOME_RUN_DESKTOP_TESTS=1 to enable)');
  process.exit(0);
}

console.error('igloo-home desktop smoke harness is not wired into the default npm test path yet');
process.exit(1);
