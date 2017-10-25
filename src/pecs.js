#!/usr/bin/env node
const program = require('commander');
const winston = require('winston');
const { version } = require('../package.json');

winston.cli();

program
  .version(version)
  .command('pecs')
  // .command('build', 'build this project')
  // .command('push', 'push the built image for this project')
  .command('release', 'release an image')
  .command('rollback <relative_releases_ago>', 'rollback to a previous release')
  // .command('deploy', 'build, push, and release this project')
  .parse(process.argv);
