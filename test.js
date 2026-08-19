const index = require("./index.js");

const config = require("./config.js").config;

(async () => {
  try {
    console.log("Trying to backup", config);
    const createdBackupFiles = [];

    /**
     * CREATE A ZIP BACKUP FROM FOLDERS
     */
    if (config.folders && config.folders.length > 0) {
      const folderBackupFiles = await index.foldersBackUps();
      createdBackupFiles.push(...folderBackupFiles);
    }

    const databaseBackupFile = await index.databaseBackUp();
    createdBackupFiles.push(databaseBackupFile);

    /**
     * UPLOAD
     */
    if (config.uploadMode === "ftp-curl" && config.ftpCurl) {
      await index.ftpCurlUpload(createdBackupFiles);
    } else if (config.uploadMode === "rclone" && config.rclone) {
      await index.rcloneSync(createdBackupFiles);
    } else {
      console.log("Upload skipped (uploadMode=none or incomplete upload config).");
    }

    process.exit(0);
  } catch (error) {
    console.error("Error creating database backup:", error);
    process.exit(1);
  }
})();
