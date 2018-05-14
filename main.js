#!/usr/bin/env node

// Node built-in modules.
const path = require('path')
const readline = require('readline')

// External modules.
const fs = require('fs-extra')
const validateName = require('validate-npm-package-name')
const chalk = require('chalk')
const cla = require('command-line-args')

// File creators.
const dotEnv = require('./file-creators/dotEnv')
const packageJson = require('./file-creators/packageJson')
const webpackConfig = require('./file-creators/webpackConfig')

// Custom modules.
const run = require('./modules/run')
const isOnline = require('./modules/isOnline')
const copyTree = require('./modules/copyTree')
const { promptYN, promptQ } = require('./modules/prompts')
const checkDirExists = require('./modules/checkDirExists')
const showVersion = require('./modules/showVersion')
const showHelp = require('./modules/showHelp')
const noName = require('./modules/noName')
const badName = require('./modules/badName')
const portValidator = require('./modules/portValidator')

// Other.
const cwd = process.cwd()
const dir = text => path.resolve(__dirname, text)

// Avoid Node complaining about unhandled rejection errors.
process.on('unhandledRejection', err => console.log(err))

/*
  Options
  -------------------

  appName
    * new folder created with this name
    * package.json "name" field
    * mongoURI and mongoSession variables in `.env` use this name (if `mongo` is used)
    * set as a variable in `.env`

  redux
    * `utils` folder created with redux-specific sub-folders
    * causes `entry.js` to have different contents

  router
    * ???

  version
    * displays the current version of this package
    * ignores any other CLI arguments and only displays the version number

  offline
    * forces the `npm install` to use local cache

  title
    * sets the webpage title generated by Webpack's `HtmlWebpackPlugin`

  force
    * skips creating a directory for the app
    * used for installing in a pre-existing directory
    * use with caution

  author, description, email, keywords
    * populates package.json field names of the same value

  api
    * sets the `devServer.proxy[api]` key value

  apiPort
    * sets the `devServer.proxy[api]` port value
    * triggers the use of the `api` default value
    * defaults to 3000
    * set as the API_PORT variable in the `.env` file

  express
    * creates `server.js` and the `api` folder WITHOUT a `utilities` sub-folder

  mongo
    * creates `server.js` and the `api` folder WITH a `utilities` sub-folder
    * sets up MongoDB

  devServerPort
    * sets the `devServer.port` value
    * defaults to 8080
    * set as DEV_SERVER_PORT variable in the `.env` file
*/

const optionDefinitions = [
  // Information only.
  { name: 'version', alias: 'v', type: Boolean },
  { name: 'help', alias: 'h', type: Boolean },


  { name: 'appName', type: String, defaultOption: true },
  { name: 'title', alias: 't', type: String, defaultValue: '' },

  // Optional addons.
  { name: 'redux', alias: 'x', type: Boolean, defaultValue: false },
  { name: 'router', alias: 'r', type: Boolean, defaultValue: false },

  // Flags.
  { name: 'offline', alias: 'o', type: Boolean, defaultValue: false },
  { name: 'force', alias: 'f', type: Boolean, defaultValue: false }, // Use with caution.
  { name: 'sandbox', alias: 's', type: Boolean, defaultValue: false },

  // `package.json` fields.
  { name: 'author', type: String, defaultValue: '' },
  { name: 'description', type: String, defaultValue: '' },
  { name: 'email', type: String, defaultValue: '' },
  { name: 'keywords', type: String, multiple: true, defaultValue: [] },

  // API / server / devServer options.
  { name: 'devServerPort', type: val => portValidator(val, 'dev', 8080), defaultValue: 8080 },
  { name: 'apiPort', type: val => portValidator(val, 'api', 3000), defaultValue: 3000 },
  { name: 'api', type: String, defaultValue: null },
  { name: 'express', alias: 'e', type: Boolean },
  { name: 'mongo', alias: 'm', type: Boolean }
]

// Let's go! Push the first dominoe.
letsGo()
async function letsGo() {
  // Clear the console - https://goo.gl/KyrhG2
  readline.cursorTo(process.stdout, 0, 0)
  readline.clearScreenDown(process.stdout)


  // STEP 1 - check if we're online.
  const online = await isOnline()

  // STEP 2 - decide between a guided process or not.
  let options

  // Called with no arguments.
  if (process.argv.length === 2) {
    options = await guidedProcess(online)

  // Called with 1 or more arguments.
  } else {
    const parsedArgs = parseArgs(online)
    options = processUsersCommand(parsedArgs)
  }

  // STEP 3 - create project directory or sandbox project.
  if (options.sandbox) return createSandbox(options)
  createProjectDirectory(options)

  // STEP 4 - create project files & folders.
  createFiles(options)

  // STEP 5 - install dependecies.
  installDependencies(options)
}


