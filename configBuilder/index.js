// Config builder needs paths containing repositories
// Run with path params, eg.:
// npm run buildconfig -- "C:\source\veve\apps" "C:\source\veve\services"

const fs = require('fs');
const path = require('path');
const defaults = require('./../src/defaults');
const stripJsonComments = require('./strip-json-comments');
const logger = require('./../src/logger');
const generateJsonFromConfig = require('./generateJsonFromConfig');

const detectedApps = [];

const paths = process.argv.slice(2);
if (paths.length <= 0) {
  logger.error('No paths provided, configBuilder needs paths. Check configBuilder.js how to provide them.')
  return process.exit(0);
}

const registerApp = (folder) => {
  const packageJsonPath = path.join(folder, 'package.json');
  let packageJsonExists;
  try {
    packageJsonExists = fs.statSync(packageJsonPath);
  } catch (error) {
    logger.info(`${packageJsonPath} doesn't exist.`);
    return;
  }

  if (!packageJsonExists) {
    logger.info(`${packageJsonPath} doesn't exist.`);
    return;
  }
  const packageJsonRaw = fs.readFileSync(packageJsonPath, 'utf8');
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonRaw);
  } catch (error) {
    logger.error(`Can't parse file ${packageJsonPath}. Error: ${error}`);
    return;
  }

  const entryPath = path.join(folder, packageJson.main || defaults.PROJECT_ENTRY);
  try {
    fs.statSync(entryPath);
  } catch (error) {
    logger.error(`Can't find entry file ${entryPath}. Skipping this app ...`);
    return;
  }

  if (packageJson.name && !detectedApps.includes(packageJson.name) && packageJson.config && packageJson.config.port) {
    logger.info(`Detected app ${packageJson.name}`);
    detectedApps.push({
      name: packageJson.name,
      port: parseInt(packageJson.config.port, 10),
      path: folder,
      dependencies: [],
      entry: entryPath,
    });
  }
};

const lookupAppForPort = (port) => {
  return detectedApps.find(app => app.port === port);
};

const hasCircularDependency = (appA, appB) => {
  return appA.dependencies.includes(appB) || 
    appB.dependencies.includes(appA);
};

const registerDependenciesForConfig = (config, app) => {
  if (!config) {
    logger.verbose(`Skipping config for app ${app.name} because config doesnt exist`);
    return;
  }
  const configKeys = Object.keys(config);
  configKeys.forEach(configKey => {
    const configValue = config[configKey];
    if (typeof configValue !== 'string') {
      logger.verbose(`Skipping ${configKey} for app ${app.name} because ${configKey} is not string but ${typeof configValue}`);
      return;
    }
    const match = configValue.match(/localhost:(\d+)\//);
    if (!match || match.length !== 2) {
      logger.verbose(`Skipping ${configKey} for app ${app.name} because ${configValue} doesnt contain port.`);
      return;
    }
    const port = parseInt(match[1], 10)
    const lookupApp = lookupAppForPort(port);
    if (!lookupApp) {
      logger.verbose(`Skipping ${configKey} for app ${app.name} because couldnt find app for port ${port}.`);
      return;
    }

    if (hasCircularDependency(app, lookupApp)) {
      logger.warning(`Circular dependency found for app ${app.name} and ${lookupApp.name}!`);
    }

    if (!app.dependencies.includes(lookupApp)) {
      logger.info(`${app.name}: Adding ${lookupApp.name} as dependency.`);
      app.dependencies.push(lookupApp);
    }
  });
};

const readConfigFromFolder = (app) => {
  const defaultJsonPath = path.join(app.path, 'config', 'default.json');
  let configExists;
  try {
    configExists = fs.statSync(defaultJsonPath);
  } catch (error) {
    logger.info(`${defaultJsonPath} doesn't exist.`);
    return;
  }
  if (!configExists) {
    logger.info(`${defaultJsonPath} doesn't exist.`);
    return;
  }
  let configRaw = fs.readFileSync(defaultJsonPath, 'utf8');
  configRaw = stripJsonComments(configRaw);
  let config;
  try {
    config = JSON.parse(configRaw);
  } catch (error) {
    logger.error(`Can't parse file ${defaultJsonPath}. Error: ${error}`);
    logger.error(`Skipping app ${app.name}!`);
    return;
  }

  if (!config) {
    logger.error(`Config doesnt exist for ${app.name}, skip looking for dependencies ...`);
    return;
  }

  registerDependenciesForConfig(config.api, app);
  registerDependenciesForConfig(config, app);
};

paths.forEach(paramPath => {
  let allFiles;
  try {
    allFiles = fs.readdirSync(paramPath).map(file => path.join(paramPath, file));
  } catch (error) {
    logger.error(error);
    logger.error(`Skipping path ${paramPath} ...`);
    return;
  }
  
  const folders = allFiles.filter(file => fs.statSync(file).isDirectory());
  folders.forEach(registerApp);
});

detectedApps.forEach(readConfigFromFolder);

const fileToWrite = 'config.json';
fs.writeFileSync(fileToWrite, generateJsonFromConfig(detectedApps), 'utf8');
logger.info(`Wrote to file ${fileToWrite}!`);