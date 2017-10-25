// https://goo.gl/MrXVRS - micro UUID!
const uuid = a=>a?(a^Math.random()*16>>a/4).toString(16):([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,uuid);

function dotEnv(answers) {
  const { appName, apiport, mongo, port, server } = answers;
  const name = `appName=${appName}\n`;
  const contents = [
    `PORT=${apiport}`,
    mongo && `mongoURI=mongodb://localhost:27017/${appName}`,
    mongo && `mongoSession=${appName}Sessions`,
    mongo && `secret=${uuid()}`,
    name
  ].filter(Boolean).join('\n');

  return server ? contents : name;
}

module.exports = dotEnv;
