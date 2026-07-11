const { spawnSync } = require('child_process');
const path = require('path');

const adbCandidates = [
  process.env.ADB,
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  'adb',
].filter(Boolean);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    shell: false,
  });
}

function findAdb() {
  for (const candidate of adbCandidates) {
    const result = run(candidate, ['version']);
    if (result.status === 0) return candidate;
  }
  return null;
}

const adb = findAdb();
if (!adb) {
  console.error('ADB was not found. Install Android platform-tools or set ADB to adb.exe.');
  process.exit(1);
}

const devicesResult = run(adb, ['devices']);
if (devicesResult.status !== 0) {
  console.error(devicesResult.stderr || devicesResult.stdout || 'Failed to check Android devices.');
  process.exit(devicesResult.status || 1);
}

const connectedDevices = devicesResult.stdout
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim())
  .filter((line) => /\tdevice$/.test(line));

if (connectedDevices.length === 0) {
  console.error(
    [
      'No Android device/emulator is connected through ADB.',
      'For localhost on a physical phone: connect USB, enable USB debugging, and accept the phone prompt.',
      'Then run: npm run start:android-localhost',
    ].join('\n')
  );
  process.exit(1);
}

const reverseResult = run(adb, ['reverse', 'tcp:5000', 'tcp:5000'], { stdio: 'inherit' });
if (reverseResult.status !== 0) {
  process.exit(reverseResult.status || 1);
}

console.log('ADB reverse active: Android localhost:5000 -> laptop localhost:5000');

const expo = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const expoResult = run(expo, ['expo', 'start', '-c', '--go'], { stdio: 'inherit' });
process.exit(expoResult.status || 0);
