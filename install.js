const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

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

function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

function toSingleQuoted(value) {
  return JSON.stringify(String(value == null ? "" : value)).replace(/"/g, "'");
}

function parseCsv(csvValue) {
  return String(csvValue || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadCurrentConfig() {
  try {
    delete require.cache[require.resolve(configFile)];
    const loaded = require(configFile);
    return (loaded && loaded.config) || {};
  } catch {
    return {};
  }
}

function generateConfigContent(data) {
  const foldersLines = data.folders
    .map((folder) => {
      return `      { name: ${toSingleQuoted(folder.name)}, path: ${toSingleQuoted(folder.path)} },`;
    })
    .join("\n");

  const rcloneBlock = data.rclone
    ? [
        "    rclone: {",
        `      name: ${toSingleQuoted(data.rclone.name)},`,
        `      path: ${toSingleQuoted(data.rclone.path)},`,
        "    },",
      ].join("\n")
    : "    // rclone: { name: 'your-rclone-name', path: '/target/path' },";

  return [
    "module.exports = {",
    "  config: {",
    `    user: ${toSingleQuoted(data.user)},`,
    `    host: ${toSingleQuoted(data.host)},`,
    `    database: ${toSingleQuoted(data.database)},`,
    `    password: ${toSingleQuoted(data.password)},`,
    `    port: ${toSingleQuoted(data.port)},`,
    "",
    `    loopMode: ${toSingleQuoted(data.loopMode)},`,
    `    cron: ${toSingleQuoted(data.cron)},`,
    "",
    "    folders: [",
    foldersLines || "      // { name: 'folder-name', path: '/folder/path' },",
    "    ],",
    "",
    rcloneBlock,
    "  },",
    "};",
    "",
  ].join("\n");
}

async function configureConfigInteractive() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("Non-interactive terminal detected. Keeping current config.js.");
    return;
  }

  const current = loadCurrentConfig();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const currentFolders = Array.isArray(current.folders) ? current.folders : [];
  const currentFolderNames = currentFolders.map((f) => f.name).join(", ");
  const currentFolderPaths = currentFolders.map((f) => f.path).join(", ");

  try {
    console.log("\nConfig wizard (press ENTER to keep current/default values)\n");

    const updateAnswer = await askQuestion(rl, "Do you want to update config.js now? [Y/n]: ");
    if (String(updateAnswer || "").trim().toLowerCase() === "n") {
      console.log("Keeping current config.js without changes.");
      return;
    }

    const user = (await askQuestion(rl, `DB user [${current.user || ""}]: `)).trim() || current.user || "";
    const host = (await askQuestion(rl, `DB host [${current.host || ""}]: `)).trim() || current.host || "";
    const database =
      (await askQuestion(rl, `DB name [${current.database || ""}]: `)).trim() || current.database || "";
    const password =
      (await askQuestion(rl, `DB password [${current.password || ""}]: `)).trim() || current.password || "";
    const port = (await askQuestion(rl, `DB port [${current.port || "3306"}]: `)).trim() || current.port || "3306";

    const loopModeRaw =
      (await askQuestion(rl, `Loop mode DAILY/WEEKLY/MONTHLY [${current.loopMode || "WEEKLY"}]: `)).trim() ||
      current.loopMode ||
      "WEEKLY";
    const loopMode = String(loopModeRaw).toUpperCase();

    const cron = (await askQuestion(rl, `Cron [${current.cron || "0 0 * * *"}]: `)).trim() || current.cron || "0 0 * * *";

    const namesInput =
      (await askQuestion(
        rl,
        `Folder names (comma-separated) [${currentFolderNames || ""}] (empty to keep none): `
      )).trim() || currentFolderNames;
    const pathsInput =
      (await askQuestion(
        rl,
        `Folder paths (comma-separated, same order) [${currentFolderPaths || ""}] (empty to keep none): `
      )).trim() || currentFolderPaths;

    const folderNames = parseCsv(namesInput);
    const folderPaths = parseCsv(pathsInput);
    const folders = [];
    for (let i = 0; i < Math.min(folderNames.length, folderPaths.length); i += 1) {
      folders.push({ name: folderNames[i], path: folderPaths[i] });
    }

    const hasCurrentRclone = current.rclone && current.rclone.name && current.rclone.path;
    const rcloneUseAnswer = await askQuestion(
      rl,
      `Enable rclone upload? [${hasCurrentRclone ? "Y/n" : "y/N"}]: `
    );
    const rcloneUse = String(rcloneUseAnswer || "").trim().toLowerCase();
    const useRclone = hasCurrentRclone ? rcloneUse !== "n" : rcloneUse === "y";

    let rclone = null;
    if (useRclone) {
      const rcloneName =
        (await askQuestion(rl, `Rclone remote name [${(current.rclone && current.rclone.name) || ""}]: `)).trim() ||
        ((current.rclone && current.rclone.name) || "");
      const rclonePath =
        (await askQuestion(rl, `Rclone remote path [${(current.rclone && current.rclone.path) || ""}]: `)).trim() ||
        ((current.rclone && current.rclone.path) || "");
      rclone = { name: rcloneName, path: rclonePath };
    }

    const content = generateConfigContent({
      user,
      host,
      database,
      password,
      port,
      loopMode,
      cron,
      folders,
      rclone,
    });

    fs.writeFileSync(configFile, content, "utf8");
    console.log("config.js updated by interactive wizard.");
  } finally {
    rl.close();
  }
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

async function main() {
  console.log("Starting project installation...\n");

  ensureDir(backupsDir);
  run("npm install", "Installing dependencies...");
  ensureConfigFile();
  await configureConfigInteractive();
  createSupervisorConfig();
  configureSystemSupervisor();
  printNextSteps();
}

main().catch((error) => {
  console.error("\nInstallation failed:", error.message);
  process.exit(1);
});