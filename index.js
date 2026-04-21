const cron = require("node-cron");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

//CURRENT FOLDER
const currentFolder = __dirname;

// PostgreSQL database connection configuration
const config = require("./config.js").config;
const ignoreFile = path.join(__dirname, ".ignore");

cron.schedule(config.cron, async () => {
  try {
    console.log("Trying to backup", config);
    const createdBackupFiles = [];

    /**
     * CREATE A ZIP BACKUP FROM FOLDERS
     */
    if (config.folders && config.folders.length > 0) {
      const folderBackupFiles = await foldersBackUps();
      createdBackupFiles.push(...folderBackupFiles);
    }

    const databaseBackupFile = await databaseBackUp();
    createdBackupFiles.push(databaseBackupFile);

    /**
     * RCLONE SYNC
     */
    if (config.uploadMode === "ftp-curl" && config.ftpCurl) {
      await ftpCurlUpload(createdBackupFiles);
    } else if (config.uploadMode === "rclone" && config.rclone) {
      await rcloneSync(createdBackupFiles);
    }
  } catch (error) {
    console.error("Error creating database backup:", error);
  }
});

/**
 * FOLDER BACKUP
 */
async function foldersBackUps() {
  const sufix = config.loopMode === "DAILY" ? new Date().getDate() : config.loopMode === "WEEKLY" ? new Date().getDay() + 1 : new Date().getMonth() + 1;
  const ignorePatterns = buildZipIgnorePatterns(loadProjectIgnorePatterns());
  const ignoreArgs = ignorePatterns.map((pattern) => `-x ${shellQuote(pattern)}`).join(" ");
  const createdFiles = [];

  for (const folder of config.folders) {
    try {
      console.log(`Creating backup for folder: ${folder.path}`);
      const backupFileName = `${folder.name}_${sufix}.zip`;
      const backupFilePath = `${currentFolder}/backups/${backupFileName}`;
      const backupCommand = `cd ${shellQuote(folder.path)} && zip -r ${shellQuote(backupFilePath)} . ${ignoreArgs ? ` ${ignoreArgs}` : ""}`;
      const exportProcess = exec(backupCommand);
      exec(`cd ${shellQuote(currentFolder)}`);

      await new Promise((resolve, reject) => {
        exportProcess.on("close", (code) => {
          if (code === 0) {
            console.log(`Folder backup created successfully: ${backupFileName}`);
            createdFiles.push(path.resolve(backupFilePath));
            resolve();
          } else {
            console.error(`Error creating folder backup. Exit code: ${code}`);
            reject();
          }
        });
      });
    } catch (error) {
      console.error("Error creating folder backup:", error);
    }
  }

  return createdFiles;
}

