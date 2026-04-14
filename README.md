# DESCRIPTION
This is a simple backuper for linux VPS. 
It backups a database and directories and uploads to a cloud service.

# INSTALLATION

## Requirements
- NODEJS
- SUPERVISOR
- ZIP (Optional, if you don´t want to backup a folder)
- RCLONE (Optional, if you don´t want to upload to cloud)

## Install
```bash
cd /var
git clone https://github.com/natopedroso/backuper
cd backuper
```

## Configure
```bash
cp config.js.example config.js
nano config.js
```
Configure the config.js file with your data.

## Ignore files/folders in folder backups
If you need to ignore files or folders when creating zip backups, create a `.ignore` file in the project root (`backuper/.ignore`).

Example:
```bash
# files
*.log
*.tmp

# folders
node_modules
cache
```

## SUPERVISOR CONFIG
```bash
nano /etc/supervisor/conf.d/backuper.conf
```

### Copy and paste the following code:
```bash
[program:backuper]
directory=/var/backuper
command=node index
autostart=true
autorestart=true
stderr_logfile=/var/log/backuper.err.log
stdout_logfile=/var/log/backuper.out.log
user=root
```
save the file and exit.

### Reread Update and Restart supervisor
```bash
supervisorctl reread
supervisorctl update
supervisorctl restart backuper
```

# USING RCLONE

## TUNELLING WITH PUTTY
The tunneling is necessary to get the authorization code from rclone.
```bash
53682:localhost:53682
```

## Install Rclone
```bash
sudo apt-get install rclone
```


## Configure Rclone
```bash
rclone config
```
- enter the name;
- keep every string empty
- no to advanced
- yes auto config 
- enter on link that will appear (CHECK THE PORT with the one you tunelled)
- authorize via browser
- no to advanced
- yes to confirm
- done

## Put the following code on your config.json file
```javascript
config: {
    ...
    rclone: {
        name: 'yourrclonename',
        path: '/path/to/your/folder'
    }
    ...
}
```






