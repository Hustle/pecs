const _ = require('lodash');
const AWS = require('aws-sdk');
const logger = require('winston');
const prompt = require('prompt-base');
const prettyjson = require('prettyjson');

const TAG_SEP = ':';
const PATH_SEP = '/';
const MONITOR_UPDATE_TIME_MS = 3 * 1000; // 3 Seconds
const WRITABLE_TASK_DEF_PARAMS = [
  'containerDefinitions',
  'family',
  'placementConstraints',
  'volumes',
  'taskRoleArn',
];

// ECS resource ARN format:
// arn:aws:ecs:<region>:<account>:<resource_type>/<resource_name>
function extractNameFromARN(arn) {
  return arn.split(PATH_SEP)[1];
}

// Fetches list of all service names if none are provided
async function getServices(ecs, cluster, services) {
  if (!services.length) {
    // TODO: use listServices call here to reduce code duplication
    const list = await ecs.listServices({ cluster }).promise();
    const serviceNames = list.serviceArns.map(extractNameFromARN);
    services.push(...serviceNames);
  }
  return services;
}

// Get the current task definition for each service
async function getTaskDefs(ecs, cluster, descriptions) {
  const getDefPromises = descriptions.services.map((service) => {
    const { taskDefinition } = service;
    logger.debug('current task def', { taskDefinition });
    return ecs.describeTaskDefinition({ taskDefinition }).promise();
  });
  return Promise.all(getDefPromises);
}

async function showPrompt(reason, force = false) {
  if (!force) {
    // prompt user for deploy
    const answer = await prompt(`Are you sure you want to continue with the ${reason}? [Y/n]`).run();
    if (!['Y', 'y', 'Yes', 'yes'].includes(answer)) {
      logger.info(`aborting ${reason}.`);
      process.exit();
    }
  }
}


// Returns a configured ECS client
function getECS(region) {
  AWS.config.update({ region });
  return new AWS.ECS({ apiVersion: '2014-11-13' });
}

// Updates task definition to specify image with provided tag
function makeUpdatedDef(def, imageTag, env) {
  // Keep only the important bits -- the api complains if we don't
  const newDef = _.pick(def.taskDefinition, WRITABLE_TASK_DEF_PARAMS);

  if (imageTag) {
    // Only support one container per def for now
    const containerDefs = newDef.containerDefinitions;
    const container = containerDefs[0];
    const namespace = container.image.split(TAG_SEP)[0];
    container.image = `${namespace}${TAG_SEP}${imageTag}`;
  }

  if (env) {
    const containerDefs = newDef.containerDefinitions;
    const container = containerDefs[0];
    container.environment = env;
  }

  return newDef;
}

// Registers an array of task definitions
async function registerDefs(ecs, newTaskDefs) {
  const registerDefPromises = newTaskDefs.map((def) => {
    return ecs.registerTaskDefinition(def).promise();
  });
  return Promise.all(registerDefPromises);
}

// Repeatedly describe services to monitor a deployment
function checkDeploy(args) {
  // eslint-disable-next-line object-curly-newline
  const { ecs, cluster, services, arns, resolve } = args;

  let done = true;
  ecs.describeServices({ cluster, services }).promise().then((description) => {
    const serviceMap = _.keyBy(description.services, 'serviceName');
    services.forEach((serviceName, index) => {
      // TODO: optimize this by using a map instead of multiple finds
      const serviceDesc = serviceMap[serviceName];
      const taskDefArn = arns[index];
      const deployment = serviceDesc.deployments.find(d => d.taskDefinition === taskDefArn);
      const { desiredCount, pendingCount, runningCount } = deployment;

      // Print info about the deployment
      logger.info({
        serviceName,
        desiredCount,
        pendingCount,
        runningCount,
      });
      if (runningCount !== desiredCount) {
        done = false;
      }
    });

    // If not all of the services have been rolled out, schedule another status update
    if (done) {
      resolve();
    } else {
      setTimeout(checkDeploy, MONITOR_UPDATE_TIME_MS, args);
    }
  });
}

