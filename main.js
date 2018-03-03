#!/usr/bin/env node

// Node built-in modules.
const path = require('path');
const readline = require('readline');

// External modules.
const fs = require('fs-extra');
const validateName = require('validate-npm-package-name');
const chalk = require('chalk');
const cla = require('command-line-args');

// File creators.
const dotEnv = require('./file-creators/dotEnv');
const gitIgnore = require('./file-creators/gitIgnore');
const packageJson = require('./file-creators/packageJson');
const webpackConfig = require('./file-creators/webpackConfig.js');

// Custom modules.
const run = require('./modules/run');
const isOnline = require('./modules/isOnline');
const copyTree = require('./modules/copyTree');
const { promptYN, promptQ } = require('./modules/prompts');
const checkDirExists = require('./modules/checkDirExists');
const showVersion = require('./modules/showVersion');
const showHelp = require('./modules/showHelp');
const noName = require('./modules/noName');
const badName = require('./modules/badName');
const portValidator = require('./modules/portValidator');
const titleCase = require('./modules/titleCase');

// Other.
const cwd = process.cwd();
const dir = text => path.resolve(__dirname, text);

// Avoid Node complaining about unhandled rejection errors.
process.on('unhandledRejection', err => { /* console.log(err) */ });

/*
  Options
  -------------------

  appName
    * new folder created with this name
    * package.json "name" field
    * converted to title-case for the webapge title (webpack) if `title` not provided
    * mongoURI and mongoSession variables in `.env` use this name (if `mongo` is used)
    * set as a variable in `.env`

  redux
    * `utils` folder created with redux-specific sub-folders
    * causes `entry.js` to have different contents

  version
    * displays the current version of this package
    * ignores any other CLI arguments and only displays the version number

  offline
    * forces the `npm install` to use local cache

  title
    * sets the webpage title generated by Webpack's `HtmlWebpackPlugin`
    * defaults to the value of `appName`

  force
    * skips creating a directory for the app
    * used for installing in a pre-existing directory
    * use with caution

  author, description, email, keywords
    * populates package.json field names of the same value
    * description defaults to `title` or a title-cased version of `appName`

  api
    * sets the `devServer.proxy[api]` key value
    * defaults to '/api'

  apiport
    * sets the `devServer.proxy[api]` port value
    * triggers the use of the `api` default value
    * defaults to 8080
    * set as the PORT variable in the `.env` file

  express
    * creates `server.js` and the `api` folder WITHOUT a `utilities` sub-folder

  mongo
    * creates `server.js` and the `api` folder WITH a `utilities` sub-folder
    * sets up MongoDB

  port
    * sets the `devServer.port` value
    * defaults to 3000
*/

const optionDefinitions = [
  { name: 'appName', type: String, defaultOption: true },
  { name: 'version', alias: 'v', type: Boolean },
  { name: 'help', alias: 'h', type: Boolean },
  { name: 'offline', alias: 'o', type: Boolean, defaultValue: false },
  { name: 'title', alias: 't', type: String, defaultValue: '' },
  { name: 'sandbox', alias: 's', type: Boolean, defaultValue: false },
  { name: 'force', alias: 'f', type: Boolean, defaultValue: false }, // Use with caution.

  // Experimental.
  { name: 'redux', alias: 'r', type: Boolean, defaultValue: false },
  { name: 'router', type: Boolean, defaultValue: false },

  // `package.json` fields.
  { name: 'author', type: String, defaultValue: '' },
  { name: 'description', type: String, defaultValue: '' },
  { name: 'email', type: String, defaultValue: '' },
  { name: 'keywords', type: String, multiple: true, defaultValue: [] },

  // API / server options.
  { name: 'api', type: String, defaultValue: null },
  { name: 'apiport', type: val => portValidator(val, 'api'), defaultValue: 8080 },
  { name: 'express', alias: 'e', type: Boolean },
  { name: 'mongo', alias: 'm', type: Boolean },
  { name: 'port', alias: 'p', type: val => portValidator(val, 'dev'), defaultValue: 3000 }
];

