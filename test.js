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
     * UPLOAD
     */
    if (config.uploadMode === "ftp-curl" && config.ftpCurl) {
      await index.ftpCurlUpload();
    } else if (config.uploadMode === "rclone" && config.rclone) {
      await index.rcloneSync();
    } else {
      console.log("Upload skipped (uploadMode=none or incomplete upload config).");
    }
    process.exit(0);
  } catch (error) {
    console.error("Error creating database backup:", error);
    process.exit(1);
  }
})();