async function monitorRollout(ecs, cluster, services, arns) {
  return new Promise((resolve) => {
    // eslint-disable-next-line object-curly-newline
    checkDeploy({ ecs, cluster, services, arns, resolve });
  });
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

  // Wait for and display progress of rollout
  await monitorRollout(ecs, cluster, services, arns);

  // Ensure sevices have stabilized
  await ecs.waitFor('servicesStable', { cluster, services }).promise();

  // Done
  logger.info('successfully updated the services');
}

// Gets list of clusters (scoped to region)
async function listClusters(args) {
  const { region } = args;
  const ecs = getECS(region);
  const clusterNames = [];
  const nextToken = null;

  // TODO: extract this pattern into a helper function
  do {
    const result = await ecs.listClusters({ cluster, nextToken }).promise();
    clusterNames.push(...result.clusterArns.map(extractNameFromARN));
    nextToken = result.nextToken;
  } while (nextToken);

  // eslint-disable-next-line no-console
  console.log(prettyjson.render(clusterNames));
}

// Gets list of services for ECS cluster (scoped to cluster)
async function listServices(args) {
  const { region, cluster } = args;
  const ecs = getECS(region);
  const serviceNames = [];
  let nextToken = null;

  // TODO: extract this pattern into a helper function
  do {
    const result = await ecs.listServices({ cluster, nextToken }).promise();
    serviceNames.push(...result.serviceArns.map(extractNameFromARN));
    nextToken = result.nextToken;
  } while (nextToken);

  // eslint-disable-next-line no-console
  console.log(prettyjson.render(serviceNames));
}

// Updates all ECS agents in a cluster
// TODO: listContainerInstances can take a filter param to scope this to a single instance
async function updateAgents(args) {
  const { region, cluster } = args;
  const ecs = getECS(region);
  const results = await ecs.listContainerInstances({ cluster }).promise();
  logger.info('updating agents...');
  const updateReqs = results.containerInstanceArns.map((arn) => {
    return ecs.updateContainerAgent({ cluster, containerInstance: arn })
      .promise()
      .catch(e => e);
  });
  await Promise.all(updateReqs);
  logger.info('updates requested');
}

// Deploys a service or set of services by running a new image
async function deploy(args) {
  const {
    region,
    cluster,
    services,
    tag,
    force,
  } = args;

  logger.info('requested release', { cluster, services, tag });
  const ecs = getECS(region);

  const serviceNames = await getServices(ecs, cluster, services);
  logger.info('targeting services', services);
  const descriptions = await ecs.describeServices({ cluster, services: serviceNames }).promise();

  // display prompt
  await showPrompt('deploy', force);

  // Get the current task definition for each service
  const getDefPromises = descriptions.services.map((service) => {
    const { taskDefinition } = service;
    logger.debug('current task def', { taskDefinition });
    return ecs.describeTaskDefinition({ taskDefinition }).promise();
  });
  const taskDefs = await Promise.all(getDefPromises);

  // Make and register new definitions
  const newTaskDefs = taskDefs.map(def => makeUpdatedDef(def, tag));
  const registeredDefs = await registerDefs(ecs, newTaskDefs);

  const newArns = registeredDefs.map(def => def.taskDefinition.taskDefinitionArn);
  return updateServices(ecs, cluster, services, newArns);
}

// Rolls services back to the previous task definitions
async function rollback(args) {
  const {
    region,
    cluster,
    services,
    rev,
    force,
  } = args;

  logger.info('requested rollback', { cluster, services, rev });
  const ecs = getECS(region);

  const serviceNames = await getServices(ecs, cluster, services);
  logger.info('targeting services', services);
  const descriptions = await ecs.describeServices({ cluster, services: serviceNames }).promise();
  const taskDefs = await getTaskDefs(ecs, cluster, descriptions);

  // display prompt
  await showPrompt('rollback', force);

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

  return updateServices(ecs, cluster, services, previousDefArns);
}

async function configGet(ecs, cluster, services, args, taskDefs) {
  const { key } = args;
  logger.info(`fetching ${key}`, { cluster, services });
  const env = taskDefs[0].taskDefinition.containerDefinitions[0].environment;
  const envVar = env.find(x => x.name === key);
  if (envVar) {
    // eslint-disable-next-line no-console
    console.log(envVar.value);
  }
}

