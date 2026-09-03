const cron = require("node-cron");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const REMOVE_LOCAL_AFTER_UPLOAD = true;
const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_RETRY_DELAY_MS = 60 * 1000;

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
    createdBackupFiles.unshift(databaseBackupFile);

    /**
     * RCLONE SYNC
     */
    if (config.uploadMode === "ftp-curl" && config.ftpCurl) {
      await ftpCurlUpload(createdBackupFiles);
    } else if (config.uploadMode === "rclone" && config.rclone) {
      await rcloneSync(createdBackupFiles);
    }
  } catch (error) {
    console.error("Error running backup:", error);
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

  for (const localFile of backupFiles) {
    const fileName = path.basename(localFile);

    await uploadWithRetry(fileName, "rclone", async () => {
      const remotePath = joinRemotePath(rclone.path, fileName);
      const remoteTarget = `${rclone.name}:${remotePath}`;
      const rcloneCommand = `rclone copyto ${shellQuote(localFile)} ${shellQuote(remoteTarget)} --progress --transfers=4 --checkers=8 --retries=1 --low-level-retries=1 --drive-chunk-size=64M --stats=1s`;
      const exportProcess = exec(rcloneCommand);
      let stdErr = "";
      let stdOut = "";

      if (exportProcess.stderr) {
        exportProcess.stderr.on("data", (chunk) => {
          stdErr += String(chunk || "");
        });
      }

      if (exportProcess.stdout) {
        exportProcess.stdout.on("data", (chunk) => {
          stdOut += String(chunk || "");
        });
      }

      return new Promise((resolve, reject) => {
        exportProcess
          .on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`rclone copyto failed for ${fileName} (exit ${code}). stderr: ${stdErr.trim() || "(empty)"}. stdout: ${stdOut.trim() || "(empty)"}`));
            }
          })
          .on("error", (error) => {
            reject(error);
          });
      });
    });

    if (REMOVE_LOCAL_AFTER_UPLOAD) {
      await removeLocalBackupFile(localFile);
    }
  }
}

async function uploadWithRetry(fileName, uploadMethod, uploadFile) {
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      console.log(`Starting ${uploadMethod} upload for ${fileName} (attempt ${attempt}/${UPLOAD_MAX_ATTEMPTS})`);
      await uploadFile();
      console.log(`${uploadMethod} upload completed: ${fileName}`);
      return;
    } catch (error) {
      console.error(`${uploadMethod} upload failed for ${fileName} (attempt ${attempt}/${UPLOAD_MAX_ATTEMPTS}):`, error);

      if (attempt === UPLOAD_MAX_ATTEMPTS) {
        throw new Error(`${uploadMethod} upload failed for ${fileName} after ${UPLOAD_MAX_ATTEMPTS} attempts`, { cause: error });
      }

      console.log(`Waiting ${UPLOAD_RETRY_DELAY_MS / 1000} seconds before retrying ${fileName}...`);
      await wait(UPLOAD_RETRY_DELAY_MS);
    }
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    await uploadWithRetry(fileName, "FTP", async () => {
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
      let stdErr = "";
      let stdOut = "";

      if (exportProcess.stderr) {
        exportProcess.stderr.on("data", (chunk) => {
          stdErr += String(chunk || "");
        });
      }

      if (exportProcess.stdout) {
        exportProcess.stdout.on("data", (chunk) => {
          stdOut += String(chunk || "");
        });
      }

      return new Promise((resolve, reject) => {
        exportProcess
          .on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`curl upload failed for ${fileName} (exit ${code}). stderr: ${stdErr.trim() || "(empty)"}. stdout: ${stdOut.trim() || "(empty)"}`));
            }
          })
          .on("error", reject);
      });
    });

    if (REMOVE_LOCAL_AFTER_UPLOAD) {
      await removeLocalBackupFile(localFile);
    }
  }
}

async function removeLocalBackupFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const backupsDir = path.resolve(currentFolder, "backups") + path.sep;

  try {
    if (!absolutePath.startsWith(backupsDir)) {
      console.log(`Skipping local removal outside backups/: ${absolutePath}`);
      return;
    }

    if (!fs.existsSync(absolutePath)) {
      console.log(`Local backup file not found for removal: ${absolutePath}`);
      return;
    }

    await fs.promises.unlink(absolutePath);
    console.log(`Local backup removed from backups/: ${absolutePath}`);
  } catch (error) {
    console.error(`Error removing local backup file ${absolutePath}:`, error);
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
