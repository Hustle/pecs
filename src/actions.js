const _ = require('lodash');
const AWS = require('aws-sdk');
const logger = require('winston');

const TAG_SEP = ':';

// Fetches list of all service names if none are provided
async function getServices(ecs, cluster, services) {
  if (!services.length) {
    const list = await ecs.listServices({ cluster, maxResults: 10 }).promise();
    const serviceNames = list.serviceArns.map(s => s.split('/')[1]);
    services.push(...serviceNames);
  }
  return services;
}

// Updates task definition to specify image with provided tag
function makeUpdatedDef(def, imageTag) {
  // Keep only the important bits -- the api complains if we don't
  const newDef = _.pick(def.taskDefinition, [
    'containerDefinitions',
    'volumes',
    'family',
  ]);

  // Only support one container per def for now
  const containerDefs = newDef.containerDefinitions;
  const container = containerDefs[0];
  const namespace = container.image.split(TAG_SEP)[0];
  container.image = `${namespace}${TAG_SEP}${imageTag}`;
  return newDef;
}

// Deploys a service or set of services by running a new image
async function deploy(args) {
  const {
    region,
    cluster,
    services,
    tag,
  } = args;

  logger.info('requested release', { cluster, services, tag });

  AWS.config.update({ region });
  const ecs = new AWS.ECS({ apiVersion: '2014-11-13' });

  const serviceNames = await getServices(ecs, cluster, services);
  logger.info('targeting services', services);
  const descriptions = await ecs.describeServices({ cluster, services: serviceNames }).promise();

  // Get the current task definition for each service
  const getDefPromises = descriptions.services.map((service) => {
    const { taskDefinition } = service;
    logger.debug('current task def', { taskDefinition });
    return ecs.describeTaskDefinition({ taskDefinition }).promise();
  });
  const taskDefs = await Promise.all(getDefPromises);

  // Make and register new definitions
  const newTaskDefs = taskDefs.map(def => makeUpdatedDef(def, tag));
  const registerDefPromises = newTaskDefs.map((def) => {
    return ecs.registerTaskDefinition(def).promise();
  });
  const registeredDefs = await Promise.all(registerDefPromises);

  // Instruct services to use the new task definitions
  const updateServicePromises = registeredDefs.map((def, index) => {
    const taskDefArn = def.taskDefinition.taskDefinitionArn;
    return ecs.updateService({
      cluster,
      service: services[index],
      taskDefinition: taskDefArn,
    }).promise();
  });

  // Update services
  await Promise.all(updateServicePromises);
  logger.info('waiting for services to stabilize...');

  // Wait for rollout
  await ecs.waitFor('servicesStable', { cluster, services }).promise();
  logger.info('successfully released');
}

module.exports = {
  deploy,
};
