#!/usr/bin/env node

require('babel-core/register');
require('babel-polyfill');

const Yargs = require('yargs');
const logger = require('winston');
const {
  clusters,
  services,
  deploy,
  rollback,
  configure,
  updateAgents,
} = require('./actions');

process.on('unhandledRejection', (e) => {
  console.error(e);
  process.exit(1);
});

logger.level = process.env.LOG_LEVEL || 'info';
logger.cli();


// Wraps an action so that we can handle errors, etc...
function wrap(fn) {
  return function wrapper(params) {
    fn(params).catch((error) => {
      logger.error(error);
      process.exit(1);
    });
  };
}

// eslint-disable-next-line no-unused-expressions
Yargs
  .usage('$0 <command>')
  .required(1, 'Pecs requires a command!')
  .epilog('This dope tool is brought to you by Hustle, Inc.')
  .pkgConf('ecs')
  .command('clusters', 'Get list of clusters', (yargs) => {
    yargs
      .example('$0 clusters', 'get all ecs clusters in the default region')
      .example('$0 clusters -r us-west-1', 'get all ecs clusters in the us-west-1 region');
  }, wrap(clusters))
  .command('services', 'Get list of services in a cluster', (yargs) => {
    yargs
      .group(['cluster'], 'Common args:')
      .example('$0 services', 'get all ecs clusters in the default region')
      .example('$0 services -c dev', 'get all services for dev cluster');
  }, wrap(services))
  .command('updateAgents', 'Update all ECS agents in a cluster', (yargs) => {
    yargs
      .group(['cluster'], 'Common args:')
      .example('$0 updateAgents -c dev', 'update all ECS agents in dev cluster');
  }, wrap(updateAgents))
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
          .example('$0 config set DEBUG true -c dev -s api', 'set dev api env var DEBUG to "true"')
          .coerce('val', val => `${val}`);
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