// Let's go! Push the first dominoe.
letsGo();

async function letsGo() {
  // Clear the console - https://goo.gl/KyrhG2
  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);

  // STEP 1 - check if we're online.
  const online = await isOnline();

  // STEP 2 - decide between a guided process or not.
  let options;
  if (process.argv.length === 2) {
    options = await guidedProcess(online);
  } else {
    options = processUsersCommand(parseArgs(online));
  }
  return console.log(options);

  // STEP 3 - create project directory.
  return createProjectDirectory(options);

  // STEP 4 - create project files & folders.
  createFiles(options);
}

// Analyzes the CLI arguments & returns an object choc full of properties.
function parseArgs(online) {
  // const [nodeLocation, thisFile, ...args] = process.argv;
  const options = cla(optionDefinitions, { partial: true });
  const {
    appName,
    api,
    offline,
    title,
    description,
    express,
    mongo,
    redux,
    router,
    sandbox
  } = options;
  const validation = validateName(appName);

  // Add properties we'll use down the line.
  Object.assign(options, {
    online, // Actual online status.
    redux,
    router,
    offline: !online || offline, // Argument option from the CLI.
    api: api ? api.replace(/ /g, '') : null,
    title: title || appName,
    description: description || title || titleCase(appName),
    server: express || mongo,
    appDir: `${cwd}/${appName}`
  });

  /*
    2 no name scenarios:
      1. User simply typed `cna` => trigger the guided process (in `letsGo` above).
      2. User typed `cna --some --options` => should display the how-to message.
  */

  if (!appName) return noName() && process.exit();
  checkDirExists(options);

  if (sandbox) return createSandbox(options) && process.exit();
  if (!validation.validForNewPackages) return badName(appName, validation) && process.exit();
  return options;
}

// Creates an object choc full of properties via a series of prompts.
async function guidedProcess(online) {
  /*
    Questions asked during the guided process:
      1.  App name?
      2.  Include redux?
      3.  Include router?
      4.  Express server?
      5.  MongoDB?
  */

  // Aggregate the default CLI values into an object.
  const options = optionDefinitions
    .filter(({ defaultValue }) => defaultValue !== undefined)
    .reduce((acc, { name, defaultValue }) => {
      acc[name] = defaultValue;
      return acc;
    }, {});

  const n = chalk.bold('n');
  const appName = await promptQ('Enter a name for your app:');
  const appDir = `${cwd}/${appName}`;

  /*
    This may seem redundant since we check this again later down the line
    but we don't want the user to go through the whole process of answering
    these questions only to be rejected later. Reject as soon as possible.
  */
  checkDirExists({ appDir, appName });
  const validation = validateName(appName);
  if (!validation.validForNewPackages) return badName(appName, validation);

  console.log(`\nPressing \`enter\` defaults to ${chalk.bold('no')} for the following...\n`);
  const redux = await promptYN('Would you like to include Redux?', false);
  const router = redux && await promptYN('Would you like to include Redux First Router?', false);
  const express = await promptYN('Would you like to include an Express server?', false);
  const mongo = express && await promptYN('Would you like to include MongoDB?', false);

  return {
    ...options, // Default CLI values.

    // Values from questions.
    appName,
    redux,
    router,
    express,
    mongo,
    online,
    offline: !online,

    // Calculated properties.
    title: appName,
    description: titleCase(appName),
    server: express || mongo,
    appDir,
  };
}

// Processes --version and --help commands (among other things).
function processUsersCommand(options) {
  const {
    appName,
    version,
    help,
    online, // Actual online status.
    offline, // CLI argument.
    title,
    description,
    api,
    apiport,
    express,
    mongo,
    port
  } = options;

  // `cna -v` or `cna --version`
  if (version) return showVersion();

  // `cna -h` or `cna --help`
  if (help) return showHelp();

  // Not online.
  if (offline || !online) {
    !online && console.log(chalk.yellow('You appear to be offline.'));
    console.log(chalk.yellow('Installing via local npm cache.'));
  }

  // The api port takes prescedence over the dev server port.
  if ((express || mongo) && port === apiport) options.port++;

  return options;
}