function loadProjectIgnorePatterns() {
  if (!fs.existsSync(ignoreFile)) {
    return [];
  }

  return fs
    .readFileSync(ignoreFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function buildZipIgnorePatterns(rawPatterns) {
  const unique = new Set();

  for (const rawPattern of rawPatterns) {
    const normalized = String(rawPattern || "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .trim();

    if (!normalized) {
      continue;
    }

    unique.add(normalized);
    unique.add(`*/${normalized}`);

    if (!normalized.endsWith("/*")) {
      unique.add(`${normalized}/*`);
      unique.add(`*/${normalized}/*`);
    }
  }

  return [...unique];
}

/**
 * DATABASE BACKUP
 */
async function databaseBackUp() {
  const sufix = config.loopMode === "DAILY" ? new Date().getDate() : config.loopMode === "WEEKLY" ? new Date().getDay() + 1 : new Date().getMonth() + 1;

  const backupFileName = `${config.database}_${sufix}.sql`;
  const backupFilePath = `${currentFolder}/backups/${backupFileName}`;
  const backupCommand = `mysqldump --user=${config.user} --password=${config.password} --host=${config.host} --port=${config.port} ${config.database} > ${backupFilePath}`;

  console.log("Executing database backup command:", backupCommand);

  const exportProcess = exec(backupCommand);

  await new Promise((resolve, reject) => {
    exportProcess.on("close", (code) => {
      if (code === 0) {
        console.log(`Database backup created successfully: ${backupFileName}`);
        resolve();
      } else {
        console.error(`Error creating database backup. Exit code: ${code}`);
        reject();
      }
    });
  });

  return path.resolve(backupFilePath);
}

/**
 * RCLONE SYNC
 */
async function rcloneSync(backupFiles = []) {
  const rclone = config.rclone;

  if (!Array.isArray(backupFiles) || backupFiles.length === 0) {
    console.log("No newly created backup files found for rclone upload.");
    return;
  }

  try {
    for (const localFile of backupFiles) {
      console.log(`Starting rclone upload for: ${localFile}`);
      const fileName = path.basename(localFile);
      const remotePath = joinRemotePath(rclone.path, fileName);
      const remoteTarget = `${rclone.name}:${remotePath}`;
      const rcloneCommand = `rclone copyto ${shellQuote(localFile)} ${shellQuote(remoteTarget)} --progress --transfers=4 --checkers=8 --retries=3 --low-level-retries=10 --drive-chunk-size=64M --stats=1s`;
      const exportProcess = exec(rcloneCommand);

      await new Promise((resolve, reject) => {
        exportProcess
          .on("close", (code) => {
            if (code === 0) {
              console.log(`Rclone upload completed: ${fileName}`);
              resolve();
            } else {
              console.error(`Error uploading ${fileName} with rclone. Exit code: ${code}`);
              reject();
            }
          })
          .on("error", (error) => {
            console.error(`Error executing rclone command for ${fileName}:`, error);
            reject();
          });
      });
    }
  } catch (error) {
    console.error("Error uploading backup:", error);
  }
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'"'"'`)}'`;
}

function sanitizeRemotePath(remotePath) {
  const cleaned = String(remotePath || "/").trim();
  if (!cleaned) {
    return "/";
  }

  const startsWithSlash = cleaned.startsWith("/");
  const segments = cleaned
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));
  const normalized = `${startsWithSlash ? "/" : "/"}${segments.join("/")}`;

  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

/**
 * FTP UPLOAD WITH CURL
 */
async function ftpCurlUpload(backupFiles = []) {
  const ftp = config.ftpCurl;

  if (!ftp || !ftp.host || !ftp.user) {
    console.log("FTP config not found or incomplete. Skipping FTP upload.");
    return;
  }

  const files = Array.isArray(backupFiles) ? backupFiles.filter(Boolean) : [];

  if (files.length === 0) {
    console.log("No newly created backup files found for FTP upload.");
    return;
  }

  const remoteBasePath = sanitizeRemotePath(ftp.path || "/");
  const ftpPort = ftp.port || "21";

  for (const localFile of files) {
    const fileName = path.basename(localFile);
    const encodedFileName = encodeURIComponent(fileName);
    const targetUrl = `ftp://${ftp.host}:${ftpPort}${remoteBasePath}/${encodedFileName}`;
    const uploadCommand = [
      "curl",
      "--fail",
      "--silent",
      "--show-error",
      "--ftp-create-dirs",
      "--user",
      shellQuote(`${ftp.user}:${ftp.password || ""}`),
      "-T",
      shellQuote(localFile),
      shellQuote(targetUrl),
    ].join(" ");

    const exportProcess = exec(uploadCommand);

    await new Promise((resolve, reject) => {
      exportProcess.on("exit", (code) => {
        if (code === 0) {
          console.log(`FTP upload completed: ${fileName}`);
          resolve();
        } else {
          console.error(`Error uploading ${fileName} via FTP. Exit code: ${code}`);
          reject();
        }
      });
    });
  }
}

function joinRemotePath(basePath, fileName) {
  const cleanedBase = String(basePath || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const cleanedFile = String(fileName || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (!cleanedBase) {
    return cleanedFile;
  }

  return `${cleanedBase}/${cleanedFile}`;
}

/**
 * EXPORTS
 */
module.exports = {
  foldersBackUps,
  databaseBackUp,
  rcloneSync,
  ftpCurlUpload,
};