// Analyzes the CLI arguments & returns an object choc full of properties.
function parseArgs(online) {
  // const [nodeLocation, thisFile, ...args] = process.argv
  let options = cla(optionDefinitions, { partial: true })
  const {
    version,
    help,
    appName,
    api,
    offline,
    express,
    mongo,
    redux,
    router,
    sandbox
  } = options
  const validation = validateName(appName)

  // Add properties we'll use down the line.
  options = {
    ...options,
    online, // Actual online status.
    redux,
    router,
    offline: !online || offline, // Argument option from the CLI to process *as* offline.
    api: api ? api.replace(/ /g, '') : null,
    server: express || mongo,
    appDir: `${cwd}/${appName}`
  }

  // `cna -v` or `cna --version`
  if (version) return showVersion() || process.exit()

  // `cna -h` or `cna --help`
  if (help) return showHelp() || process.exit()

  checkDirExists(options) || process.exit()

  if (sandbox) return { ...options, sandbox: true }
  if (!validation.validForNewPackages) return badName(appName, validation) || process.exit()
  return options
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

  // Aggregate the default CLI values into an object so we can use those.
  const defaultOptions = optionDefinitions
    .filter(({ defaultValue }) => defaultValue !== undefined)
    .reduce((acc, { name, defaultValue }) => ({ ...acc, [name]: defaultValue }), {})

  const n = chalk.bold('n')
  const appName = await promptQ('Enter a name for your app:')
  const appDir = `${cwd}/${appName}`

  /*
    This may seem redundant since we check this again later down the line
    but we don't want the user to go through the whole process of answering
    these questions only to be rejected later. Reject as soon as possible.
  */
  checkDirExists({ appDir, appName }) || process.exit()
  const validation = validateName(appName)
  if (!validation.validForNewPackages) return badName(appName, validation) || process.exit()

  console.log(`\nPressing \`enter\` defaults to ${chalk.bold('no')} for the following...\n`)
  const redux = await promptYN('Would you like to include Redux?', false)
  const router = redux && await promptYN('Would you like to include Redux First Router?', false)
  const express = await promptYN('Would you like to include an Express server?', false)
  const mongo = express && await promptYN('Would you like to include MongoDB?', false)

  return {
    ...defaultOptions, // Default CLI values.

    // Values from questions.
    appName,
    redux,
    router,
    express,
    mongo,
    online,
    offline: !online,

    // Calculated properties.
    server: express || mongo,
    appDir,
  }
}

// Processes --version and --help commands (among other things).
function processUsersCommand(options) {
  const {
    online, // Actual online status.
    offline, // CLI argument.
    apiPort,
    express,
    mongo,
    devServerPort,
    sandbox
  } = options

  // Not online.
  if (!sandbox && (offline || !online)) {
    !online && console.log(chalk.yellow('You appear to be offline.'))
    console.log(chalk.yellow('Installing via local npm cache.'))
  }

  // The apiPort takes prescedence over the devServerPort.
  if ((express || mongo) && devServerPort === apiPort) options.devServerPort++

  return options
}

// Simple sandbox projects, executed from `processUsersCommand`.
function createSandbox(options) {
  if (!options.appName) {
    console.log('Oops! You forgot to provide a project name.')
    return console.log(`  ${chalk.green('create-new-app <project-name> --sandbox')}`)
  }

  createProjectDirectory(options)
  fs.copySync(dir('files/sandbox'), options.appDir)
}

// STEP 3
function createProjectDirectory(options) {
  const { appName, appDir, force, sandbox } = options
  const greenDir = chalk.green(`${cwd}/`)
  const boldName = chalk.green.bold(appName)
  const boldSandbox = chalk.bold(' sandbox')

  checkDirExists(options) || (!sandbox && force) || process.exit()
  console.log(`\nCreating a new${sandbox ? boldSandbox : ''} app in ${greenDir}${boldName}.`)

  // Create the project directory.
  fs.mkdirSync(appDir)
}

