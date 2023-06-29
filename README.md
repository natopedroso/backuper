# INSTALLATION

## Requirements
- NODEJS
- SUPERVISOR
- ZIP (Optional, if you don´t want to backp the folder)

## Install
```bash
git clone https://github.com/natopedroso/backuper
```

## Configure
```bash
cp config.example.json config.json
nano config.json
```
Configure the config.json file with your data.

## SUPERVISOR CONFIG
```bash
nano /etc/supervisor/conf.d/backuper.conf
```

### Copy and paste the following code:
```bash
[program:backuper]
directory=/var/backuper
command=node /var/backuper/index.js
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

## Install Rclone
```bash
sudo apt-get install rclone
```

## Before Configing
Open a second shell or terminal to create a tunell with the following command:
```bash
ssh -L 53682:localhost:53682 root@yourserverip
```

## Configure Rclone
```bash
rclone config
```
- enter the name;
- keep every empty string
- no to advanced
- yes auto config 
- enter on link that will appear
- authorize via browser
- done

## Create a Supervisor to sync a folder
```bash
nano /etc/supervisor/conf.d/rclone.conf
```

### Copy and paste the following code:
```bash
[program:rclone]
directory=/var/backuper
command=rclone sync ./backups nameOfRemote:yourfolder
autostart=true
autorestart=true
stderr_logfile=/var/log/rclone.err.log
stdout_logfile=/var/log/rclone.out.log
user=root
```
save the file and exit.

### Reread Update and Restart supervisor
```bash
supervisorctl reread
supervisorctl update
supervisorctl restart rclone
```






