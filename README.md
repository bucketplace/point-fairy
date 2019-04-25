# point-fairy
슬랙에서 포인트 주는 요정

### 기술 및 환경
WebStorm, Node, Express, Axios, GCP Compute Engine, crontab, Google SpreadSheet API, Slack API

### 프로그램이 죽어도 재실행 되게 만들기
```
$ chmod 777 chkproc.sh
$ crontab -e
$ * * * * * /home/bsscco/point-fairy/chkproc.sh > /home/bsscco/point-fairy/crontab-chkproc.log 2>&1
$ * * * * * /home/bucketvpn/point-fairy/chkprocvpn.sh > /home/bucketvpn/point-fairy/crontab-chkprocvpn.log 2>&1
```

### crontab 예약
```
$ crontab -e
$ 0 9 1 * * curl localhost:12000/dm/new-point > /home/bsscco/point-fairy/crontab-curl-1.log 2>&1
$ */5 10-17 * * 1-5 curl localhost:12000/toss/delivery-completed > /home/bucketvpn/point-fairy/crontab-curl-2.log 2>&1
$ 0 13 * * 1-5 curl localhost:12000/dm/3months-gone-remind > /home/bsscco/point-fairy/crontab-curl-3.log 2>&1
$ 0 13 * * 1-5 curl localhost:12000/dm/point-ban > /home/bsscco/poin-tfairy/crontab-curl-4.log 2>&1
```