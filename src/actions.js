const _ = require('lodash');
const AWS = require('aws-sdk');
const logger = require('winston');

const TAG_SEP = ':';

function getServices(ecs, cluster, services) {
  if (!services.length) {
    return ecs.listServices({ cluster, maxResults: 10 })
      .promise()
      .then((result) => {
        const serviceNames = result.serviceArns.map(s => s.split('/')[1]);
        services.push(...serviceNames);
        return (services);
      });
  }
  return Promise.resolve(services);
}

function deploy(args) {
  const {
    region,
    cluster,
    services,
    tag,
  } = args;

  logger.info('requested release', { cluster, services, tag });

  AWS.config.update({ region });
  const ecs = new AWS.ECS({ apiVersion: '2014-11-13' });

  return getServices(ecs, cluster, services)
    .then(() => {
      logger.info('targeting services', services);
      return ecs.describeServices({ cluster, services }).promise();
    })
    .then((result) => {
      // Get the current task definition for each service
      const getDefPromises = result.services.map((service) => {
        const { taskDefinition } = service;
        logger.debug('current task def', { taskDefinition });
        return ecs.describeTaskDefinition({ taskDefinition }).promise();
      });

      return Promise.all(getDefPromises);
    })
    .then((taskDefs) => {
      // Update each task definition to use the specified image with provided tag
      const newTaskDefs = taskDefs.map((def) => {
        const newDef = _.pick(def.taskDefinition, [
          'containerDefinitions',
          'volumes',
          'family',
        ]);

        // Only support one container per def for now
        const containerDefs = newDef.containerDefinitions;
        const container = containerDefs[0];
        const namespace = container.image.split(TAG_SEP)[0];
        container.image = `${namespace}${TAG_SEP}${tag}`;
        return newDef;
      });

      const registerDefPromises = newTaskDefs.map((def) => {
        return ecs.registerTaskDefinition(def).promise();
      });
      return Promise.all(registerDefPromises);
    })
    .then((registeredDefs) => {
      const updateServicePromises = registeredDefs.map((def, index) => {
        const taskDefArn = def.taskDefinition.taskDefinitionArn;
        return ecs.updateService({
          cluster,
          service: services[index],
          taskDefinition: taskDefArn,
        }).promise();
      });

      return Promise.all(updateServicePromises);
    })
    .then(() => {
      logger.info('waiting for services to stabilize...');
      return ecs.waitFor('servicesStable', { cluster, services }).promise();
    })
    .then(() => {
      logger.info('successfully released');
    });
}

module.exports = {
  deploy,
};
