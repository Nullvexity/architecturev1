const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const agentPath = 'c:\\Users\\User\\Desktop\\architecturev1\\agent\\agent.js';
console.log('Testing agent start at:', agentPath);

if (!fs.existsSync(agentPath)) {
  console.error('Agent path not found!');
  process.exit(1);
}

const agentProcess = spawn('node', [agentPath, '--debug'], {
  detached: true,
  stdio: 'inherit'
});

console.log('Agent spawned with PID:', agentProcess.pid);

setTimeout(() => {
  console.log('Terminating agent...');
  process.kill(agentProcess.pid);
  console.log('Done.');
  process.exit(0);
}, 3000);
