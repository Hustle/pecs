const _ = require('lodash');
const program = require('commander');
const logger = require('winston');
const AWS = require('aws-sdk');

logger.cli();

const TAG_SEP = ':';

program
  .arguments('<services...>', 'Service(s) to deploy with this image')
  .option('-c --cluster <cluster>', 'Cluster to release on (defaults to "default" cluster)', 'default')
  .option('-t --tag <tag>', 'Tag to release (defaults to ":latest")', 'latest')
  .option('-r --region <region>', 'Region for cluster (defaults to "us-east-1"', 'us-east-1')
  .action((services, env) => {
    const cluster = env.cluster;
    console.log('Running Release');
    if (!services.length) {
      throw new Error('No services specified');
    }
    let newDefs;
    logger.info('releasing', { services, tag: env.tag });

    AWS.config.update({ region: env.region });
    const ecs = new AWS.ECS({ apiVersion: '2014-11-13' });
    ecs.describeServices({ cluster, services }).promise().then((result) => {
      // Get the current task definition for each service
      const getDefPromises = result.services.map((service) => {
        return ecs.describeTaskDefinition({ taskDefinition: service.taskDefinition }).promise();
      });

      return Promise.all(getDefPromises);
    }).then((taskDefs) => {
      // Update each task definition to use the specified image
      const newTaskDefs = taskDefs.map((def) => {
        const newDef = _.pick(def.taskDefinition, ['containerDefinitions', 'volumes', 'family']);

        // Only support one container per def for now
        const containerDefs = newDef.containerDefinitions;
        const container = containerDefs[0];
        const namespace = container.image.split(TAG_SEP)[0];
        container.image = `${namespace}${TAG_SEP}${env.tag}`;
        return newDef;
      });

      const registerDefPromises = newTaskDefs.map((def) => {
        return ecs.registerTaskDefinition(def).promise();
      });
      return Promise.all(registerDefPromises);
    }).then((registeredDefs) => {
      const updateServicePromises = registeredDefs.map((def, index) => {
        const taskDefArn = def.taskDefinition.taskDefinitionArn;
        return ecs.updateService({
          cluster: env.cluster,
          service: services[index],
          taskDefinition: taskDefArn
        }).promise();
      });

      return Promise.all(updateServicePromises);
    }).then((results) => {
      logger.info('waiting for services to stabilize...');
      return ecs.waitFor('servicesStable', { cluster, services }).promise();
    });
  })
  .parse(process.argv);
