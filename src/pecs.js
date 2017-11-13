#!/usr/bin/env node
const Yargs = require('yargs');
const logger = require('winston');
const { deploy, rollback, configure } = require('./actions');

logger.level = process.env.LOG_LEVEL || 'info';
logger.cli();


// Wraps an action so that we can handle errors, etc...
function wrap(fn) {
  return function wrapper(params) {
    fn(params).catch((error) => { logger.error(error); });
  };
}

/**
 * Updates services on ECS to use a new docker image.
 *
 * If multiple services in a cluster depend on the same image, this tool
 * can be used to update all of them simultaneously.
 */

// eslint-disable-next-line no-unused-expressions
Yargs
  .usage('$0 <command>')
  .required(1, 'Pecs requires a command!')
  .pkgConf('ecs')
  .command('release', 'Update service(s) with new image', (yargs) => {
    yargs
      .group(['cluster', 'services', 'tag'], 'Common args:')
      .example('$0 release -c dev -s api', 'update dev api service')
      .example('$0 release -c dev -s api worker', 'update dev api + worker services')
      .example('$0 release -c dev -s api -t v1.2.3', 'update dev api to v1.2.3')
      .option('t', {
        alias: 'tag',
        default: 'latest',
        describe: 'Image tag that should be released',
      });
  }, wrap(deploy))
  .command('rollback', 'Roll back service(s)', (yargs) => {
    yargs
      .group(['cluster', 'services', 'rev'], 'Common args:')
      .example('$0 rollback -c dev -s api', 'roll back api to previous task def')
      .example('$0 rollback -c dev -s api worker', 'roll back api + worker')
      .example('$0 rollback -c dev -s api --rev -2', 'roll back api 2 release ago')
      .option('rev', {
        type: 'number',
        default: '-1',
        describe: 'Desired relative revision to release',
      });
  }, wrap(rollback))
  .command('bump', 'Rolling restart a service across a cluster', (yargs) => {
    yargs
      .group(['cluster', 'services'], 'Common args:')
      .example('$0 config -c dev', 'restart all development containers')
      .example('$0 config -c dev -s api', 'restart development api containers');
  }, wrap(deploy))
  .command('config [get|set|unset]', 'View or modify service environments', (yargs) => {
    yargs
      .group(['cluster', 'services'], 'Common args:')
      .example('$0 config -c dev', 'get all dev cluster env vars')
      .command('get <key>', 'Get environment variable for a service', (subyargs) => {
        subyargs
          .group(['cluster', 'services'], 'Common args:')
          .example('$0 config get DEBUG -c dev -s api', 'get development api env var DEBUG');
      }, wrap(configure))
      .command('set <key> <val>', 'Set environment variable for a service', (subyargs) => {
        subyargs
          .group(['cluster', 'services'], 'Common args:')
          .example('$0 config set DEBUG true -c dev -s api', 'set dev api env var DEBUG to "true"');
      }, wrap(configure))
      .command('unset <key>', 'Unset environment variable for a service', (subyargs) => {
        subyargs
          .group(['cluster', 'services'], 'Common args:')
          .example('$0 config unset DEBUG -c dev -s api', 'unset dev api env var DEBUG');
      }, wrap(configure));
  }, wrap(configure))
  .option('c', {
    alias: 'cluster',
    default: 'default',
    describe: 'Cluster to target',
  })
  .option('s', {
    alias: 'services',
    type: 'array',
    default: [],
    describe: 'Services that should be targeted',
  })
  .option('r', {
    alias: 'region',
    default: 'us-east-1',
    describe: 'Region for ECS cluster',
  })
  .argv;