async function configSet(ecs, cluster, services, args, taskDefs) {
  const { key, val, force } = args;
  logger.info(`setting ${key}=${val}`, { cluster, services });

  // display prompt
  await showPrompt('config set', force);

  const newTaskDefs = taskDefs.map((def) => {
    const env = def.taskDefinition.containerDefinitions[0].environment;
    env.push({ name: key, value: val });
    return makeUpdatedDef(def, null, env);
  });
  const registeredDefs = await registerDefs(ecs, newTaskDefs);

  const newArns = registeredDefs.map(def => def.taskDefinition.taskDefinitionArn);
  await updateServices(ecs, cluster, services, newArns);
}

async function configMultiSet(ecs, cluster, services, args, taskDefs) {
  const { keyValues, force } = args;
  if (!Array.isArray(keyValues.coerced) || keyValues.coerced.length < 1) {
    throw new Error('No environment variables to set!');
  }
  logger.info(`setting ${keyValues.original}`, { cluster, services });

  // display prompt
  await showPrompt('config set', force);

  const newTaskDefs = taskDefs.map((def) => {
    const env = _.get(def, 'taskDefinition.containerDefinitions[0].environment');
    return makeUpdatedDef(def, null, env.concat(keyValues.coerced));
  });
  const registeredDefs = await registerDefs(ecs, newTaskDefs);
  const newArns = registeredDefs.map(def => def.taskDefinition.taskDefinitionArn);
  await updateServices(ecs, cluster, services, newArns);
}

async function configUnset(ecs, cluster, services, args, taskDefs) {
  const { key, force } = args;
  logger.info(`unsetting ${key}`, { cluster, services });

  // display prompt
  await showPrompt('config unset', force);

  const newTaskDefs = taskDefs.map((def) => {
    const oldEnv = def.taskDefinition.containerDefinitions[0].environment;
    const newEnv = oldEnv.filter(envVar => envVar.name !== key);
    return makeUpdatedDef(def, null, newEnv);
  });
  const registeredDefs = await registerDefs(ecs, newTaskDefs);

  const newArns = registeredDefs.map(def => def.taskDefinition.taskDefinitionArn);
  await updateServices(ecs, cluster, services, newArns);
}

async function configSubcommand(ecs, cluster, services, args, taskDefs) {
  const subCommand = args._[1];
  switch (subCommand) {
    case 'get':
      configGet(ecs, cluster, services, args, taskDefs);
      break;
    case 'set':
      configSet(ecs, cluster, services, args, taskDefs);
      break;
    case 'mset':
      configMultiSet(ecs, cluster, services, args, taskDefs);
      break;
    case 'unset':
      configUnset(ecs, cluster, services, args, taskDefs);
      break;
    default:
      throw new Error(`Invalid config subcommand ${subCommand}!`);
  }
}

async function configure(args) {
  const {
    region,
    cluster,
    services,
  } = args;

  const ecs = getECS(region);
  const numArgs = args._.length;
  const serviceNames = await getServices(ecs, cluster, services);
  const descriptions = await ecs.describeServices({ cluster, services: serviceNames }).promise();
  const taskDefs = await getTaskDefs(ecs, cluster, descriptions);

  if (numArgs === 1) {
    const defEnvs = taskDefs.map((def) => {
      const containerDef = def.taskDefinition.containerDefinitions[0];
      const familyName = def.taskDefinition.family;
      return {
        name: familyName,
        container: containerDef.name,
        env: containerDef.environment.reduce((env, x) => {
          // eslint-disable-next-line no-param-reassign
          env[x.name] = x.value;
          return env;
        }, {}),
      };
    });
    defEnvs.forEach((defEnv) => {
      if (defEnvs.length !== 1) {
        // eslint-disable-next-line no-console
        console.log(`[TaskDef Family: ${defEnv.name} :: Container: ${defEnv.container}]`);
      }
      // eslint-disable-next-line no-console
      console.log(prettyjson.render(defEnv.env), '\n');
    });
  } else if (numArgs > 1) {
    configSubcommand(ecs, cluster, services, args, taskDefs);
  }
}

module.exports = {
  clusters: listClusters,
  services: listServices,
  deploy,
  rollback,
  configure,
  updateAgents,
};