// STEP 4
function createFiles(options) {
  const { appDir, server, mongo, express, redux, router } = options

  // `.env`
  fs.writeFileSync(`${appDir}/.env`, dotEnv(options), 'utf-8')

  // `.gitignore`
  fs.copyFileSync(dir('files/gitignore.txt'), `${appDir}/.gitignore`)

  // `package.json`
  fs.writeFileSync(`${appDir}/package.json`, packageJson(options), 'utf-8')

  // `postcss.config.js`
  fs.copyFileSync(dir('files/postcss.config.js'), `${appDir}/postcss.config.js`)

  // `README.md`
  fs.copyFileSync(dir('files/README.md'), `${appDir}/README.md`)

  // `server.js` (with or without MongoDB options)
  server && fs.copyFileSync(dir(`files/server${mongo ? '-mongo' : ''}.js`), `${appDir}/server.js`)

  // `webpack.config.js`
  fs.writeFileSync(`${appDir}/webpack.config.js`, webpackConfig(redux), 'utf-8')

  // `api` directory tree.
  mongo && copyTree(dir('./files/api'), appDir)
  if (express && !mongo) {
    const apiDir = `${appDir}/api`
    fs.mkdirSync(apiDir)
    fs.copyFileSync(dir('files/api/home.js'), `${apiDir}/home.js`)
  }

  // `dist` directory tree.
  copyTree(dir('./files/dist'), appDir)

  // `src` directory tree.
  copyTree(dir('./files/src'), appDir)

  if (redux || router) {
    // Entry file.
    fs.copyFileSync(dir('files/redux/entry.js'), `${appDir}/src/entry.js`)

    // Redux utilities (actions, helpers, middleware, reducers).
    copyTree(dir('files/redux/utils'), `${appDir}/src`)

    if (router) {
      // Components.
      fs.copyFileSync(dir('files/redux/Redux1stApp.jsx'), `${appDir}/src/components/App.jsx`)
      fs.copyFileSync(dir('files/redux/Redux1stExample.jsx'), `${appDir}/src/components/Example.jsx`)
      fs.copyFileSync(dir('files/redux/NotFound.jsx'), `${appDir}/src/components/NotFound.jsx`)

      // Store.
      fs.copyFileSync(dir('files/redux/routerStore.js'), `${appDir}/src/store.js`)

      // Router routes map.
      fs.copyFileSync(dir('files/redux/routesMap.js'), `${appDir}/src/routesMap.js`)
    } else {
      // Components.
      fs.copyFileSync(dir('files/redux/ReduxApp.jsx'), `${appDir}/src/components/App.jsx`)
      fs.copyFileSync(dir('files/redux/ReduxExample.jsx'), `${appDir}/src/components/Example.jsx`)

      // Store.
      fs.copyFileSync(dir('files/redux/store.js'), `${appDir}/src/store.js`)
    }
  }
}

// STEP 5
function installDependencies(options) {
  const { appName, appDir, mongo, server, offline, redux, router } = options
  const forceOffline = offline ? ' --offline' : '' // https://goo.gl/aZLDLk
  const cache = offline ? ' cache' : ''

  // Change into the projects directory.
  process.chdir(`${cwd}/${appName}`)

  // Install the dependencies.
  offline && console.log(`\nIt looks like you're offline or have a bad connection.`)
  console.log(`Installing project dependencies via npm${cache}...\n`)
  run(`npm${forceOffline} i`)

  const cyanDir = chalk.cyan(appDir)
  const boldName = chalk.bold(appName)
  const serverMsg = server ? 'and Express servers' : 'server'

  console.log(`\nSuccess! Created ${boldName} at ${cyanDir}.`)
  console.log(`Inside that directory you can run several commands:\n`)

  console.log(`  ${chalk.cyan('npm start')}`)
  console.log(`    Starts the development ${serverMsg}.\n`)

  console.log(`  ${chalk.cyan('npm run build')}`)
  console.log(`    Bundles the app into static files for production.\n`)

  if (server) {
    console.log(`  ${chalk.cyan('npm run local')}`)
    console.log(`    Starts only the Express server (no development server).\n`)
  }

  console.log(`\nGet started by typing:\n`)
  console.log(`  ${chalk.cyan('cd')} ${appName}`)
  console.log(`  ${chalk.cyan('npm start')}\n`)
}
