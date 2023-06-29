# INSTALLATION

## Requirements
- NODEJS
- SUPERVISOR
- ZIP (Optional, if you don´t want to backp the folder)
- RCLONE (Optional, if you want to upload to cloud)

## Install
```bash
git clone https://github.com/natopedroso/backuper
```

## Configure
```bash
cp config.js.example config.js
nano config.js
```
Configure the config.js file with your data.

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

## TUNELLING WITH PUTTY
Open a new terminal and run the following command:
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
- keep every empty string
- no to advanced
- yes auto config 
- enter on link that will appear (CHECK THE PORT with the one you tunelled)
- authorize via browser
- done

## Put the following code on your config.json file
```javascript
config: {
    ...
    rclone: {
        name: 'yourrclonename',
        path: '/path/to/your/folder'
    }
}
```






