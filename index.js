const cron = require("node-cron");
const { exec } = require("child_process");
const fs = require("fs");

// PostgreSQL database connection configuration
const config = require("./config.js").config;

const sufix = config.loopMode === "DAILY" ? new Date().getDate() : config.loopMode === "WEEKLY" ? new Date().getDay() + 1 : new Date().getMonth() + 1;

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
    if (config.rclone) {
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

/**
 * EXPORTS
 */
module.exports = {
  foldersBackUps,
  databaseBackUp,
  rcloneSync,
};
