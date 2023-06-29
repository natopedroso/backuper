const cron = require("node-cron");
const { exec } = require("child_process");
const fs = require("fs");

// PostgreSQL database connection configuration
const config = require("./config.js").config;

// Schedule a cron job to run every day at midnight (00:00)

// cron.schedule(config.cron, async () => {
try {
  console.log("Trying to backup", config);

  const sufix = config.loopMode === "DAILY" ? new Date().getDate() : config.loopMode === "WEEKLY" ? new Date().getDay() + 1 : new Date().getMonth() + 1;
  /**
   * CREATE A ZIP BACKUP FROM FOLDERS
   */
  if (config.folders && config.folders.length > 0) {
    foreach(config.folders, async (folder) => {
      try {
        const backupFileName = `${folder.name}_${sufix}.zip`;
        const backupFilePath = `./backups/${backupFileName}`;
        const backupCommand = `zip -r ${backupFilePath} ${folder.path}`;
        const exportProcess = exec(backupCommand);

        exportProcess.on("exit", (code) => {
          if (code === 0) {
            console.log(`Folder backup created successfully: ${backupFileName}`);
          } else {
            console.error(`Error creating folder backup. Exit code: ${code}`);
          }
        });
      } catch (error) {
        console.error("Error creating folder backup:", error);
      }
    });
  }

  const backupFileName = `${config.database}_${sufix}.sql`;
  const backupFilePath = `./backups/${backupFileName}`;
  const backupCommand = `mysqldump --user=${config.user} --password=${config.password} --host=${config.host} --port=${config.port} ${config.database} > ${backupFilePath}`;
  const exportProcess = exec(backupCommand);

  exportProcess.on("exit", (code) => {
    if (code === 0) {
      console.log(`Database backup created successfully: ${backupFileName}`);
    } else {
      console.error(`Error creating database backup. Exit code: ${code}`);
    }
  });
} catch (error) {
  console.error("Error creating database backup:", error);
}
// });
