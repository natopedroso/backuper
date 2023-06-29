const index = require("./index.js");

const config = require("./config.js").config;

(async () => {
  try {
    console.log("Trying to backup", config);

    /**
     * CREATE A ZIP BACKUP FROM FOLDERS
     */
    if (config.folders && config.folders.length > 0) {
      await index.foldersBackUps();
    }

    await index.databaseBackUp();

    /**
     * RCLONE SYNC
     */
    if (config.rclone) {
      await index.rcloneSync();
    }
  } catch (error) {
    console.error("Error creating database backup:", error);
  }
})();
