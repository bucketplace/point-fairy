daemon=`netstat -tlnp | grep :::12000 | wc -l`
if [ "$daemon" -eq "0" ] ; then
        nohup node /home/bsscco/point-fairy/app.js &
fi