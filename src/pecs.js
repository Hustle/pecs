#!/usr/bin/env node
const program = require('commander');
const winston = require('winston');
const { version } = require('../package.json');

winston.cli();

program
  .version(version)
  .command('pecs')
  .command('release', 'release an image')
  // .command('rollback <relative_releases_ago>', 'rollback to a previous release')
  .parse(process.argv);
