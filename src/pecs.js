#!/usr/bin/env node
const Yargs = require('yargs');
const logger = require('winston');
const { deploy, rollback } = require('./actions');

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
  .command(
    'release', 'Update service(s) with new image',
    (yargs) => {
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
    }, wrap(deploy),
  )
  .command(
    'rollback', 'Roll back service(s)',
    (yargs) => {
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
    }, wrap(rollback),
  )
  .option('c', {
    alias: 'cluster',
    default: 'default',
    describe: 'Cluster to modify',
  })
  .option('s', {
    alias: 'services',
    type: 'array',
    default: [],
    describe: 'Services that should be modified',
  })
  .option('r', {
    alias: 'region',
    default: 'us-east-1',
    describe: 'Region for ECS cluster',
  })
  .argv;
