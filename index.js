const cron = require("node-cron");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

// PostgreSQL database connection configuration
const config = require("./config.js").config;

cron.schedule(config.cron, async () => {
  try {
    console.log("Trying to backup", config);

    /**
     * CREATE A ZIP BACKUP FROM FOLDERS
     */
    if (config.folders && config.folders.length > 0) {
      await foldersBackUps();
    }

    await databaseBackUp();

    /**
     * RCLONE SYNC
     */
    if (config.uploadMode === "ftp-curl" && config.ftpCurl) {
      await ftpCurlUpload();
    } else if (config.rclone) {
      await rcloneSync();
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

  for (const folder of config.folders) {
    try {
      const backupFileName = `${folder.name}_${sufix}.zip`;
      const backupFilePath = `./backups/${backupFileName}`;
      const backupCommand = `zip -r ${backupFilePath} ${folder.path}`;
      const exportProcess = exec(backupCommand);

      await new Promise((resolve, reject) => {
        exportProcess.on("exit", (code) => {
          if (code === 0) {
            console.log(`Folder backup created successfully: ${backupFileName}`);
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
}

/**
 * DATABASE BACKUP
 */
async function databaseBackUp() {
  const sufix = config.loopMode === "DAILY" ? new Date().getDate() : config.loopMode === "WEEKLY" ? new Date().getDay() + 1 : new Date().getMonth() + 1;

  const backupFileName = `${config.database}_${sufix}.sql`;
  const backupFilePath = `./backups/${backupFileName}`;
  const backupCommand = `mysqldump --user=${config.user} --password=${config.password} --host=${config.host} --port=${config.port} ${config.database} > ${backupFilePath}`;
  const exportProcess = exec(backupCommand);

  await new Promise((resolve, reject) => {
    exportProcess.on("exit", (code) => {
      if (code === 0) {
        console.log(`Database backup created successfully: ${backupFileName}`);
        resolve();
      } else {
        console.error(`Error creating database backup. Exit code: ${code}`);
        reject();
      }
    });
  });
}

/**
 * RCLONE SYNC
 */
async function rcloneSync() {
  const sufix = config.loopMode === "DAILY" ? new Date().getDate() : config.loopMode === "WEEKLY" ? new Date().getDay() + 1 : new Date().getMonth() + 1;

  const rclone = config.rclone;
  try {
    const rcloneCommand = `rclone sync ./backups ${rclone.name}:${rclone.path}`;
    const exportProcess = exec(rcloneCommand);

    await new Promise((resolve, reject) => {
      exportProcess.on("exit", (code) => {
        if (code === 0) {
          console.log(`Backup uploaded successfully to ${rclone.name}:${rclone.path}`);
          resolve();
        } else {
          console.error(`Error uploading backup to ${rclone.name}:${rclone.path}. Exit code: ${code}`);
          reject();
        }
      });
    });
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
async function ftpCurlUpload() {
  const ftp = config.ftpCurl;

  if (!ftp || !ftp.host || !ftp.user) {
    console.log("FTP config not found or incomplete. Skipping FTP upload.");
    return;
  }

  const backupDir = path.resolve("./backups");
  const files = fs.readdirSync(backupDir).filter((fileName) => fs.statSync(path.join(backupDir, fileName)).isFile());

  if (files.length === 0) {
    console.log("No backup files found to upload via FTP.");
    return;
  }

  const remoteBasePath = sanitizeRemotePath(ftp.path || "/");
  const ftpPort = ftp.port || "21";

  for (const fileName of files) {
    const localFile = path.join(backupDir, fileName);
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

/**
 * EXPORTS
 */
module.exports = {
  foldersBackUps,
  databaseBackUp,
  rcloneSync,
  ftpCurlUpload,
};
