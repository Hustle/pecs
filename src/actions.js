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

// Returns a configured ECS client
function getECS(region) {
  AWS.config.update({ region });
  return new AWS.ECS({ apiVersion: '2014-11-13' });
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

// Updates services on a cluster to run new arns
async function updateServices(ecs, cluster, services, arns) {
  // Instruct services to use the new task definitions
  const updateServicePromises = arns.map((taskDefArn, index) => {
    const service = services[index];
    logger.info(`updating ${cluster}:${service} with ARN ${taskDefArn}`);
    return ecs.updateService({
      cluster,
      service,
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

// Deploys a service or set of services by running a new image
async function deploy(args) {
  const {
    region,
    cluster,
    services,
    tag,
  } = args;

  logger.info('requested release', { cluster, services, tag });
  const ecs = getECS(region);

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

  const newArns = registeredDefs.map(def => def.taskDefinition.taskDefinitionArn);
  updateServices(ecs, cluster, services, newArns);
}

async function rollback(args) {
  const {
    region,
    cluster,
    services,
    rev,
  } = args;

  logger.info('requested rollback', { cluster, services, rev });
  const ecs = getECS(region);

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

  const previousDefArns = taskDefs.map((def) => {
    const taskDef = def.taskDefinition;
    const { family } = taskDef;
    const relativeRev = (rev || -1);

    if (relativeRev >= 0) {
      throw new Error('Relative revision must be a negative number');
    }

    const taskDefBase = taskDef.taskDefinitionArn.split(`/${family}:`)[0];
    const taskDefRev = taskDef.revision + relativeRev;
    const previousArn = `${taskDefBase}/${family}:${taskDefRev}`;
    return previousArn;
  });

  // TODO: ensure that all of the previous task definition revisions use
  // the same docker image

  updateServices(ecs, cluster, services, previousDefArns);
}

module.exports = {
  deploy,
  rollback,
};
