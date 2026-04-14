const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const projectRoot = __dirname;
const backupsDir = path.join(projectRoot, "backups");
const configExample = path.join(projectRoot, "config.js.example");
const configFile = path.join(projectRoot, "config.js");
const supervisorDir = path.join(projectRoot, "supervisor");
const supervisorFile = path.join(supervisorDir, "backuper.conf");
const systemSupervisorFile = "/etc/supervisor/conf.d/backuper.conf";

function run(command, message) {
  if (message) {
    console.log(message);
  }

  execSync(command, {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

function commandExists(command) {
  try {
    execSync(`command -v ${command}`, {
      cwd: projectRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function isLinux() {
  return process.platform === "linux";
}

function isRoot() {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

function ensureConfigFile() {
  if (fs.existsSync(configFile)) {
    console.log("config.js already exists. Keeping current file.");
    return;
  }

  if (!fs.existsSync(configExample)) {
    throw new Error("config.js.example not found.");
  }

  fs.copyFileSync(configExample, configFile);
  console.log("config.js created from config.js.example");
}

function createSupervisorConfig() {
  ensureDir(supervisorDir);

  const projectPath = projectRoot.replace(/\\/g, "/");
  const conf = [
    "[program:backuper]",
    `directory=${projectPath}`,
    "command=node index.js",
    "autostart=true",
    "autorestart=true",
    "stderr_logfile=/var/log/backuper.err.log",
    "stdout_logfile=/var/log/backuper.out.log",
    "user=root",
    "",
  ].join("\n");

  fs.writeFileSync(supervisorFile, conf, "utf8");
  console.log(`Supervisor config generated: ${supervisorFile}`);
}

function installSupervisorIfNeeded() {
  if (commandExists("supervisorctl")) {
    console.log("Supervisor already installed.");
    return;
  }

  console.log("Supervisor not found. Installing...");

  if (commandExists("apt-get")) {
    run("apt-get update", "Updating apt repositories...");
    run("apt-get install -y supervisor", "Installing supervisor with apt...");
    return;
  }

  if (commandExists("dnf")) {
    run("dnf install -y supervisor", "Installing supervisor with dnf...");
    return;
  }

  if (commandExists("yum")) {
    run("yum install -y supervisor", "Installing supervisor with yum...");
    return;
  }

  throw new Error("Unsupported package manager. Install supervisor manually.");
}

function configureSystemSupervisor() {
  if (!isLinux()) {
    console.log("Skipping system supervisor setup: Linux only.");
    return;
  }

  if (!isRoot()) {
    console.log("Skipping system supervisor setup: run as root to configure /etc/supervisor.");
    return;
  }

  installSupervisorIfNeeded();

  fs.copyFileSync(supervisorFile, systemSupervisorFile);
  console.log(`Supervisor config copied to: ${systemSupervisorFile}`);

  run("supervisorctl reread", "Reloading supervisor configs...");
  run("supervisorctl update", "Applying supervisor updates...");

  try {
    run("supervisorctl restart backuper", "Restarting backuper process...");
  } catch {
    run("supervisorctl start backuper", "Starting backuper process...");
  }

  run("supervisorctl status backuper", "Checking backuper process status...");
}

function printNextSteps() {
  console.log("\nSetup completed successfully.\n");
  console.log("Next steps:");
  console.log("1) Edit config.js with your database and backup settings.");
  console.log("2) For local run with supervisor (development):");
  console.log("   npm run start:supervisor");
  console.log("3) On Linux as root, this installer already configures system supervisor automatically.");
  console.log("4) If you ran without root, configure manually with:");
  console.log("   sudo cp supervisor/backuper.conf /etc/supervisor/conf.d/backuper.conf");
  console.log("   sudo supervisorctl reread && sudo supervisorctl update && sudo supervisorctl restart backuper");
}

function main() {
  console.log("Starting project installation...\n");

  ensureDir(backupsDir);
  run("npm install", "Installing dependencies...");
  ensureConfigFile();
  createSupervisorConfig();
  configureSystemSupervisor();
  printNextSteps();
}

try {
  main();
} catch (error) {
  console.error("\nInstallation failed:", error.message);
  process.exit(1);
}