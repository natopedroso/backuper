# INSTALLATION

## Requirements
- NODEJS
- SUPERVISOR

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