// Simple sandbox projects, executed from `processUsersCommand`.
function createSandbox(options) {
  const { appDir } = options;

  checkDirExists(options);
  createProjectDirectory(options);
  fs.copySync('./files/sandbox', appDir);
}

// STEP 3
function createProjectDirectory(options) {
  const { appName, appDir, force } = options;

  // Check if the directory already exists.

  const greenDir = chalk.green(`${cwd}/`);
  const boldName = chalk.green.bold(appName);
  console.log(`Creating a new app in ${greenDir}${boldName}...`);

  // Create the project directory.
  fs.mkdirSync(appDir);
}

// STEP 4
function createFiles() {
  const { appDir, server, mongo, express } = answers;

  // `.env`
  fs.writeFileSync(`${appDir}/.env`, dotEnv(answers), 'utf-8');

  // `.gitignore`
  fs.writeFileSync(`${appDir}/.gitignore`, gitIgnore(), 'utf-8');

  // `package.json`
  fs.writeFileSync(`${appDir}/package.json`, packageJson(answers), 'utf-8');

  // `postcss.config.js`
  fs.copyFileSync(dir('files/postcss.config.js'), `${appDir}/postcss.config.js`);

  // `README.md`
  fs.copyFileSync(dir('files/README.md'), `${appDir}/README.md`);

  // `server.js` (with or without MongoDB options)
  server && fs.copyFileSync(dir(`files/server${mongo ? '-mongo' : ''}.js`), `${appDir}/server.js`);

  // `webpack.config.js`
  fs.writeFileSync(`${appDir}/webpack.config.js`, webpackConfig(answers), 'utf-8');

  // `api` directory tree.
  mongo && copyTree(dir('./files/api'), appDir);
  if (express && !mongo) {
    const apiDir = `${appDir}/api`;
    fs.mkdirSync(apiDir);
    fs.copyFileSync(dir('files/express-home-route.js'), `${apiDir}/home.js`);
  }

  // `dist` directory tree.
  copyTree(dir('./files/dist'), appDir);

  // `src` directory tree.
  copyTree(dir('./files/src'), appDir);

  installDependencies();
}

// STEP 5
function installDependencies() {
  const { appName, appDir, mongo, server, offline } = answers;
  const forceOffline = offline ? '--offline' : ''; // https://goo.gl/aZLDLk
  const cache = offline ? ' cache' : '';
  const {
    devDependencies,
    serverDependencies,
    dependencies
  } = require('./modules/dependencies')(mongo);

  // Change into the projects directory.
  process.chdir(`${cwd}/${appName}`);

  // Install the devDependencies.
  console.log(`\nInstalling \`devDependencies\` via npm${cache}. This may take a bit...`);
  const devs = devDependencies.concat(server ? serverDependencies : []);
  run(`npm ${forceOffline} i -D ${devs.join(' ')}`);

  // Install the dependencies.
  if (server) {
    console.log(`\nInstalling \`dependencies\` via npm${cache}. Again, this may take a bit...`);
    run(`npm ${forceOffline} i ${dependencies.join(' ')}`);
  }

  const cyanDir = chalk.cyan(appDir);
  const boldName = chalk.bold(appName);
  const serverMsg = server ? 'and Express servers' : 'server';

  console.log(`\nSuccess! Created ${boldName} at ${cyanDir}.`);
  console.log(`Inside that directory you can run several commands:\n`);

  console.log(`  ${chalk.cyan('npm start')}`);
  console.log(`    Starts the development ${serverMsg}.\n`);

  console.log(`  ${chalk.cyan('npm run build')}`);
  console.log(`    Bundles the app into static files for production.\n`);

  if (server) {
    console.log(`  ${chalk.cyan('npm run local')}`);
    console.log(`    Starts the Express server (no development server).\n`);
  }

  console.log(`\nGet started by typing:\n`);
  console.log(`  ${chalk.cyan('cd')} ${appName}`)
  console.log(`  ${chalk.cyan('npm start')}\n`);

  console.log('JavaScript rules!');
}
